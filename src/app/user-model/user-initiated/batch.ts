import type { ReasoningFeedbackOutcome } from '@/app/study/user-initiated/reasoning-review'
import type { UserModelReasoningFeedbackBatch } from '@/app/user-model/user-initiated/types'

export function reasoningFeedbackBatch(
  requestId: string,
  step: number | null,
  outcomes: readonly ReasoningFeedbackOutcome[]
): UserModelReasoningFeedbackBatch {
  const first = outcomes.at(0)
  return {
    requestId,
    request: first?.review.request ?? '',
    step,
    items: outcomes.map((outcome) => ({
      reviewId: outcome.review.id,
      chunkIndex: outcome.review.chunkIndex,
      reasoningChunk: outcome.review.text,
      reasoningSoFar: outcome.review.reasoningSoFar,
      selectedReasoning: outcome.selectedReasoning,
      feedback: outcome.feedback
    }))
  }
}
