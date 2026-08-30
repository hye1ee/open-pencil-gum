import { hydrateMissingPropositionEmbeddings } from '@/app/user-model/embeddings'
import type { Proposition, UserModelDeps } from '@/app/user-model/pipeline'

export async function hydrateUserModelReplacement(
  items: readonly Proposition[],
  embed: UserModelDeps['embed'],
  onError: (error: unknown) => void
): Promise<Proposition[]> {
  const next = items.map((item) => structuredClone(item))
  try {
    return await hydrateMissingPropositionEmbeddings(next, embed)
  } catch (error) {
    onError(error)
    return next
  }
}
