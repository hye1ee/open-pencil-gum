import { readonly, shallowRef } from 'vue'
import type { DeepReadonly, ShallowRef } from 'vue'

import {
  logHandsOffAnnotation,
  logHandsOffPhase,
  logHandsOffRunSummary
} from '@/app/ai/chat/agent-log'
import type { ReasoningObserver } from '@/app/meta-agent/core/reasoning-observer'
import {
  countAnnotationsByPolarity,
  describeStepActionAnnotationForLog,
  describeTextSelectionAnnotationForLog
} from '@/app/study/hands-off/annotation'
import type {
  HandsOffAnnotationPolarity,
  HandsOffStepActionAnnotation,
  HandsOffTextSelectionAnnotation
} from '@/app/study/hands-off/annotation'

export type HandsOffReasoningCardStatus = 'pending' | 'done'

export interface HandsOffReasoningAnnotationCard {
  id: string
  streamId: number
  chunkIndex: number
  stepNumber: number
  text: string
  status: HandsOffReasoningCardStatus
  createdAt: number
}

export interface HandsOffPendingStepAction {
  stepNumber: number
  executedToolNames: readonly string[]
  targetNodeIds: readonly string[]
  /** The final text response executes no tools and is collected after the run,
   * so it never holds the turn. */
  isFinalResponse: boolean
}

interface HandsOffCanvasSessionOptions {
  hold(): void
  release(): void
  getCurrentStepNumber(): number
  shouldObserve?(): boolean
}

export interface HandsOffCanvasSession {
  cards: DeepReadonly<ShallowRef<HandsOffReasoningAnnotationCard[]>>
  pendingStepAction: DeepReadonly<ShallowRef<HandsOffPendingStepAction | null>>
  annotations: DeepReadonly<ShallowRef<HandsOffTextSelectionAnnotation[]>>
  stepActionAnnotations: DeepReadonly<ShallowRef<HandsOffStepActionAnnotation[]>>
  observer: ReasoningObserver
  beginRun(request: string): void
  addReasoningAnnotation(
    cardId: string,
    selectedText: string,
    startOffset: number,
    endOffset: number,
    polarity: HandsOffAnnotationPolarity
  ): void
  completeReasoningAnnotation(cardId: string): void
  beginStepActionAnnotation(
    stepNumber: number,
    executedToolNames: readonly string[],
    targetNodeIds: readonly string[]
  ): void
  beginFinalResponseAnnotation(): void
  submitStepActionAnnotation(polarity: HandsOffAnnotationPolarity | 'skipped'): void
  hasPendingCard(): boolean
  reset(): void
}

/**
 * LenCanvas hands-off delegation state, gated per agent step. Each step's
 * reasoning chunks become annotation cards that hold the turn before the
 * step's tool calls execute; once every card is done the held calls run
 * unchanged, and a second hold collects the participant's verdict on the
 * executed step before the next one starts. Nothing recorded here feeds back
 * into the agent or the user model.
 */
