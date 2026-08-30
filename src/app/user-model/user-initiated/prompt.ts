import { koreanOutputInstruction } from '@/app/study/language'
import type { Proposition } from '@/app/user-model/pipeline'
import type { ChangedProposition, ReviseNeighbour } from '@/app/user-model/prompt'
import type { UserModelReasoningFeedbackBatch } from '@/app/user-model/user-initiated/types'

const outOfTen = (value: number) => (value * 9 + 1).toFixed(0)

function renderNeighbour(proposition: ReviseNeighbour): string {
  const seen = proposition.ageDays < 1 ? 'today' : `${Math.round(proposition.ageDays)} days ago`
  return (
    `- id: ${proposition.id}\n` +
    `  text: "${proposition.text}"\n` +
    `  confidence: ${outOfTen(proposition.confidence)}/10, ` +
    `decay: ${outOfTen(proposition.decay)}/10, last seen: ${seen}\n` +
    `  rewritten: ${proposition.revisions}; original: "${proposition.originalText}"`
  )
}

function renderFeedback(batch: UserModelReasoningFeedbackBatch): string {
  return batch.items
    .map(
      (item, index) =>
        `${index + 1}. reasoning checkpoint ${item.chunkIndex}\n` +
        `  reasoning so far:\n${item.reasoningSoFar}\n` +
        `  current reasoning chunk:\n${item.reasoningChunk}\n` +
        `  selected reasoning: ${item.selectedReasoning ? `"${item.selectedReasoning}"` : '(the whole checkpoint)'}\n` +
        `  final user feedback: "${item.feedback}"`
    )
    .join('\n\n')
}

export const FEEDBACK_SYSTEM_USER_INITIATED = `TASK

Update a user model from explicit feedback that a user wrote while reviewing a Task Agent's reasoning. A user model is a set of reusable propositions about one person's task-relevant perspective.

WHAT COUNTS AS EVIDENCE

For each feedback item you receive the original request, the Agent's reasoning context, the reasoning the user targeted, and the user's final submitted feedback.

- The Agent reasoning is context that identifies the decision being discussed. It is not evidence that the user believes the Agent's claims.
- The final submitted feedback is the user evidence and is authoritative.
- The selected reasoning only identifies what the feedback refers to. Do not turn unselected reasoning into a rejection or preference.

HOW TO UPDATE

- If feedback confirms an existing proposition, keep its wording and raise confidence.
- If it adds a condition, constraint, or scope to the same underlying claim, refine the existing proposition while preserving every supported part of its meaning.
- If it contradicts an existing proposition, lower that proposition's confidence and create a replacement or contextual exception when the new claim is reusable.
- Create a new proposition only when the feedback reveals a reusable perspective not already represented.
- Leave unrelated propositions out. Local implementation instructions that do not generalize may correctly produce no update.
- Prefer refining an existing proposition over creating a near-duplicate.

PROPOSITION RULES

- The subject is always the user and is omitted from the sentence.
- State what the user prefers, needs, prioritizes, avoids, or considers successful.
- Keep rationale out of proposition text. A reason, goal, or intended effect is handled in a separate stage.
- Use one concise sentence. Do not merely paraphrase an unchanged claim.

For each proposition you change, return:
- id: an existing id, or null for a new proposition.
- text: the resulting proposition.
- confidence: 1-10.
- decay: 1-10, where 1 is durable and 10 is likely temporary.
- reasoning: one sentence explaining how the final user feedback supports this operation.
- relation: confirmation | same_claim_refinement | contextual_exception | contradiction | new_claim.

Return ONLY a JSON array:
[{"id":"... or null","text":"...","confidence":8,"decay":3,"reasoning":"...","relation":"confirmation"}]${koreanOutputInstruction()}`

export function feedbackUserInitiatedPrompt(
  batch: UserModelReasoningFeedbackBatch,
  propositions: ReviseNeighbour[]
): string {
  const held =
    propositions.length === 0
      ? '(none — the user model is empty)'
      : propositions.map(renderNeighbour).join('\n')
  return `Original request:
"${batch.request}"

Reasoning checkpoints and explicit user feedback:
${renderFeedback(batch)}

Existing propositions retrieved independently from each feedback item, then combined:
${held}`
}

export const RATIONALE_SYSTEM_USER_INITIATED = `TASK

Update proposition rationales from explicit feedback on Task Agent reasoning. A proposition says WHAT the person prefers. Its rationale says WHY: the reason, goal, consequence, trade-off, or intended effect supported by the person's feedback.

The Agent reasoning is context, not user evidence. Ground every rationale in the user's final submitted feedback. The selected reasoning helps identify the feedback target but does not supply a reason on its own.

Write or revise a rationale only when the final feedback states a reason or makes one clearly inferable from the feedback's own content. Reasons need not use words such as "because" or "so that". If several materially different reasons fit equally well, return no rationale for that proposition.

Do not change proposition text or confidence. Do not restate the proposition as its rationale. Do not use Agent reasoning or general domain knowledge to invent a benefit the user never supported.

For every rationale returned:
- id: the proposition id.
- rationale: the narrowest supported explanation of why it is true.
- purpose_evidence_quote: an exact, non-empty substring copied from one final user feedback item.
- rationale_grounds: explain which feedback and propositions make this rationale supported.
- rationale_from: ids of any other propositions read alongside it; may be empty.

Return ONLY a JSON array. Returning [] is correct when the feedback reveals what but not why:
[{"id":"...","rationale":"...","purpose_evidence_quote":"exact feedback substring","rationale_grounds":"...","rationale_from":[]}]${koreanOutputInstruction()}`

function renderChange(change: ChangedProposition): string {
  return (
    `- ${change.wasNew ? 'created' : 'updated'}: "${change.text}" ` +
    `(confidence ${outOfTen(change.confidence)}/10)\n  revision reason: ${change.reasoning}`
  )
}

function renderProposition(proposition: Proposition): string {
  return (
    `- id: ${proposition.id}\n` +
    `  proposition: "${proposition.text}"\n` +
    `  confidence: ${outOfTen(proposition.confidence)}/10\n` +
    `  current rationale: ${proposition.rationale ? `"${proposition.rationale}"` : '(none)'}`
  )
}

export function rationaleUserInitiatedPrompt(
  batch: UserModelReasoningFeedbackBatch,
  changed: ChangedProposition[],
  propositions: Proposition[]
): string {
  return `Original request:
"${batch.request}"

Reasoning checkpoints and explicit user feedback:
${renderFeedback(batch)}

What this feedback just changed:
${changed.length > 0 ? changed.map(renderChange).join('\n') : '(no proposition wording or confidence changed)'}

The complete current user model:
${propositions.length > 0 ? propositions.map(renderProposition).join('\n') : '(empty)'}`
}
