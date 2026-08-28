import type { SavedProposition, UserModelDeps } from '@/app/user-model/pipeline'

/** Older stores and deterministic fixtures may predate embeddings. Fill only
 * the missing vectors so hosts can migrate to the shared retrieval pipeline
 * without replacing already persisted embedding state. */
export async function hydrateMissingPropositionEmbeddings<T extends SavedProposition>(
  propositions: T[],
  embed: UserModelDeps['embed']
): Promise<T[]> {
  const missing = propositions
    .map((proposition, index) => ({ proposition, index }))
    .filter(({ proposition }) => proposition.embedding.length === 0)
  const needsOriginal = propositions.some(
    (proposition) => !proposition.originalEmbedding?.length && proposition.embedding.length > 0
  )
  if (missing.length === 0 && !needsOriginal) return propositions

  const vectors =
    missing.length === 0 ? [] : await embed(missing.map(({ proposition }) => proposition.text))
  const hydrated = new Map<number, number[]>()
  for (const [vectorIndex, item] of missing.entries()) {
    hydrated.set(item.index, vectors.at(vectorIndex) ?? [])
  }

  return propositions.map((proposition, index) => {
    const embedding = hydrated.get(index) ?? proposition.embedding
    return {
      ...proposition,
      embedding,
      originalEmbedding: proposition.originalEmbedding?.length
        ? proposition.originalEmbedding
        : [...embedding]
    }
  })
}
