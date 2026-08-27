/**
 * Taps the provider stream so the model's own output is observable as it is
 * produced — the reasoning summary, then the assistant text, then the tool
 * calls those led to. Three consumers: the run log (`agent-log.txt`, dev only),
 * the speech bubble on the canvas, and the meta-agent, which reads the thinking
 * as it forms and says where it runs against what we know about the user.
 *
 * The meta-agent's own calls go through `createUntracedLanguageModel`, so they
 * never come back through here — a judge that judged itself would not stop.
 *
 * Why here and not `onStepFinish`: that callback fires after the step's tools
 * have already run, so anything driven from it lands *after* the tool calls it
 * came before — the log read out of order, and the bubble said "now adding the
 * logo" once the logo was already there. A middleware sees each block as it
 * closes, and each reasoning delta as it arrives, which is what makes the
 * thinking bubble stream at all.
 *
 * Thinking itself is opt-in — Anthropic returns no reasoning blocks unless
 * asked, and it costs tokens — so it needs `VITE_AI_THINKING=true` (see
 * `.env.example`). Everything else here runs in any build.
 */

import { wrapLanguageModel } from 'ai'
import type { LanguageModelMiddleware } from 'ai'

import {
  logAgentText,
  logStreamShape,
  logSystemPrompt,
  logThinking,
  logTurnAbandoned
} from '@/app/ai/chat/agent-log'
import { awaitSpeechDrained, sayAgent } from '@/app/ai/chat/agent-speech'
import { awaitTurnResume } from '@/app/ai/chat/agent-turn'

/** Provider model / stream part types, taken off the SDK's own signatures so
 * this file doesn't have to import `@ai-sdk/provider` (a transitive dep). */
type ProviderModel = Parameters<typeof wrapLanguageModel>[0]['model']
type WrapStream = NonNullable<LanguageModelMiddleware['wrapStream']>
type CallParams = Parameters<WrapStream>[0]['params']
type StreamPart =
  Awaited<ReturnType<WrapStream>>['stream'] extends ReadableStream<infer Part> ? Part : never

/**
 * Who is watching the thinking, if anyone. Registered rather than imported: the
 * only watcher today is the meta-agent, and it builds a model of its own — an
 * import here would close the loop model → model-trace → meta-agent → model.
 */
export interface ReasoningObserver {
  /** A fresh block of thinking has begun; whatever came before is finished. */
  start(streamId: number): void
  /** One provider chunk and everything thought in this block so far. */
  chunk(streamId: number, reasoningChunk: string, reasoningSoFar: string): void
  /** The completed block, before the agent's action is released. */
  end(streamId: number, reasoning: string): void
  /** Resolves once the watcher has finished answering everything it has been
   * given. Awaited before the tool call — see `SETTLE_TIMEOUT_MS`. */
  settled(streamId: number): Promise<void>
}

export interface ModelTraceOptions {
  /** A session-scoped observer. The design editor falls back to its registered observer. */
  reasoningObserver?: ReasoningObserver
  /** A session-scoped hold gate. Returning false drops the pending provider action. */
  awaitResume?: (
    point: 'mid-thought' | 'before-action' | 'before-final-response'
  ) => Promise<boolean>
  /** Conversation mode keeps the trace but omits canvas speech, run logs, and design pacing. */
  mode?: 'design' | 'conversation'
  /** Hold text output until the reasoning observer settles and any checkpoint clears. */
  gateOutput?: boolean
}
let observeReasoning: ReasoningObserver | null = null
let nextStreamId = 1

export function setReasoningObserver(observer: ReasoningObserver): void {
  observeReasoning = observer
}

const THINKING_REQUESTED = import.meta.env.VITE_AI_THINKING === 'true'

/** On 4.6+ the summary is opt-in twice over: `thinking` enables the block,
 * `display` decides whether it carries text (default `omitted` streams empty). */
export const anthropicThinkingOptions = THINKING_REQUESTED
  ? ({ thinking: { type: 'adaptive', display: 'summarized' } } as const)
  : undefined

