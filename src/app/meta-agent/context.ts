import { shownToAgent } from '@/app/ai/chat/user-model-propositions'
import type { Proposition } from '@/app/meta-agent/core/types'
import type { SavedProposition } from '@/app/user-model/pipeline'

/** `shownToAgent` comes from the same function the building side filters with,
 * so the two can never disagree about what the agent was told. */
export function propositionsForRun(saved: readonly SavedProposition[]): Proposition[] {
  return saved.map((proposition) => ({
    id: proposition.id,
    text: proposition.text,
    confidence: proposition.confidence,
    rationale: proposition.rationale ?? null,
    shownToAgent: shownToAgent(proposition.confidence)
  }))
}
