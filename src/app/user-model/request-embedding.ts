import { embeddingApiKey } from '@/app/ai/model-routing'
import { modelCalls } from '@/app/user-model/calls'

/**
 * Embeds the user's task request so the Task Agent selection can rank
 * propositions by relevance to it (see selectTaskAgentPropositionsByRelevance).
 * Null — no key, empty text, or a failed call — means the selection falls back
 * to confidence order; a run must never be blocked on this vector.
 */
export async function embedTaskRequest(text: string): Promise<number[] | null> {
  if (text.trim() === '' || embeddingApiKey() === '') return null
  try {
    const vectors = await modelCalls().embed([text])
    return vectors.at(0) ?? null
  } catch (error) {
    console.warn('[user-model] request embedding failed, selection falls back to confidence:', error)
    return null
  }
}
