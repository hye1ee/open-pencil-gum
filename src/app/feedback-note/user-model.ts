import { logUserModelFeedback } from '@/app/ai/chat/agent-log'
import type { ConfirmedFeedback, FeedbackSelection } from '@/app/feedback-note/draft/types'
import type { StepFeedbackResult } from '@/app/feedback-note/session'
import type {
  UserModelFeedbackBatch,
  UserModelFeedbackItem,
  UserModelFeedbackSelection
} from '@/app/user-model/pipeline'

const observedNoteIds = new Set<string>()

function feedbackSelection(selection: FeedbackSelection): UserModelFeedbackSelection {
  return selection.type === 'region'
    ? { ...selection }
    : {
        type: 'text',
        text: selection.text,
        source: selection.source,
        start: selection.start,
        end: selection.end
      }
}

function feedbackItem(item: ConfirmedFeedback): UserModelFeedbackItem {
  return {
    id: item.id,
    selection: feedbackSelection(item.selection),
    feedback: item.feedback,
    createdAt: item.createdAt
  }
}

/** Converts only outcomes not previously handed to the user model. A replayed
 * task step creates no notes, but note-id dedupe also makes that invariant safe
 * against duplicate UI submissions. */
export function userModelFeedbackBatch(result: StepFeedbackResult): UserModelFeedbackBatch {
  const notes = result.outcomes.flatMap((outcome) => {
    if (observedNoteIds.has(outcome.note.id)) {
      logUserModelFeedback(result.step, 'duplicate', `${outcome.note.id} already observed`)
      return []
    }
    observedNoteIds.add(outcome.note.id)
    logUserModelFeedback(
      result.step,
      'evidence',
      `${outcome.note.id} chunk=${outcome.note.originChunk} ${outcome.note.relationship}/${outcome.resolution} propositions=${outcome.note.propositionIds.join(',') || 'none'} items=${outcome.feedbackItems.length}`
    )
    return [
      {
        noteId: outcome.note.id,
        chunk: outcome.note.originChunk,
        topic: outcome.note.topic,
        cue: outcome.note.text,
        representationGoal: outcome.note.representationGoal,
        relationship: outcome.note.relationship,
        reasoningEvidence: outcome.note.evidenceFromReasoning,
        propositionIds: [...outcome.note.propositionIds],
        resolution: outcome.resolution,
        feedbackItems: outcome.feedbackItems.map(feedbackItem)
      }
    ]
  })
  return { step: result.step, notes }
}

export function resetObservedFeedbackNotes(): void {
  observedNoteIds.clear()
}
