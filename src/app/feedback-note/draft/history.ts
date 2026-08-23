import type { ConfirmedFeedback, FeedbackSelection } from '@/app/feedback-note/draft/types'
import type { FeedbackNote } from '@/app/feedback-note/types'

const HISTORY_LIMIT = 50
const history: ConfirmedFeedback[] = []
let nextFeedbackId = 1

function copySelection(selection: FeedbackSelection): FeedbackSelection {
  return selection.type === 'region'
    ? {
        type: 'region',
        x: selection.x,
        y: selection.y,
        width: selection.width,
        height: selection.height
      }
    : {
        type: 'text',
        text: selection.text,
        source: selection.source,
        start: selection.start,
        end: selection.end
      }
}

export function rememberConfirmedFeedback(
  note: FeedbackNote,
  selection: FeedbackSelection,
  feedback: string
): string {
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
    selection: copySelection(selection),
    feedback,
    createdAt: Date.now()
  })
  history.splice(0, Math.max(0, history.length - HISTORY_LIMIT))
  return id
}

export function forgetConfirmedFeedback(id: string): void {
  const index = history.findIndex((item) => item.id === id)
  if (index !== -1) history.splice(index, 1)
}

export function resetConfirmedFeedbackHistory(): void {
  history.splice(0)
  nextFeedbackId = 1
}

export function confirmedFeedbackForNote(noteId: string): ConfirmedFeedback[] {
  return history.filter((item) => item.noteId === noteId)
}

export function relevantConfirmedFeedback(note: FeedbackNote, limit = 3): ConfirmedFeedback[] {
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
