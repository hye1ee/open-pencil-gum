import { focusAgentCursorTarget } from '@/app/ai/chat/agent-cursor'
import { logFeedbackNote } from '@/app/ai/chat/agent-log'
import { createFeedbackNotes } from '@/app/meta-agent/hosts/lencanvas/feedback-note/use'
import {
  buildOpenPencilFeedbackNoteInput,
  type OpenPencilFeedbackNoteSource
} from '@/app/meta-agent/hosts/lencanvas/input'
import { OPEN_PENCIL_REPRESENTATION_PROVIDER } from '@/app/meta-agent/hosts/lencanvas/representation'

export async function considerFeedbackNotesForStep(
  input: OpenPencilFeedbackNoteSource
): Promise<void> {
  if (input.reasoning.trim() === '') return

  const { store } = input
  const notes = await createFeedbackNotes(
    buildOpenPencilFeedbackNoteInput(input),
    OPEN_PENCIL_REPRESENTATION_PROVIDER
  )

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
