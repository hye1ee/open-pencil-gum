import { koreanOutputInstruction } from '@/app/study/language'
import {
  renderChange,
  renderNeighbour,
  renderProposition
} from '@/app/user-model/ask-user/prompt'
import type { UserModelMidRunFeedbackBatch } from '@/app/user-model/mid-run-feedback/types'
import type { Proposition } from '@/app/user-model/pipeline'
import type { ChangedProposition, ReviseNeighbour } from '@/app/user-model/prompt'

function renderEvidence(batch: UserModelMidRunFeedbackBatch): string {
  const actions =
    batch.executedActions.length > 0
      ? batch.executedActions.map((action) => `  - ${action}`).join('\n')
      : '  (none yet)'
  const messages = batch.messages
    .map((message, index) => `${index + 1}. "${message}"`)
    .join('\n')
  return (
    `Original request:\n"${batch.request}"\n\n` +
    `The agent was at step ${batch.stepNumber}. Design actions it had executed so far ` +
    `(context only, not user evidence):\n${actions}\n\n` +
    `Messages the user sent while the agent was working:\n${messages}`
  )
}

export const FEEDBACK_SYSTEM_MID_RUN_FEEDBACK = `TASK

Update a user model from feedback the user sent on their own initiative while a Task Agent was executing their request. A user model is a set of reusable propositions about one person's task-relevant perspective.

WHAT COUNTS AS EVIDENCE

- Every message the user sent is direct user evidence, in their own words. There was no question or option framing from the Agent.
- The original request and the list of actions the agent had already executed are context. They tell you what the user was reacting to, but they are not evidence of what the user believes.
- A mid-run message often corrects or redirects something the agent just did. Read it against the executed actions to understand what perspective it reveals.

HOW TO UPDATE

- If a message confirms an existing proposition, keep its wording and raise confidence.
- If it adds a condition, constraint, or scope to the same underlying claim, refine the existing proposition while preserving every supported part of its meaning.
- If it contradicts an existing proposition, lower that proposition's confidence and create a replacement or contextual exception when the new claim is reusable.
- Create a new proposition only when the message reveals a reusable perspective not already represented.
- Leave unrelated propositions out. A purely local correction that does not generalize may correctly produce no update.
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
- reasoning: one sentence explaining how the user's message supports this operation.
- relation: confirmation | same_claim_refinement | contextual_exception | contradiction | new_claim.

Return ONLY a JSON array:
[{"id":"... or null","text":"...","confidence":8,"decay":3,"reasoning":"...","relation":"confirmation"}]${koreanOutputInstruction()}`

export function feedbackMidRunFeedbackPrompt(
  batch: UserModelMidRunFeedbackBatch,
  propositions: ReviseNeighbour[]
): string {
  const held =
    propositions.length === 0
      ? '(none — the user model is empty)'
      : propositions.map(renderNeighbour).join('\n')
  return `${renderEvidence(batch)}

Existing propositions retrieved from the user's evidence:
${held}`
}

export const RATIONALE_SYSTEM_MID_RUN_FEEDBACK = `TASK

Update proposition rationales from feedback the user sent while a Task Agent was executing. A proposition says WHAT the person prefers. Its rationale says WHY: the reason, goal, consequence, trade-off, or intended effect supported by the person's own words.

The original request and the agent's executed actions are context, not user evidence. Ground every rationale in the user's mid-run messages.

Write or revise a rationale only when a message states a reason or makes one clearly inferable from the message's own content. Reasons need not use words such as "because" or "so that". If several materially different reasons fit equally well, return no rationale for that proposition.

Do not change proposition text or confidence. Do not restate the proposition as its rationale. Do not use general domain knowledge to invent a benefit the user never supported.

For every rationale returned:
- id: the proposition id.
- rationale: the narrowest supported explanation of why it is true.
- purpose_evidence_quote: an exact, non-empty substring copied from one of the user's messages. It need not contain a causal phrase.
- rationale_grounds: explain which message and propositions make this rationale supported.
- rationale_from: ids of any other propositions read alongside it; may be empty.

Return ONLY a JSON array. Returning [] is correct when the messages reveal what but not why:
[{"id":"...","rationale":"...","purpose_evidence_quote":"exact message substring","rationale_grounds":"...","rationale_from":[]}]${koreanOutputInstruction()}`

export function rationaleMidRunFeedbackPrompt(
  batch: UserModelMidRunFeedbackBatch,
  changed: ChangedProposition[],
  propositions: Proposition[]
): string {
  return `${renderEvidence(batch)}

What these messages just changed:
${changed.length > 0 ? changed.map(renderChange).join('\n') : '(no proposition wording or confidence changed)'}

The complete current user model:
${propositions.length > 0 ? propositions.map(renderProposition).join('\n') : '(empty)'}`
}
