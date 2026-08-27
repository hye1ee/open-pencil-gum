import { wrapLanguageModel } from 'ai'
import type { LanguageModelMiddleware } from 'ai'

import type { ChatGatePoint } from '@/app/meta-agent-chat/gate'
import type { ChatReasoningObserver } from '@/app/meta-agent-chat/types'

type ProviderModel = Parameters<typeof wrapLanguageModel>[0]['model']
type WrapStream = NonNullable<LanguageModelMiddleware['wrapStream']>
type StreamPart =
  Awaited<ReturnType<WrapStream>>['stream'] extends ReadableStream<infer Part> ? Part : never

interface ChatModelTraceOptions {
  observer: ChatReasoningObserver
  awaitResume(point: ChatGatePoint): Promise<boolean>
}

let nextStreamId = 1

function createChatMiddleware(options: ChatModelTraceOptions): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream()
      const streamId = nextStreamId++
      let streamSequence = 0
      let reasoning = ''
      let reasoningClosed = false
      let dropped = false
      let sawTool = false
      let actionGateSettled = false
      let outputGateSettled = false

      const closeReasoning = (): void => {
        if (reasoningClosed) return
        options.observer.end(streamId, reasoning)
        reasoningClosed = true
        reasoning = ''
      }

      const awaitActionGate = async (): Promise<boolean> => {
        sawTool = true
        if (actionGateSettled) return true
        if (reasoning.trim() !== '') closeReasoning()
        await options.observer.settled(streamId)
        if (!(await options.awaitResume('before-action'))) {
          dropped = true
          return false
        }
        actionGateSettled = true
        return true
      }

      const awaitOutputGate = async (): Promise<boolean> => {
        if (sawTool || outputGateSettled) return true
        if (reasoning.trim() !== '') closeReasoning()
        await options.observer.settled(streamId)
        if (!(await options.awaitResume('before-final-response'))) {
          dropped = true
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
            options.observer.start(streamId)
          } else if (chunk.type === 'reasoning-delta') {
            reasoning += chunk.delta
            options.observer.chunk(streamId, chunk.delta, reasoning)
            if (!(await options.awaitResume('mid-thought'))) {
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
