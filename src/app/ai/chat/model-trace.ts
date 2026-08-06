/**
 * Taps the provider stream so the model's own output is observable as it is
 * produced — the reasoning summary, then the assistant text, then the tool
 * calls those led to. Two consumers: the run log (`agent-log.txt`, dev only)
 * and the speech bubble on the canvas.
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

import { logAgentText, logSystemPrompt, logThinking } from '@/app/ai/chat/agent-log'
import {
  awaitSpeechDrained,
  endThinking,
  sayAgent,
  streamThinking
} from '@/app/ai/chat/agent-speech'

/** Provider model / stream part types, taken off the SDK's own signatures so
 * this file doesn't have to import `@ai-sdk/provider` (a transitive dep). */
type ProviderModel = Parameters<typeof wrapLanguageModel>[0]['model']
type WrapStream = NonNullable<LanguageModelMiddleware['wrapStream']>
type CallParams = Parameters<WrapStream>[0]['params']
type StreamPart =
  Awaited<ReturnType<WrapStream>>['stream'] extends ReadableStream<infer Part> ? Part : never

/** On 4.6+ the summary is opt-in twice over: `thinking` enables the block,
 * `display` decides whether it carries text (default `omitted` streams empty). */
export const anthropicThinkingOptions =
  import.meta.env.VITE_AI_THINKING === 'true'
    ? ({ thinking: { type: 'adaptive', display: 'summarized' } } as const)
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

const middleware: LanguageModelMiddleware = {
  specificationVersion: 'v3',

  wrapStream: async ({ doStream, params }) => {
    traceSystemPrompt(params)
    const { stream, ...rest } = await doStream()

    // Reasoning goes to the bubble per delta (that is the point — the user
    // watches it think) but to the log per block, since one line per delta
    // would be unreadable there.
    let thinking = ''
    let text = ''
    const tap = new TransformStream<StreamPart, StreamPart>({
      async transform(chunk, controller) {
        if (chunk.type === 'reasoning-start') thinking = ''
        else if (chunk.type === 'reasoning-delta') {
          thinking += chunk.delta
          streamThinking(chunk.delta)
        } else if (chunk.type === 'reasoning-end') {
          logThinking(thinking)
          endThinking()
          thinking = ''
          // Let the bubble finish the thought, then a beat before the agent
          // switches from thinking to speaking.
          await awaitSpeechDrained()
          await beat(AFTER_THINKING_MS)
        } else if (chunk.type === 'text-start') text = ''
        else if (chunk.type === 'text-delta') text += chunk.delta
        else if (chunk.type === 'text-end') {
          logAgentText(text)
          // Replaces the muted thinking line with what the agent actually
          // wants to say.
          sayAgent(text)
          text = ''
        } else if (chunk.type === 'tool-input-start') {
          // Nothing downstream has run yet — holding the chunk here holds the
          // tool call itself, so the canvas doesn't change until the line
          // announcing it has been up long enough to read.
          await awaitSpeechDrained()
          await beat(BEFORE_ACTION_MS)
        }
        controller.enqueue(chunk)
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
