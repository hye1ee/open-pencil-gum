import type { Proposition } from '@/app/meta-agent/core/types'
import type { SavedProposition } from '@/app/user-model/pipeline'

/** `shownToAgent` is derived from the id set the Task Agent was actually given
 * (see selectTaskAgentPropositions), so the flag can never disagree with what
 * the agent was told. */
export function propositionsForRun(
  saved: readonly SavedProposition[],
  selectedIds: ReadonlySet<string>
): Proposition[] {
  return saved.map((proposition) => ({
    id: proposition.id,
    text: proposition.text,
    confidence: proposition.confidence,
    rationale: proposition.rationale ?? null,
    shownToAgent: selectedIds.has(proposition.id)
  }))
}
