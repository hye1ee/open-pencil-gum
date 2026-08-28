import { setReasoningObserver } from '@/app/ai/chat/model-trace'
import { currentRunStepNumber } from '@/app/ai/tools'
import type { EditorStore } from '@/app/editor/active-store'
import { considerFeedbackNotesForStep } from '@/app/feedback-note/meta'
import { interactiveFeedbackStep, recordFeedbackReasoning } from '@/app/feedback-note/session'
import {
  beginFeedbackNoteStep,
  currentFeedbackNoteGeneration,
  settleFeedbackNoteStep
} from '@/app/feedback-note/use'
import { createSequencedReasoningObserver } from '@/app/meta-agent/core/reasoning-observer'
import type { Proposition } from '@/app/meta-agent/core/types'

interface OpenPencilReasoningContext {
  step: number | null
  generation: number
  store: EditorStore | null
  request: string
  plan: string | null
  propositions: Proposition[]
}

interface ReasoningObserverOptions {
  getStore(): EditorStore | null
  getRequest(): string
  getPlan(): string | null
  getPropositions(): Proposition[]
}

let reasoningController: ReturnType<typeof createSequencedReasoningObserver> | null = null

export function resetFeedbackNoteStreams(): void {
  reasoningController?.reset()
}

export function installReasoningObserver(options: ReasoningObserverOptions): void {
  reasoningController = createSequencedReasoningObserver<OpenPencilReasoningContext>({
    begin: () => {
      const store = options.getStore()
      return {
        step: store ? interactiveFeedbackStep(currentRunStepNumber(store)) : null,
        generation: currentFeedbackNoteGeneration(),
        store,
        request: options.getRequest(),
        plan: options.getPlan(),
        propositions: options.getPropositions()
      }
    },
    review: ({ context, chunkIndex, reasoningChunk }) => {
      const store = context.store
      if (!store) return
      const originStep = context.step ?? currentRunStepNumber(store)
      const originChunk = chunkIndex
      if (!recordFeedbackReasoning(originStep, originChunk, reasoningChunk)) return
      beginFeedbackNoteStep(originStep, context.generation)
      return considerFeedbackNotesForStep({
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
    complete: ({ context, pendingReviews }) => {
      if (context.step === null) return pendingReviews
      return settleFeedbackNoteStep(context.step, context.generation, pendingReviews)
    }
  })
  setReasoningObserver(reasoningController.observer)
}
