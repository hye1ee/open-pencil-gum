import { setReasoningObserver } from '@/app/ai/chat/model-trace'
import { currentRunStepNumber } from '@/app/ai/tools'
import type { EditorStore } from '@/app/editor/active-store'
import {
  createSequencedReasoningObserver,
  NOOP_REASONING_OBSERVER
} from '@/app/meta-agent/core/reasoning-observer'
import type { ReasoningObserver } from '@/app/meta-agent/core/reasoning-observer'
import type { Proposition } from '@/app/meta-agent/core/types'
import { considerFeedbackNotesForStep } from '@/app/meta-agent/hosts/lencanvas/feedback-note/meta'
import {
  interactiveFeedbackStep,
  recordFeedbackReasoning
} from '@/app/meta-agent/hosts/lencanvas/feedback-note/session'
import {
  beginFeedbackNoteStep,
  currentFeedbackNoteGeneration,
  settleFeedbackNoteStep
} from '@/app/meta-agent/hosts/lencanvas/feedback-note/use'
import { lencanvasHandsOffAnnotations } from '@/app/meta-agent/hosts/lencanvas/hands-off'
import { lencanvasReasoningReviews } from '@/app/meta-agent/hosts/lencanvas/user-initiated'

interface OpenPencilReasoningContext {
  enabled: boolean
  step: number | null
  generation: number
  store: EditorStore | null
  request: string
  plan: string | null
  propositions: Proposition[]
}

interface ReasoningObserverOptions {
  isEnabled(): boolean
  isUserInitiated(): boolean
  isHandsOffDelegation(): boolean
  getStore(): EditorStore | null
  getRequest(): string
  getPlan(): string | null
  getPropositions(): Proposition[]
}

let reasoningController: ReturnType<typeof createSequencedReasoningObserver> | null = null
const streamObservers = new Map<number, ReasoningObserver>()

function selectObserver(
  options: ReasoningObserverOptions,
  metaAgentObserver: ReasoningObserver
): ReasoningObserver {
  if (options.isHandsOffDelegation()) return lencanvasHandsOffAnnotations.observer
  if (options.isUserInitiated()) return lencanvasReasoningReviews.observer
  if (options.isEnabled()) return metaAgentObserver
  return NOOP_REASONING_OBSERVER
}

export function resetFeedbackNoteStreams(): void {
  reasoningController?.reset()
  streamObservers.clear()
  lencanvasReasoningReviews.reset()
  lencanvasHandsOffAnnotations.reset()
}

export function installReasoningObserver(options: ReasoningObserverOptions): void {
  reasoningController = createSequencedReasoningObserver<OpenPencilReasoningContext>({
    begin: () => {
      const store = options.getStore()
      return {
        enabled: options.isEnabled(),
        step: store ? interactiveFeedbackStep(currentRunStepNumber(store)) : null,
        generation: currentFeedbackNoteGeneration(),
        store,
        request: options.getRequest(),
        plan: options.getPlan(),
        propositions: options.getPropositions()
      }
    },
    review: async ({ context, chunkIndex, reasoningChunk }) => {
      if (!context.enabled) return
      const store = context.store
      if (!store) return
      const originStep = context.step ?? currentRunStepNumber(store)
      const originChunk = chunkIndex
      if (!recordFeedbackReasoning(originStep, originChunk, reasoningChunk)) return
      beginFeedbackNoteStep(originStep, context.generation)
      await considerFeedbackNotesForStep({
        store,
        request: context.request,
        plan: context.plan,
        reasoning: reasoningChunk,
        originStep,
        originChunk,
        propositions: context.propositions,
        generation: context.generation
      })
    },
    complete: async ({ context, pendingReviews }) => {
      if (!context.enabled) return
      if (context.step === null) {
        await pendingReviews
        return
      }
      await settleFeedbackNoteStep(context.step, context.generation, pendingReviews)
    }
  })
  const metaAgentObserver = reasoningController.observer
  setReasoningObserver({
    start: (streamId) => {
      const observer = selectObserver(options, metaAgentObserver)
      streamObservers.set(streamId, observer)
      observer.start(streamId)
    },
    chunk: (streamId, reasoningChunk, reasoningSoFar) => {
      streamObservers.get(streamId)?.chunk(streamId, reasoningChunk, reasoningSoFar)
    },
    end: (streamId, reasoning) => {
      streamObservers.get(streamId)?.end(streamId, reasoning)
    },
    settled: async (streamId) => {
      const observer = streamObservers.get(streamId)
      await observer?.settled(streamId)
      streamObservers.delete(streamId)
    }
  })
}
