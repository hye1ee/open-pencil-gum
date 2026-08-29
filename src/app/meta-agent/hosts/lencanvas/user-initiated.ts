import { pauseTurn, resumeTurn } from '@/app/ai/chat/agent-turn'
import { currentFeedbackReplayStep } from '@/app/meta-agent/hosts/lencanvas/feedback-note/session'
import { createReasoningReviewSession } from '@/app/study/user-initiated/reasoning-review'

export const lencanvasReasoningReviews = createReasoningReviewSession({
  hold: () => pauseTurn('reasoning-review'),
  release: () => resumeTurn('reasoning-review'),
  // The corrected step is replayed without asking about the same reasoning
  // again. `onStepFinish` clears the replay after its first mutating action,
  // so checkpoints resume for every following step in the same request.
  shouldObserve: () => currentFeedbackReplayStep() === null
})
