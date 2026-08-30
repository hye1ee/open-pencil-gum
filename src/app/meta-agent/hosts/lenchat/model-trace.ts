import { promiseTimeout } from '@vueuse/core'
import { wrapLanguageModel } from 'ai'
import type { LanguageModelMiddleware } from 'ai'

import { logTurnAbandoned } from '@/app/ai/chat/agent-log'
import type { ChatGatePoint } from '@/app/meta-agent/hosts/lenchat/gate'
import type { ChatReasoningMode, ChatReasoningObserver } from '@/app/meta-agent/hosts/lenchat/types'

type ProviderModel = Parameters<typeof wrapLanguageModel>[0]['model']
type WrapStream = NonNullable<LanguageModelMiddleware['wrapStream']>
type DoStream = Parameters<WrapStream>[0]['doStream']
type StreamPart =
  Awaited<ReturnType<WrapStream>>['stream'] extends ReadableStream<infer Part> ? Part : never

interface ChatModelTraceOptions {
  observer: ChatReasoningObserver
  awaitResume(point: ChatGatePoint): Promise<boolean>
  awaitReasoningReviews: boolean
  reasoningMode(): ChatReasoningMode
  retryInitialNetworkFailure?: boolean
}

let nextStreamId = 1

function isInitialNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch')
}

async function startProviderStream(
  doStream: DoStream,
  retryInitialNetworkFailure: boolean
): Promise<Awaited<ReturnType<DoStream>>> {
  try {
    return await doStream()
  } catch (error) {
    if (!retryInitialNetworkFailure || !isInitialNetworkFailure(error)) throw error
    await promiseTimeout(250)
    return doStream()
  }
}

function createChatMiddleware(options: ChatModelTraceOptions): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await startProviderStream(
        doStream,
        options.retryInitialNetworkFailure === true
      )
      const streamId = nextStreamId++
      const reasoningMode = options.reasoningMode()
      let streamSequence = 0
      let reasoning = ''
      let reasoningClosed = false
      let dropped = false
      let actionGateSettled = false
      let outputGateSettled = false

      const closeReasoning = (): void => {
        if (reasoningClosed) return
        if (reasoningMode.observe) options.observer.end(streamId, reasoning)
        reasoningClosed = true
        reasoning = ''
      }

      const awaitActionGate = async (): Promise<boolean> => {
        if (actionGateSettled) return true
        if (reasoning.trim() !== '') closeReasoning()
        if (reasoningMode.observe && options.awaitReasoningReviews) {
          await options.observer.settled(streamId)
        }
        if (!reasoningMode.observe) return true
        if (!(await options.awaitResume('before-action'))) {
          dropped = true
          logTurnAbandoned(`LenChat stream ${streamId} before tool call`)
          return false
        }
        actionGateSettled = true
        return true
      }

      const awaitOutputGate = async (): Promise<boolean> => {
        if (outputGateSettled) return true
        if (reasoning.trim() !== '') closeReasoning()
        if (reasoningMode.observe && options.awaitReasoningReviews) {
          await options.observer.settled(streamId)
        }
        if (!reasoningMode.observe) return true
        if (!(await options.awaitResume('before-final-response'))) {
          dropped = true
          logTurnAbandoned(`LenChat stream ${streamId} before final response`)
          return false
        }
        outputGateSettled = true
        return true
      }

      const tap = new TransformStream<StreamPart, StreamPart>({
        async transform(chunk, controller) {
          if (import.meta.env.DEV) {
            streamSequence += 1
            // oxlint-disable-next-line no-console -- development stream inspection.
            console.info('[conversation:model-stream]', {
              streamId,
              sequence: streamSequence,
              receivedAt: new Date().toISOString(),
              type: chunk.type,
              data: chunk
            })
          }
          if (dropped) return

          if (chunk.type === 'reasoning-start') {
            reasoning = ''
            reasoningClosed = false
            if (reasoningMode.observe) options.observer.start(streamId)
          } else if (chunk.type === 'reasoning-delta') {
            reasoning += chunk.delta
            if (reasoningMode.observe) options.observer.chunk(streamId, chunk.delta, reasoning)
            if (reasoningMode.observe && !(await options.awaitResume('mid-thought'))) {
              dropped = true
              controller.terminate()
              return
            }
          } else if (chunk.type === 'reasoning-end') {
            closeReasoning()
          } else if (chunk.type === 'text-start') {
            if (!(await awaitOutputGate())) {
              controller.terminate()
              return
            }
          } else if (chunk.type === 'tool-input-start' || chunk.type === 'tool-call') {
            if (!(await awaitActionGate())) {
              controller.terminate()
              return
            }
          } else if (chunk.type === 'finish' && !(await awaitOutputGate())) {
            controller.terminate()
            return
          }

          if (!reasoningMode.reveal && chunk.type.startsWith('reasoning-')) return
          controller.enqueue(chunk)
        }
      })

      return { ...rest, stream: stream.pipeThrough(tap) }
    }
  }
}

export function withChatModelTrace(
  model: ProviderModel,
  options: ChatModelTraceOptions
): ProviderModel {
  return wrapLanguageModel({ model, middleware: createChatMiddleware(options) })
}
