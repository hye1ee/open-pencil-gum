import type { Proposition } from '@/app/meta-agent/judge'

export const PROPOSITION_COMPARISON_SYSTEM = `TASK

Read one completed block of a task agent's reasoning. First extract its independently assessable propositions without consulting the user model. Only after extraction is complete, link each task-agent proposition to every user-model proposition that makes the same claim or a directly opposing claim.

TASK-AGENT PROPOSITIONS

- Write each proposition as one concise, independently assessable claim. Do not impose a word count.
- Preserve the task agent as the subject. Describe what it intends, assumes, prioritizes, chooses, or rules out.
- Copy one short clause from the reasoning as evidence. It must appear verbatim in REASONING.
- Do not extract status reports, tool preparation, node or id lookup, error recovery, praise, or a sentence that merely repeats the user's request.
- Do not omit a proposition because the current user model may not cover it. Coverage and relationship are determined only after extraction is complete.
- Keep modifiers that form one decision together. For example, a solid indigo background with white text is one visual treatment.
- Split decisions that can vary independently. Color, placement, corner shape, spacing, information structure, and work order are separate propositions when the reasoning decides each one.
- Do not split one claim merely to produce more propositions.
- Return at most 5 propositions. If more than 5 exist, keep those that affect the largest scope of the task. Do not otherwise prefer fewer. Return none when the reasoning contains no independently assessable claim.

This follows the user-model proposition policy only in keeping repeated or overlapping statements as one proposition and excluding incidental wording from the claim. Extraction itself is independent of the user model supplied below.

LINKS

- Begin linking only after the complete task-agent proposition list has been extracted.
- A task-agent proposition may link to zero, one, or several user-model propositions.
- Create an alignment link only when both propositions make materially the same claim in this context.
- Create a conflict link only when the task-agent proposition directly opposes what the user-model proposition claims in this context.
- Shared vocabulary or a nearby topic is not enough.
- Do not use confidence to decide whether a semantic link exists. Confidence is evidence strength, not semantic relevance.
- Do not force a link. A task-agent proposition with no links is uncovered.
- Use only ids supplied in TASK-AGENT PROPOSITIONS and USER MODEL.

Call record_proposition_comparison exactly once. Return no prose.`

function renderPropositions(propositions: readonly Proposition[]): string {
  if (propositions.length === 0) return '(none)'
  return propositions
    .map((proposition) => {
      const confidence = (proposition.confidence * 9 + 1).toFixed(0)
      const rationale = proposition.rationale ? `\n  why: ${proposition.rationale}` : ''
      return `- ${proposition.id}: "${proposition.text}" (${confidence}/10)${rationale}`
    })
    .join('\n')
}

export function renderPropositionComparisonPrompt(input: {
  request: string
  reasoning: string
  propositions: readonly Proposition[]
}): string {
  return `USER REQUEST
${input.request || '(continuing earlier work)'}

USER MODEL
${renderPropositions(input.propositions)}

REASONING
${input.reasoning}`
}
