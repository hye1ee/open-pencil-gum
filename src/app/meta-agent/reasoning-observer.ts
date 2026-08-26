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
import type { Proposition } from '@/app/meta-agent/judge'

interface FeedbackNoteStreamState {
  chunk: number
  step: number | null
  settled: boolean
  task: Promise<void>
  generation: number
  store: EditorStore | null
  request: string
  plan: string | null
  propositions: Proposition[]
}

interface ReasoningObserverOptions {
  feedbackNotesEnabled: boolean
  getStore(): EditorStore | null
  getRequest(): string
  getPlan(): string | null
  getPropositions(): Proposition[]
  onOrdinaryStart(): void
  onOrdinaryChunk(reasoning: string): void
  onReasoningEnd(reasoning: string): void
  ordinarySettled(): Promise<void>
}

const streams = new Map<number, FeedbackNoteStreamState>()
const invalidatedStreams = new Set<number>()

export function resetFeedbackNoteStreams(): void {
  for (const streamId of streams.keys()) invalidatedStreams.add(streamId)
  streams.clear()
}

export function installReasoningObserver(options: ReasoningObserverOptions): void {
  setReasoningObserver({
    start: (streamId) => {
      if (invalidatedStreams.has(streamId)) return
      if (options.feedbackNotesEnabled) {
        const store = options.getStore()
        streams.set(streamId, {
          chunk: 0,
          step: store ? interactiveFeedbackStep(currentRunStepNumber(store)) : null,
          settled: false,
          task: Promise.resolve(),
          generation: currentFeedbackNoteGeneration(),
          store,
          request: options.getRequest(),
          plan: options.getPlan(),
          propositions: options.getPropositions()
        })
      } else {
        options.onOrdinaryStart()
      }
    },
    chunk: (streamId, reasoningChunk, reasoningSoFar) => {
      if (!options.feedbackNotesEnabled) {
        options.onOrdinaryChunk(reasoningSoFar)
        return
      }
      const state = streams.get(streamId)
      const store = state?.store
      if (!state || !store || reasoningChunk.trim() === '') return
      state.chunk++
      const originStep = state.step ?? currentRunStepNumber(store)
      const originChunk = state.chunk
      if (!recordFeedbackReasoning(originStep, originChunk, reasoningChunk)) return
      beginFeedbackNoteStep(originStep, state.generation)
      state.task = state.task.then(() =>
        considerFeedbackNotesForStep({
          store,
          request: state.request,
          plan: state.plan,
          reasoning: reasoningChunk,
          originStep,
          originChunk,
          propositions: state.propositions,
          generation: state.generation
        })
      )
    },
    end: (streamId, reasoning) => {
      options.onReasoningEnd(reasoning)
      const state = streams.get(streamId)
      if (
        !options.feedbackNotesEnabled ||
        !state ||
        state.chunk === 0 ||
        state.step === null ||
        state.settled
      )
        return
      state.settled = true
      state.task = settleFeedbackNoteStep(state.step, state.generation, state.task)
    },
    settled: (streamId) =>
      options.feedbackNotesEnabled
        ? (streams.get(streamId)?.task ?? Promise.resolve())
        : options.ordinarySettled()
  })
}