export function createHandsOffCanvasSession(
  options: HandsOffCanvasSessionOptions
): HandsOffCanvasSession {
  const cards = shallowRef<HandsOffReasoningAnnotationCard[]>([])
  const pendingStepAction = shallowRef<HandsOffPendingStepAction | null>(null)
  const annotations = shallowRef<HandsOffTextSelectionAnnotation[]>([])
  const stepActionAnnotations = shallowRef<HandsOffStepActionAnnotation[]>([])
  const chunkCounts = new Map<number, number>()
  let annotationSequence = 0
  let held = false

  const hasPendingCard = (): boolean => cards.value.some((card) => card.status === 'pending')

  const ensureHeld = (): void => {
    if (held) return
    held = true
    options.hold()
  }

  const releaseWhenIdle = (): void => {
    if (!held || hasPendingCard()) return
    if (pendingStepAction.value !== null && !pendingStepAction.value.isFinalResponse) return
    held = false
    options.release()
  }

  const observer: ReasoningObserver = {
    start: (streamId) => {
      chunkCounts.set(streamId, 0)
    },
    chunk: (streamId, reasoningChunk) => {
      if (options.shouldObserve?.() === false) return
      const text = reasoningChunk.trim()
      if (!text) return
      const chunkIndex = (chunkCounts.get(streamId) ?? 0) + 1
      chunkCounts.set(streamId, chunkIndex)
      cards.value = [
        ...cards.value,
        {
          id: `hands-off-reasoning-${streamId}-${chunkIndex}`,
          streamId,
          chunkIndex,
          stepNumber: options.getCurrentStepNumber(),
          text,
          status: 'pending',
          createdAt: Date.now()
        }
      ]
      // One hold covers every reasoning card that precedes the step's first
      // tool call; the last completed card releases it and the held tool
      // calls execute exactly as the agent issued them.
      ensureHeld()
    },
    end: () => undefined,
    settled: async () => undefined
  }

  const logSummary = (): void => {
    const reasoning = countAnnotationsByPolarity(annotations.value, 'reasoning')
    const verdicts = stepActionAnnotations.value
    const count = (polarity: HandsOffStepActionAnnotation['polarity']): number =>
      verdicts.filter((verdict) => verdict.polarity === polarity).length
    logHandsOffRunSummary(
      `host=lencanvas reasoning-cards=${cards.value.length}` +
        ` reasoning-liked=${reasoning.liked} reasoning-disliked=${reasoning.disliked}` +
        ` steps-liked=${count('liked')} steps-disliked=${count('disliked')}` +
        ` steps-skipped=${count('skipped')}`
    )
  }

  return {
    cards: readonly(cards),
    pendingStepAction: readonly(pendingStepAction),
    annotations: readonly(annotations),
    stepActionAnnotations: readonly(stepActionAnnotations),
    observer,
    beginRun: (request) => {
      cards.value = []
      pendingStepAction.value = null
      annotations.value = []
      stepActionAnnotations.value = []
      chunkCounts.clear()
      annotationSequence = 0
      if (held) {
        held = false
        options.release()
      }
      logHandsOffPhase(`agent-running request="${request.trim()}"`)
    },
    addReasoningAnnotation: (cardId, selectedText, startOffset, endOffset, polarity) => {
      const card = cards.value.find((candidate) => candidate.id === cardId)
      if (!card) return
      annotationSequence += 1
      const annotation: HandsOffTextSelectionAnnotation = {
        id: `hands-off-annotation-${annotationSequence}`,
        phase: 'reasoning',
        streamId: card.streamId,
        chunkIndex: card.chunkIndex,
        stepNumber: card.stepNumber,
        selectedText,
        startOffset,
        endOffset,
        polarity,
        createdAt: Date.now()
      }
      annotations.value = [...annotations.value, annotation]
      logHandsOffAnnotation(`host=lencanvas ${describeTextSelectionAnnotationForLog(annotation)}`)
    },
    completeReasoningAnnotation: (cardId) => {
      const card = cards.value.find((candidate) => candidate.id === cardId)
      if (card?.status !== 'pending') return
      cards.value = cards.value.map((candidate) =>
        candidate.id === cardId ? { ...candidate, status: 'done' } : candidate
      )
      releaseWhenIdle()
    },
    beginStepActionAnnotation: (stepNumber, executedToolNames, targetNodeIds) => {
      pendingStepAction.value = {
        stepNumber,
        executedToolNames,
        targetNodeIds,
        isFinalResponse: false
      }
      ensureHeld()
      logHandsOffPhase(
        `annotating-step-action step=${stepNumber} tools=${executedToolNames.join(',') || '(none)'}`
      )
    },
    beginFinalResponseAnnotation: () => {
      pendingStepAction.value = {
        stepNumber: 0,
        executedToolNames: [],
        targetNodeIds: [],
        isFinalResponse: true
      }
      logHandsOffPhase('annotating-final-response')
    },
    submitStepActionAnnotation: (polarity) => {
      const pending = pendingStepAction.value
      if (!pending) return
      const annotation: HandsOffStepActionAnnotation = {
        stepNumber: pending.stepNumber,
        executedToolNames: pending.executedToolNames,
        targetNodeIds: pending.targetNodeIds,
        polarity,
        createdAt: Date.now()
      }
      stepActionAnnotations.value = [...stepActionAnnotations.value, annotation]
      logHandsOffAnnotation(`host=lencanvas ${describeStepActionAnnotationForLog(annotation)}`)
      pendingStepAction.value = null
      if (pending.isFinalResponse) {
        logSummary()
        return
      }
      releaseWhenIdle()
    },
    hasPendingCard,
    reset: () => {
      cards.value = []
      pendingStepAction.value = null
      annotations.value = []
      stepActionAnnotations.value = []
      chunkCounts.clear()
      annotationSequence = 0
      if (held) {
        held = false
        options.release()
      }
    }
  }
}
