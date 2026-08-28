import { copyFeedbackSelection } from '@/app/feedback-note/draft/selection'
import type { ConfirmedFeedback, FeedbackSelection } from '@/app/feedback-note/draft/types'
import type { FeedbackNote } from '@/app/feedback-note/types'

const HISTORY_LIMIT = 50

export interface ConfirmedFeedbackHistory {
  remember(note: FeedbackNote, selection: FeedbackSelection, feedback: string): string
  forget(id: string): void
  reset(): void
  forNote(noteId: string): ConfirmedFeedback[]
  relevant(note: FeedbackNote, limit?: number): ConfirmedFeedback[]
}

/** Each host owns one history instance so switching between LenCanvas and
 * LenChat cannot leak previously confirmed feedback across collaboration
 * contexts. */
export function createConfirmedFeedbackHistory(): ConfirmedFeedbackHistory {
  const history: ConfirmedFeedback[] = []
  let nextFeedbackId = 1

  return {
    remember(note, selection, feedback) {
      const id = `feedback-${nextFeedbackId++}`
      history.push({
        id,
        noteId: note.id,
        topic: note.topic,
        noteContext: {
          cue: note.text,
          representationGoal: note.representationGoal,
          relationship: note.relationship,
          reasoningEvidence: note.evidenceFromReasoning,
          propositionIds: [...note.propositionIds]
        },
        selection: copyFeedbackSelection(selection),
        feedback,
        createdAt: Date.now()
      })
      history.splice(0, Math.max(0, history.length - HISTORY_LIMIT))
      return id
    },

    forget(id) {
      const index = history.findIndex((item) => item.id === id)
      if (index !== -1) history.splice(index, 1)
    },

    reset() {
      history.splice(0)
      nextFeedbackId = 1
    },

    forNote(noteId) {
      return history.filter((item) => item.noteId === noteId)
    },

    relevant(note, limit = 3) {
      const propositionIds = new Set(note.propositionIds)
      return history
        .map((item) => ({
          item,
          score:
            (item.topic === note.topic ? 4 : 0) +
            item.noteContext.propositionIds.filter((id) => propositionIds.has(id)).length * 3 +
            (item.noteContext.relationship === note.relationship ? 1 : 0)
        }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || b.item.createdAt - a.item.createdAt)
        .slice(0, limit)
        .map(({ item }) => item)
    }
  }
}
