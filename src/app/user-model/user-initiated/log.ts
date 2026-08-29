import { logUserModelStage } from '@/app/ai/chat/agent-log'
import type { UserInitiatedRetrievalTrace } from '@/app/user-model/user-initiated/types'

export function logUserInitiatedRetrieval(trace: UserInitiatedRetrievalTrace): void {
  for (const item of trace.items) {
    const candidates =
      item.embedding
        .map((candidate) => `${candidate.id}:${candidate.score.toFixed(3)}`)
        .join(', ') || '(none above threshold)'
    logUserModelStage('retrieval', `user-initiated ${item.reviewId} embedding → ${candidates}`)
  }
  logUserModelStage(
    'retrieval',
    `shown-to-user-initiated-model → ${trace.shownIds.join(', ') || '(none)'}`
  )
}
