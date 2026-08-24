import { feedbackSelectionLabel } from '@/app/feedback-note/draft/selection'
import type { ConfirmedFeedback, FeedbackSelection } from '@/app/feedback-note/draft/types'
import type { FeedbackNote } from '@/app/feedback-note/types'
import type { Proposition } from '@/app/user-model/pipeline'

export const FEEDBACK_DRAFT_SYSTEM = `Write one short, editable feedback suggestion in the user's voice. It is a hypothesis the user can accept or revise.

Ground it in the selected target, the current note, relevant user-model propositions and their rationales, and feedback the user previously confirmed.

When CURRENT SELECTION says the note asked for a choice, treat the selected alternative as the user's choice. The user model may help explain that choice, but it must not reverse or ignore it. For all other selections, a mark signals attention rather than approval or disapproval.

Always express what should remain, change, or be clarified.

When the supplied user-model rationale or prior confirmed feedback provides enough evidence to infer why, include that likely reason in the same sentence. Use language such as "because" or "so that" when it reads naturally. The reason is an editable hypothesis, not a required part of every suggestion.

If the evidence supports only what the user wants and not why, omit the reason. Never force a reason or fill missing context with generic design advice.

Use one natural sentence and at most 25 words. Return only the suggestion. Do not use quotation marks, labels, or preamble.`

const CHOICE_CUE_PATTERN =
  /\b(?:choose|select|pick|which|prefer(?:red)?|decide|confirm|resolve|mark)\b/i

function selectionText(note: FeedbackNote, selection: FeedbackSelection): string {
  if (selection.type === 'text') return `Selected text: ${selection.text}`
  if (selection.target) {
    const target = `"${selection.target.label}" (id: ${selection.target.id})`
    const asksForChoice = CHOICE_CUE_PATTERN.test(`${note.text}\n${note.representationGoal}`)
    if (asksForChoice) {
      return `The note explicitly asks the user to choose an alternative. The user selected ${target}. Treat this as their chosen alternative, not merely an area of attention.`
    }
    return `Selected visual target: ${target}. Annotation: ${feedbackSelectionLabel(selection)}`
  }
  return `Selected visual annotation: ${feedbackSelectionLabel(selection)}`
}

export function renderFeedbackDraftPrompt(input: {
  note: FeedbackNote
  selection: FeedbackSelection
  propositions: Proposition[]
  previousFeedback: ConfirmedFeedback[]
  hasOverviewImage: boolean
  hasAnnotatedImage: boolean
}): string {
  const propositionBlock =
    input.propositions.length === 0
      ? 'None directly linked.'
      : input.propositions
          .map(
            (item) =>
              `- ${item.text} (confidence ${item.confidence.toFixed(2)})${item.rationale ? `\n  Rationale: ${item.rationale}` : ''}`
          )
          .join('\n')
  const feedbackBlock =
    input.previousFeedback.length === 0
      ? 'None yet.'
      : input.previousFeedback
          .map(
            (item) =>
              `- Note context: ${item.noteContext.cue}\n  Reasoning context: ${item.noteContext.reasoningEvidence}\n  Selected: ${feedbackSelectionLabel(item.selection)}\n  Confirmed feedback: ${item.feedback}`
          )
          .join('\n')

  return `CURRENT NOTE
Cue: ${input.note.text}
Goal: ${input.note.representationGoal}
Reasoning evidence: ${input.note.evidenceFromReasoning}
Relationship: ${input.note.relationship}

CURRENT SELECTION
${selectionText(input.note, input.selection)}
${input.hasOverviewImage ? 'The first attached image shows the full visual.' : ''}
${input.hasAnnotatedImage ? 'The second attached image shows the same full visual with the user annotation overlaid.' : ''}

RELEVANT USER MODEL
${propositionBlock}

PREVIOUS CONFIRMED FEEDBACK WITH CONTEXT
${feedbackBlock}`
}
