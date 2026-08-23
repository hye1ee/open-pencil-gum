import { focusAgentCursorTarget } from '@/app/ai/chat/agent-cursor'
import { logFeedbackNote } from '@/app/ai/chat/agent-log'
import type { EditorStore } from '@/app/editor/active-store'
import { createFeedbackNotes } from '@/app/feedback-note/use'
import { actionsSoFar, summariseCanvas } from '@/app/meta-agent/context'
import type { Proposition } from '@/app/meta-agent/judge'

interface FeedbackNoteJudgmentInput {
  store: EditorStore
  request: string
  plan: string | null
  reasoning: string
  originStep: number
  originChunk: number
  propositions: Proposition[]
  generation: number
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
    originStep: input.originStep,
    originChunk: input.originChunk,
    propositions: input.propositions,
    canvas: summariseCanvas(store),
    actions: actionsSoFar(store),
    generation: input.generation
  })

  if (notes.length === 0) {
    logFeedbackNote(input.originStep, 0, null, null, null, `chunk=${input.originChunk}`)
    return
  }

  const activeNote = notes[0]
  if (activeNote?.nodeId) focusAgentCursorTarget(store, activeNote.nodeId)

  for (const [index, note] of notes.entries()) {
    let subtype: string | null = null
    if (note.representation.type === 'code-visual') subtype = note.representation.visualType
    if (note.representation.type === 'image') subtype = note.representation.imageType
    logFeedbackNote(
      note.originStep,
      index + 1,
      note.relationship,
      note.representation.type,
      note.nodeId,
      `chunk=${note.originChunk}  topic=${note.topic}  representation=${note.representation.type}${subtype ? `/${subtype}` : ''}  goal=${JSON.stringify(note.representationGoal)}  text=${JSON.stringify(note.text)}  propositions=${note.propositionIds.join(',') || 'none'}`
    )
  }
}
