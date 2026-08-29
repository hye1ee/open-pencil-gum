import { readonly, shallowRef } from 'vue'
import type { DeepReadonly, ShallowRef } from 'vue'

import type { ReasoningObserver } from '@/app/meta-agent/core/reasoning-observer'

export type ReasoningReviewStatus = 'pending' | 'continued' | 'answered'

export interface ReasoningReview {
  id: string
  streamId: number
  chunkIndex: number
  request: string
  text: string
  reasoningSoFar: string
  status: ReasoningReviewStatus
  createdAt: number
}

export interface ReasoningFeedbackOutcome {
  review: ReasoningReview
  feedback: string
  selectedReasoning: string | null
}

interface ReasoningReviewSessionOptions {
  hold(): void
  release(): void
  shouldObserve?(): boolean
}

export interface ReasoningReviewSession {
  reviews: DeepReadonly<ShallowRef<ReasoningReview[]>>
  observer: ReasoningObserver
  beginRequest(request: string): void
  continueReview(id: string): boolean
  submitFeedback(
    id: string,
    feedback: string,
    selectedReasoning?: string | null
  ): ReasoningFeedbackOutcome | null
  hasPending(): boolean
  setObserving(observing: boolean): void
  reset(): void
}

/**
 * Shared User-Initiated-condition state. Provider reasoning deltas remain the
 * review unit; hosts supply only their own pause and resume implementations.
 */
export function createReasoningReviewSession(
  options: ReasoningReviewSessionOptions
): ReasoningReviewSession {
  const reviews = shallowRef<ReasoningReview[]>([])
  const chunkCounts = new Map<number, number>()
  let request = ''
  let observing = true

  const hasPending = (): boolean => reviews.value.some((review) => review.status === 'pending')

  const observer: ReasoningObserver = {
    start: (streamId) => {
      chunkCounts.set(streamId, 0)
    },
    chunk: (streamId, reasoningChunk, reasoningSoFar) => {
      if (!observing || options.shouldObserve?.() === false) return
      const text = reasoningChunk.trim()
      if (!text) return
      const alreadyHeld = hasPending()
      const chunkIndex = (chunkCounts.get(streamId) ?? 0) + 1
      chunkCounts.set(streamId, chunkIndex)
      reviews.value = [
        ...reviews.value,
        {
          id: `reasoning-${streamId}-${chunkIndex}`,
          streamId,
          chunkIndex,
          request,
          text,
          reasoningSoFar: reasoningSoFar.trim(),
          status: 'pending',
          createdAt: Date.now()
        }
      ]
      // One hold covers the whole batch of reasoning that precedes the next
      // action/final boundary. Further chunks stay visible immediately while
      // that hold remains active; the last reviewed card releases it.
      if (!alreadyHeld) options.hold()
    },
    end: () => undefined,
    settled: async () => undefined
  }

  return {
    reviews: readonly(reviews),
    observer,
    beginRequest: (nextRequest) => {
      request = nextRequest.trim()
    },
    continueReview: (id) => {
      const review = reviews.value.find((candidate) => candidate.id === id)
      if (review?.status !== 'pending') return false
      reviews.value = reviews.value.map((candidate) =>
        candidate.id === id ? { ...candidate, status: 'continued' } : candidate
      )
      if (!hasPending()) options.release()
      return true
    },
    submitFeedback: (id, feedback, selectedReasoning = null) => {
      const cleanFeedback = feedback.trim()
      const review = reviews.value.find((candidate) => candidate.id === id)
      if (review?.status !== 'pending' || cleanFeedback === '') return null
      const cleanSelection = selectedReasoning?.trim() || null
      const answeredReview: ReasoningReview = { ...review, status: 'answered' }
      reviews.value = reviews.value.map((candidate) =>
        candidate.id === id ? answeredReview : candidate
      )
      if (!hasPending()) options.release()
      return {
        review: answeredReview,
        feedback: cleanFeedback,
        selectedReasoning: cleanSelection
      }
    },
    hasPending,
    setObserving: (nextObserving) => {
      observing = nextObserving
    },
    reset: () => {
      const held = hasPending()
      reviews.value = []
      chunkCounts.clear()
      if (held) options.release()
    }
  }
}
