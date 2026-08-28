import type { ConversationFeedbackNote } from '@/app/conversation/types'
import { generateFeedbackDraft } from '@/app/meta-agent/feedback-note/draft/generate'
import type { FeedbackDraftProposition, FeedbackSelection } from '@/app/meta-agent/feedback-note/draft/types'
import { lenChatFeedbackHistory } from '@/app/meta-agent/hosts/lenchat/feedback-note/history'
import { lenChatFeedbackNote } from '@/app/meta-agent/hosts/lenchat/feedback-note/note'

export interface LenChatFeedbackDraftInput {
  note: ConversationFeedbackNote
  selection: FeedbackSelection
  propositions: readonly FeedbackDraftProposition[]
  overviewImage?: Uint8Array
  annotatedImage?: Uint8Array
}

/** LenChat adapter: injects its conversation-scoped User Model and interaction
 * history into the shared auto-feedback generator. */
export function generateLenChatFeedbackDraft(
  input: LenChatFeedbackDraftInput
): Promise<string | null> {
  const note = lenChatFeedbackNote(input.note)
  const linkedIds = new Set(note.propositionIds)
  const relevantPropositions = input.propositions
    .filter((item) => linkedIds.has(item.id))
    .slice(0, 5)
  return generateFeedbackDraft({
    note,
    selection: input.selection,
    propositions: relevantPropositions,
    previousFeedback: lenChatFeedbackHistory.relevant(note),
    overviewImage: input.overviewImage,
    annotatedImage: input.annotatedImage
  })
}
