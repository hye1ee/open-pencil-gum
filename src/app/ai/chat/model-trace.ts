/**
 * Taps the provider stream so the model's own output is observable as it is
 * produced — the reasoning summary, then the assistant text, then the tool
 * calls those led to. The run log (`agent-log.txt`, dev only) records it, while
 * the meta-agent reads the reasoning as it forms and compares it with what we
 * know about the user.
 *
 * The meta-agent's own calls go through `createUntracedLanguageModel`, so they
 * never come back through here — a judge that judged itself would not stop.
 *
 * Why here and not `onStepFinish`: that callback fires after the step's tools
 * have already run, so anything driven from it lands *after* the tool calls it
 * came before — the log read out of order. A middleware sees each block as it
 * closes and each reasoning delta as it arrives.
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
import { awaitTurnResume, currentTurnGeneration } from '@/app/ai/chat/agent-turn'
import type { ReasoningObserver } from '@/app/meta-agent/core/reasoning-observer'

/** Provider model / stream part types, taken off the SDK's own signatures so
 * this file doesn't have to import `@ai-sdk/provider` (a transitive dep). */
type ProviderModel = Parameters<typeof wrapLanguageModel>[0]['model']
type WrapStream = NonNullable<LanguageModelMiddleware['wrapStream']>
type CallParams = Parameters<WrapStream>[0]['params']
type StreamPart =
  Awaited<ReturnType<WrapStream>>['stream'] extends ReadableStream<infer Part> ? Part : never

// The watcher is registered instead of imported at runtime: importing the
// Meta Agent implementation here would close model → trace → Meta Agent → model.
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

const middleware: LanguageModelMiddleware = {
  specificationVersion: 'v3',

  wrapStream: async ({ doStream, params }) => {
    traceSystemPrompt(params)
    // Capture before starting the provider call. If feedback abandons this
    // turn while its reasoning is still being reviewed, every later gate in
    // this stream must remain stale even after the replacement turn begins.
    const turnGeneration = currentTurnGeneration()
    const { stream, ...rest } = await doStream()
    const streamId = nextStreamId++

    // Reasoning goes to observers per delta but to the log per block, since one
    // line per delta would be unreadable there. It is deliberately not mirrored
    // into the canvas speech bubble; the meta-agent still needs the stream, but
    // exposing the model's private work there adds visual noise.
    let thinking = ''
    let reasoningClosed = false
    let text = ''
    const closeReasoning = (): void => {
      if (reasoningClosed) return
      observeReasoning?.end(streamId, thinking)
      reasoningClosed = true
      logThinking(thinking)
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
    let finalReviewSettled = false

    /**
     * A text-only final step has no `tool-input-start`, so `before-action`
     * cannot hold it. Treat the final response as the step's commit point: its
     * reasoning must be reviewed and any Note resolved before the response or
     * finish chunk is allowed through.
     */
    const awaitFinalReview = async (): Promise<boolean> => {
      if (sawToolInput || finalReviewSettled) return true
      if (thinking.trim() !== '') closeReasoning()
      if (observeReasoning) await observeReasoning.settled(streamId)
      if (!(await awaitTurnResume('before-final-response', turnGeneration))) {
        dropped = true
        logTurnAbandoned('stream dropped before final response — response not shown')
        return false
      }
      finalReviewSettled = true
      return true
    }

    const tap = new TransformStream<StreamPart, StreamPart>({
      async transform(chunk, controller) {
        if (dropped) return
        seen(chunk.type)
        if (chunk.type === 'reasoning-start') {
          thinking = ''
          reasoningClosed = false
          observeReasoning?.start(streamId)
        } else if (chunk.type === 'reasoning-delta') {
          thinking += chunk.delta
          // Everything so far, not the delta: a watcher judging where the
          // thought has arrived cannot do it from half a sentence. The observer
          // answers on its own clock; this stream only blocks for a real
          // Feedback Note hold.
          observeReasoning?.chunk(streamId, chunk.delta, thinking)
          // The step boundary is the other place the turn can be held, and it
          // can be twenty seconds away. Feedback submitted while the agent is
          // mid-thought must take effect immediately.
          if (!(await awaitTurnResume('mid-thought', turnGeneration))) {
            dropped = true
            logTurnAbandoned('stream dropped at mid-thought')
            controller.terminate()
            return
          }
        } else if (chunk.type === 'reasoning-end') {
          closeReasoning()
        } else if (chunk.type === 'text-start') {
          if (!(await awaitFinalReview())) {
            controller.terminate()
            return
          }
          text = ''
        } else if (chunk.type === 'text-delta') text += chunk.delta
        else if (chunk.type === 'text-end') {
          logAgentText(text)
          text = ''
        } else if (chunk.type === 'tool-input-start') {
          sawToolInput = true
          if (thinking.trim() !== '') closeReasoning()
          // Wait only for the meta-agent's verdict. There is no artificial
          // pacing or speech-animation delay before the action.
          if (observeReasoning) {
            await observeReasoning.settled(streamId)
          }
          // Last point at which the canvas is still untouched by this step.
          // After the wait above, so a Feedback Note that only just appeared
          // still gets the chance to hold the run.
          // This is the one that matters: the chunk in hand is the tool call.
          if (!(await awaitTurnResume('before-action', turnGeneration))) {
            dropped = true
            logTurnAbandoned('stream dropped at before-action — tool call not run')
            controller.terminate()
            return
          }
        } else if (chunk.type === 'finish' && !(await awaitFinalReview())) {
          controller.terminate()
          return
        }
        controller.enqueue(chunk)
      },
      flush() {
        logStreamShape(shape)
      }
    })

    return { ...rest, stream: stream.pipeThrough(tap) }
  },

  // The plan calls (`plan.ts`) don't stream, so their thinking arrives here.
  wrapGenerate: async ({ doGenerate, params }) => {
    traceSystemPrompt(params)
    const result = await doGenerate()
    for (const part of result.content) {
      if (part.type === 'reasoning') logThinking(part.text)
    }
    return result
  }
}

export function withModelTrace(model: ProviderModel): ProviderModel {
  return wrapLanguageModel({ model, middleware })
}
