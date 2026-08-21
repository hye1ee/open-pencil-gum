import { revealNextAgentChange } from '@/app/ai/chat/action-preview'
import { logFeedbackNote } from '@/app/ai/chat/agent-log'
import { currentRunSteps } from '@/app/ai/tools'
import type { EditorStore } from '@/app/editor/active-store'
import { createFeedbackNotes } from '@/app/feedback-note/use'
import { actionsSoFar, summariseCanvas } from '@/app/meta-agent/context'
import type { Proposition } from '@/app/meta-agent/judge'

interface FeedbackNoteJudgmentInput {
  store: EditorStore
  request: string
  plan: string | null
  reasoning: string
  propositions: Proposition[]
}

export async function considerFeedbackNotesForStep(
  input: FeedbackNoteJudgmentInput
): Promise<void> {
  if (input.reasoning.trim() === '') return

  const { store } = input
  const notes = await createFeedbackNotes({
    request: input.request,
    plan: input.plan,
    reasoning: input.reasoning,
    propositions: input.propositions,
    canvas: summariseCanvas(store),
    actions: actionsSoFar(store)
  })

  if (notes.length === 0) {
    logFeedbackNote(currentRunSteps(store), 0, null, null, null)
    return
  }

  revealNextAgentChange()
  for (const [index, note] of notes.entries()) {
    logFeedbackNote(
      currentRunSteps(store),
      index + 1,
      note.relationship,
      note.mode,
      note.nodeId,
      `topic=${note.topic}  representation=${note.mode}${note.visualType ? `/${note.visualType}` : ''}  goal=${JSON.stringify(note.representationGoal)}  text=${JSON.stringify(note.text)}  guide=${JSON.stringify(note.annotationAffordance)}  propositions=${note.propositionIds.join(',') || 'none'}`
    )
  }
}
