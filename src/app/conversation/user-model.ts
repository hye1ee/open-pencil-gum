import type { ConversationFeedbackItem, ConversationFeedbackNote } from '@/app/conversation/types'
import { copyFeedbackSelection } from '@/app/feedback-note/draft/selection'
import type { UserModelFeedbackBatch } from '@/app/user-model/pipeline'

/** Converts LenChat feedback items at the host boundary while preserving the
 * same selection-aware User Model contract used by LenCanvas. */
export function conversationFeedbackBatch(
  note: ConversationFeedbackNote,
  feedbackItems: readonly ConversationFeedbackItem[]
): UserModelFeedbackBatch {
  return {
    step: note.originStep,
    notes: [
      {
        noteId: note.id,
        chunk: note.originChunk,
        topic: note.topic,
        cue: note.cue,
        representationGoal: note.representationGoal,
        relationship: note.relationship,
        reasoningEvidence: note.reasoningEvidence,
        propositionIds: [...note.propositionIds],
        resolution: feedbackItems.length > 0 ? 'explicit-feedback' : 'implicitly-accepted',
        feedbackItems: feedbackItems.map((item) => ({
          id: item.id,
          selection: copyFeedbackSelection(item.selection),
          feedback: item.text,
          createdAt: item.createdAt
        }))
      }
    ]
  }
}
