import { isHandsOffDelegationCondition } from '@/app/study/runtime'
import type { StudyCondition } from '@/app/study/runtime'
import { cosine } from '@/app/user-model/pipeline'

/**
 * The user model's propositions, written out for the agents that build rather
 * than the one that judges.
 *
 * The judge has had this list since the meta-agent existed; the design agent
 * never did. So the judge knew a decision would go against this person while the
 * agent making that decision had no idea, and the Feedback Note only arrived
 * after the fact. This is the same list, addressed to the side that can still act on
 * it.
 *
 * Deliberately not the judge's rendering. That one carries proposition ids so a
 * Feedback Note can cite one; nothing here cites anything, and an id in text a person may
 * end up reading is noise.
 */

/** The fields this needs. `Proposition` from either half of the app fits. */
export interface UserModelProposition {
  text: string
  confidence: number
  rationale: string | null
}

/** Stored 0–1 like every other confidence here, shown out of ten. */
export function outOfTen(confidence: number): number {
  return Math.round(confidence * 9 + 1)
}

export const TASK_AGENT_PROPOSITION_LIMIT = 5

/**
 * The confidence fallback: top five by confidence. Hands-off receives
 * everything — that session evaluates the model itself, so nothing may be
 * withheld. Ties are common because confidence is quantized to ten levels;
 * within a tie the input order survives (stable sort). Sort a copy, never the
 * shared array.
 */
export function selectTaskAgentPropositions<T extends { confidence: number }>(
  propositions: readonly T[],
  condition: StudyCondition
): T[] {
  if (isHandsOffDelegationCondition(condition)) return [...propositions]
  return [...propositions]
    .sort((first, second) => second.confidence - first.confidence)
    .slice(0, TASK_AGENT_PROPOSITION_LIMIT)
}

/**
 * Which propositions the Task Agent is told, uniformly across the three
 * feedback conditions: the top five by embedding similarity to the user's
 * task request, so what goes in is what this task can actually use. No
 * similarity floor — the count stays at five so prompt size is uniform across
 * conditions, and the rendering header already frames weakly related items as
 * observations to ignore. Hands-off is the exception and receives everything.
 * A null request embedding (no key, or the call failed) falls back to the
 * confidence selection above rather than blocking the run.
 */
export function selectTaskAgentPropositionsByRelevance<
  T extends { confidence: number; embedding: number[] }
>(
  propositions: readonly T[],
  condition: StudyCondition,
  requestEmbedding: number[] | null
): T[] {
  if (isHandsOffDelegationCondition(condition)) return [...propositions]
  if (!requestEmbedding || requestEmbedding.length === 0) {
    return selectTaskAgentPropositions(propositions, condition)
  }
  return propositions
    .map((proposition) => ({
      proposition,
      similarity: cosine(requestEmbedding, proposition.embedding)
    }))
    .sort((first, second) => second.similarity - first.similarity)
    .slice(0, TASK_AGENT_PROPOSITION_LIMIT)
    .map((scored) => scored.proposition)
}

const HEADER = `# What we have observed about this person

You are building for one particular person. The list below is what we have
noticed about how they work — gathered from their canvas over earlier sessions,
and from what they said on the occasions they disagreed with something an agent
was about to do. These are observations, not instructions.

Each line is one observation. The number after it is how much evidence stands
behind it, out of ten. A low number means we have seen it once, or have seen it
fail since; it is weak evidence, not an instruction to do the opposite. A
\`why:\` line is our reading of what that preference gets them — use it when the
observation itself does not settle the case in front of you.

What to do with it:

- **What they asked for wins.** When the request goes against an observation, do
  what was asked. The list describes other days; the request describes this one.
- **Use it on the choices the request leaves open.** Most of a build is decided
  by nobody — spacing, whether a section opens with a heading, how many accent
  colours there are. Those are the decisions this list is for.
- **Where the list is silent, decide as you otherwise would.** Do not stretch an
  observation to cover a decision it does not speak to.
- **Do not talk about it.** Do not mention the observations, do not explain that
  you are following one, and do not ask them to confirm one. This is background
  you were handed, not a subject to raise.`

const ASK_USER_TOOL_EXCEPTION = `- **The ask_user tool is the exception to the last rule.** Asking about the
  current task's open decisions is part of this task — but even there, never ask
  them to confirm an observation from this list.`

export interface RenderUserModelPropositionsOptions {
  askUserToolAvailable?: boolean
}

/**
 * Renders an already-selected list (see selectTaskAgentPropositions — no
 * filtering happens here). `null` when there is nothing to say, so the caller
 * can leave the block out entirely. A heading followed by an empty list spends
 * tokens telling the agent that we know nothing, which it can assume.
 */
export function renderUserModelPropositions(
  propositions: readonly UserModelProposition[],
  options: RenderUserModelPropositionsOptions = {}
): string | null {
  if (propositions.length === 0) return null
  const header = options.askUserToolAvailable ? `${HEADER}\n${ASK_USER_TOOL_EXCEPTION}` : HEADER
  const lines = propositions.map((proposition) => {
    const head = `- ${proposition.text} (${outOfTen(proposition.confidence)}/10)`
    // Only where there is one. A "why: —" under every line is a column of
    // dashes, and this list goes into a prompt that is cached and re-sent.
    return proposition.rationale === null ? head : `${head}\n    why: ${proposition.rationale}`
  })
  return `${header}\n\n${lines.join('\n')}`
}
