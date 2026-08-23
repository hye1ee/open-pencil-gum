import type { ConfirmedFeedback, FeedbackSelection } from '@/app/feedback-note/draft/types'
import type { FeedbackNote } from '@/app/feedback-note/types'
import type { Proposition } from '@/app/user-model/pipeline'

export const FEEDBACK_DRAFT_SYSTEM = `Write one short, editable feedback suggestion in the user's voice. It is a hypothesis the user can accept or revise.

Ground it in the selected target, the current note, relevant user-model propositions and their rationales, and feedback the user previously confirmed. Selection signals attention, not approval or disapproval.

Always express what should remain, change, or be clarified.

When the supplied user-model rationale or prior confirmed feedback provides enough evidence to infer why, include that likely reason in the same sentence. Use language such as "because" or "so that" when it reads naturally. The reason is an editable hypothesis, not a required part of every suggestion.

If the evidence supports only what the user wants and not why, omit the reason. Never force a reason or fill missing context with generic design advice.

Use one natural sentence and at most 25 words. Return only the suggestion. Do not use quotation marks, labels, or preamble.`

function selectionText(selection: FeedbackSelection): string {
  if (selection.type === 'text') return `Selected text: ${selection.text}`
  return `Selected visual region: x=${selection.x.toFixed(3)}, y=${selection.y.toFixed(3)}, width=${selection.width.toFixed(3)}, height=${selection.height.toFixed(3)}`
}

export function renderFeedbackDraftPrompt(input: {
  note: FeedbackNote
  selection: FeedbackSelection
  propositions: Proposition[]
  previousFeedback: ConfirmedFeedback[]
  hasOverviewImage: boolean
  hasSelectionImage: boolean
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
              `- Note context: ${item.noteContext.cue}\n  Reasoning context: ${item.noteContext.reasoningEvidence}\n  Selected: ${item.selection.type === 'text' ? item.selection.text : 'a visual region'}\n  Confirmed feedback: ${item.feedback}`
          )
          .join('\n')

  return `CURRENT NOTE
Cue: ${input.note.text}
Goal: ${input.note.representationGoal}
Reasoning evidence: ${input.note.evidenceFromReasoning}
Relationship: ${input.note.relationship}

CURRENT SELECTION
${selectionText(input.selection)}
${input.hasOverviewImage ? 'The first attached image shows the full visual.' : ''}
${input.hasSelectionImage ? 'The second attached image is the selected crop.' : ''}

RELEVANT USER MODEL
${propositionBlock}

PREVIOUS CONFIRMED FEEDBACK WITH CONTEXT
${feedbackBlock}`
}