/**
 * Gemini thinks by default but keeps it to itself; `includeThoughts` is what
 * puts the summary on the wire. The budget is left unset so the model decides
 * how long to think, which is what a reasoning model is for.
 *
 * Nothing downstream needs to know which provider this came from — the SDK's
 * Google adapter already turns thought parts into the same `reasoning-*` chunks
 * the tap below reads.
 */
export const googleThinkingOptions = THINKING_REQUESTED
  ? ({ thinkingConfig: { includeThoughts: true } } as const)
  : undefined

/**
 * Beats between the three things that happen in a step. Without them the model
 * thinks, speaks and edits the canvas in the same instant and the user sees
 * only the result. Holding a chunk here holds everything downstream of it —
 * the SSE body just buffers — so these are real pauses in the run, not just in
 * the animation. Keep them short; they multiply by step count.
 */
const AFTER_THINKING_MS = 500
const BEFORE_ACTION_MS = 900

/**
 * Held after every block of thinking the model emits.
 *
 * The meta-agent answers once per block, so without this its marks appear and
 * disappear at whatever rate the provider happens to stream at — measured at a
 * mark every one to two seconds, which is faster than anyone can move a pointer
 * to one. Slowing the source is the honest way to buy that time: everything on
 * screen is still the model's current answer, and the run really is where the
 * canvas says it is. Making the mark outlive the answer instead would have put
 * a stale warning on a canvas that had already moved past it.
 */
const BETWEEN_THOUGHTS_MS = 2500

