import type { UserModelAskUserBatch } from '@/app/user-model/ask-user/types'
import type { Proposition } from '@/app/user-model/pipeline'
import type { ChangedProposition, ReviseNeighbour } from '@/app/user-model/prompt'

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

function renderAnswers(batch: UserModelAskUserBatch): string {
  return batch.answers
    .map((entry, index) => {
      const options = entry.question.options
        .map((option, optionIndex) => `    ${optionIndex + 1}. ${option}`)
        .join('\n')
      return (
        `${index + 1}. question: "${entry.question.question}"\n` +
        `  options shown:\n${options}\n` +
        `  selected option: ${entry.selectedOption ? `"${entry.selectedOption}"` : '(none)'}\n` +
        `  final answer: "${entry.answer}"`
      )
    })
    .join('\n\n')
}

export const FEEDBACK_SYSTEM_ASKUSER = `TASK

Update a user model from explicit answers to questions asked by a Task Agent. A user model is a set of reusable propositions about one person's task-relevant perspective.

WHAT COUNTS AS EVIDENCE

For each exchange you receive the Agent's question, three suggested options, the option the user selected, and the final answer they submitted.

- The question and all three options are framing supplied by the Agent. They are not evidence that the user believes any of them.
- The selected option and the final answer are user evidence. Read them together.
- The final answer is authoritative when it qualifies, narrows, or contradicts the selected option.
- Never treat an unselected option as a rejected preference unless the final answer explicitly says so.

HOW TO UPDATE

- If an answer confirms an existing proposition, keep its wording and raise confidence.
- If it adds a condition, constraint, or scope to the same underlying claim, refine the existing proposition while preserving every supported part of its meaning.
- If it contradicts an existing proposition, lower that proposition's confidence and create a replacement or contextual exception when the new claim is reusable.
- Create a new proposition only when the answer reveals a reusable perspective not already represented.
- Leave unrelated propositions out. A local answer that does not generalize may correctly produce no update.
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
- reasoning: one sentence explaining how the selected option and final answer support this operation.
- relation: confirmation | same_claim_refinement | contextual_exception | contradiction | new_claim.

Return ONLY a JSON array:
[{"id":"... or null","text":"...","confidence":8,"decay":3,"reasoning":"...","relation":"confirmation"}]`

export function feedbackAskUserPrompt(
  batch: UserModelAskUserBatch,
  propositions: ReviseNeighbour[]
): string {
  const held =
    propositions.length === 0
      ? '(none — the user model is empty)'
      : propositions.map(renderNeighbour).join('\n')
  return `Original request:
"${batch.request}"

Questions and user answers:
${renderAnswers(batch)}

Existing propositions retrieved from the user's evidence:
${held}`
}

export const RATIONALE_SYSTEM_ASKUSER = `TASK

Update proposition rationales from explicit ask_user answers. A proposition says WHAT the person prefers. Its rationale says WHY: the reason, goal, consequence, trade-off, or intended effect supported by the person's answer.

The Agent's question and suggested options are context, not user evidence. Ground every rationale in the user's final submitted answer. A selected option helps identify the chosen direction, but it does not supply a reason on its own.

Write or revise a rationale only when the final answer states a reason or makes one clearly inferable from the answer's own content. Reasons need not use words such as "because" or "so that". If several materially different reasons fit equally well, return no rationale for that proposition.

Do not change proposition text or confidence. Do not restate the proposition as its rationale. Do not use general domain knowledge to invent a benefit the user never supported.

For every rationale returned:
- id: the proposition id.
- rationale: the narrowest supported explanation of why it is true.
- purpose_evidence_quote: an exact, non-empty substring copied from one final answer. It need not contain a causal phrase.
- rationale_grounds: explain which answer and propositions make this rationale supported.
- rationale_from: ids of any other propositions read alongside it; may be empty.

Return ONLY a JSON array. Returning [] is correct when the answers reveal what but not why:
[{"id":"...","rationale":"...","purpose_evidence_quote":"exact answer substring","rationale_grounds":"...","rationale_from":[]}]`

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

export function rationaleAskUserPrompt(
  batch: UserModelAskUserBatch,
  changed: ChangedProposition[],
  propositions: Proposition[]
): string {
  return `Original request:
"${batch.request}"

Questions and user answers:
${renderAnswers(batch)}

What these answers just changed:
${changed.length > 0 ? changed.map(renderChange).join('\n') : '(no proposition wording or confidence changed)'}

The complete current user model:
${propositions.length > 0 ? propositions.map(renderProposition).join('\n') : '(empty)'}`
}
