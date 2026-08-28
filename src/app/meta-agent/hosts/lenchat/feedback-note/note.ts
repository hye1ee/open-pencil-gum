import type { ConversationFeedbackNote } from '@/app/conversation/types'
import type { FeedbackNote } from '@/app/meta-agent/feedback-note/types'

/** Restores the shared Feedback Note contract from LenChat's UI record. */
export function lenChatFeedbackNote(note: ConversationFeedbackNote): FeedbackNote {
  return {
    id: note.id,
    originStep: note.originStep,
    originChunk: note.originChunk,
    topic: note.topic,
    relationship: note.relationship,
    representation: structuredClone(note.representation),
    representationGoal: note.representationGoal,
    text: note.cue,
    cueSegments: [{ text: note.cue, source: 'neutral' }],
    nodeId: null,
    evidenceFromReasoning: note.reasoningEvidence,
    propositionIds: [...note.propositionIds]
  }
}