function beat(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

let lastSystem: string | null = null

function traceSystemPrompt(params: CallParams): void {
  const system = params.prompt
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n')
  logSystemPrompt(system.length)
  if (!import.meta.env.DEV || system === lastSystem) return
  lastSystem = system
  // Chrome hides console.debug unless the console's Verbose level is on.
  console.debug(`[ai] system prompt (${system.length} chars)\n${system}`)
}

function createMiddleware(options: ModelTraceOptions = {}): LanguageModelMiddleware {
  const isDesign = options.mode !== 'conversation'
  const resume = options.awaitResume ?? awaitTurnResume
  const designBeat = (ms: number): Promise<void> => (isDesign ? beat(ms) : Promise.resolve())
  const logDropped = (message: string): void => {
    if (isDesign) logTurnAbandoned(message)
  }
  const finishText = (text: string): void => {
    if (!isDesign) return
    logAgentText(text)
    sayAgent(text)
  }
  const prepareAction = async (): Promise<void> => {
    if (!isDesign) return
    await awaitSpeechDrained()
    await beat(BEFORE_ACTION_MS)
  }

  return {
    specificationVersion: 'v3',

    wrapStream: async ({ doStream, params }) => {
      if (isDesign) traceSystemPrompt(params)
      const { stream, ...rest } = await doStream()
      const streamId = nextStreamId++
      const streamObserver = options.reasoningObserver ?? observeReasoning
      let streamSequence = 0

      // Reasoning goes to observers per delta but to the log per block, since one
      // line per delta would be unreadable there. It is deliberately not mirrored
      // into the canvas speech bubble; the meta-agent still needs the stream, but
      // exposing the model's private work there adds visual noise.
      let thinking = ''
      let reasoningClosed = false
      let text = ''
      const closeReasoning = (): void => {
        if (reasoningClosed) return
        streamObserver?.end(streamId, thinking)
        reasoningClosed = true
        if (isDesign) logThinking(thinking)
        thinking = ''
      }
      // Repeats collapsed to a count — a step is mostly deltas, and the question
      // this answers is which part types arrive and in what order.
      const shape: string[] = []
      const seen = (type: string): void => {
        const last = shape.length > 0 ? shape[shape.length - 1] : ''
        let run = 0
        if (last === type) run = 1
        else if (last.startsWith(`${type} ×`)) run = Number(last.slice(type.length + 2))
        if (run === 0) shape.push(type)
        else shape[shape.length - 1] = `${type} ×${run + 1}`
      }
      // The turn was thrown away while this stream was held. Everything still
      // buffered behind the hold belongs to a step that is being done again, so
      // none of it may reach the tool executor.
      let dropped = false
      let sawToolInput = false
      let outputGateSettled = false

      /**
       * A text-only final step has no `tool-input-start`, so `before-action`
       * cannot hold it. Treat output as the step's commit point: wait for the
       * reasoning observer and resolve any checkpoint before text is released.
       */
      const awaitOutputGate = async (): Promise<boolean> => {
        if (sawToolInput || outputGateSettled) return true
        if (thinking.trim() !== '') closeReasoning()
        if (options.gateOutput === false) return true
        await streamObserver?.settled(streamId)
        if (!(await resume('before-final-response'))) {
          dropped = true
          logDropped('stream dropped before final response — response not shown')
          return false
        }
        outputGateSettled = true
        return true
      }

      const tap = new TransformStream<StreamPart, StreamPart>({
        async transform(chunk, controller) {
          if (!isDesign && import.meta.env.DEV) {
            streamSequence += 1
            // oxlint-disable-next-line no-console -- development trace requested for stream debugging.
            console.info('[conversation:model-stream]', {
              streamId,
              sequence: streamSequence,
              receivedAt: new Date().toISOString(),
              type: chunk.type,
              data: chunk
            })
          }
          if (dropped) return
          seen(chunk.type)
          if (chunk.type === 'reasoning-start') {
            thinking = ''
            reasoningClosed = false
            streamObserver?.start(streamId)
          } else if (chunk.type === 'reasoning-delta') {
            thinking += chunk.delta
            // Everything so far, not the delta: a watcher judging where the
            // thought has arrived cannot do it from half a sentence. Not awaited
            // — it answers on its own clock, and the beat below is what gives it
            // room, not this call.
            streamObserver?.chunk(streamId, chunk.delta, thinking)
            await designBeat(BETWEEN_THOUGHTS_MS)
            // The step boundary is the other place the turn can be held, and it
            // can be twenty seconds away. Someone who points at a marker while the
            // agent is mid-thought means now.
            if (!(await resume('mid-thought'))) {
              dropped = true
              logDropped('stream dropped at mid-thought')
              controller.terminate()
              return
            }
          } else if (chunk.type === 'reasoning-end') {
            closeReasoning()
            // Keep a short beat before the agent switches from thinking to
            // speaking, without waiting on a hidden bubble animation.
            await designBeat(AFTER_THINKING_MS)
          } else if (chunk.type === 'text-start') {
            if (!(await awaitOutputGate())) {
              controller.terminate()
              return
            }
            text = ''
          } else if (chunk.type === 'text-delta') text += chunk.delta
          else if (chunk.type === 'text-end') {
            // Replaces the muted thinking line with what the agent actually
            // wants to say.
            finishText(text)
            text = ''
          } else if (chunk.type === 'tool-input-start') {
            sawToolInput = true
            if (thinking.trim() !== '') closeReasoning()
            // Nothing downstream has run yet — holding the chunk here holds the
            // tool call itself, so the canvas doesn't change until the line
            // announcing it has been up long enough to read.
            await prepareAction()
            // Then for the watcher's verdict on the thinking that led here, so
            // its marks are up before the thing they are about lands.
            await streamObserver?.settled(streamId)
            // Last point at which the canvas is still untouched by this step.
            // After the wait above, so a mark that only just appeared still gets
            // the chance to hold the run.
            // This is the one that matters: the chunk in hand is the tool call.
            if (!(await resume('before-action'))) {
              dropped = true
              logDropped('stream dropped at before-action — tool call not run')
              controller.terminate()
              return
            }
          } else if (chunk.type === 'finish' && !(await awaitOutputGate())) {
            controller.terminate()
            return
          }
          controller.enqueue(chunk)
        },
        flush() {
          if (isDesign) logStreamShape(shape)
        }
      })

      return { ...rest, stream: stream.pipeThrough(tap) }
    },

    // The plan calls (`plan.ts`) don't stream, so their thinking arrives here.
    wrapGenerate: async ({ doGenerate, params }) => {
      if (isDesign) traceSystemPrompt(params)
      const result = await doGenerate()
      if (isDesign) {
        for (const part of result.content) {
          if (part.type === 'reasoning') logThinking(part.text)
        }
      }
      return result
    }
  }
}

export function withModelTrace(model: ProviderModel, options?: ModelTraceOptions): ProviderModel {
  return wrapLanguageModel({ model, middleware: createMiddleware(options) })
}
