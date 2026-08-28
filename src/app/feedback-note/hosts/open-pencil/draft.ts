import { generateFeedbackDraft } from '@/app/feedback-note/draft/generate'
import type { FeedbackDraftInput } from '@/app/feedback-note/draft/types'
import { openPencilFeedbackHistory } from '@/app/feedback-note/hosts/open-pencil/history'
import { propositions } from '@/app/user-model/store'

/** LenCanvas adapter: supplies its own User Model and confirmed-feedback
 * history to the shared generator. Visual capture remains common because both
 * hosts render the same Feedback Note representation contract. */
export function generateOpenPencilFeedbackDraft(input: FeedbackDraftInput): Promise<string | null> {
  const linkedIds = new Set(input.note.propositionIds)
  const relevantPropositions = propositions.value
    .filter((item) => linkedIds.has(item.id))
    .slice(0, 5)
  return generateFeedbackDraft({
    ...input,
    propositions: relevantPropositions,
    previousFeedback: openPencilFeedbackHistory.relevant(input.note)
  })
}
