export interface ReasoningObserver {
  start(streamId: number): void
  chunk(streamId: number, reasoningChunk: string, reasoningSoFar: string): void
  end(streamId: number, reasoning: string): void
  settled(streamId: number): Promise<void>
}

/**
 * Used by study conditions that deliberately do not run the Meta Agent.
 * Keeping the same observer contract lets the provider stream stay shared
 * without accidentally invoking a host-specific monitor.
 */
export const NOOP_REASONING_OBSERVER: ReasoningObserver = {
  start: () => undefined,
  chunk: () => undefined,
  end: () => undefined,
  settled: async () => undefined
}

export interface ReasoningChunkReview<Context> {
  context: Context
  streamId: number
  chunkIndex: number
  reasoningChunk: string
  reasoningSoFar: string
}

export interface ReasoningStreamCompletion<Context> {
  context: Context
  streamId: number
  chunkCount: number
  reasoning: string
  pendingReviews: Promise<void>
}

interface SequencedReasoningObserverOptions<Context> {
  begin(streamId: number): Context
  review(input: ReasoningChunkReview<Context>): Promise<void> | void
  complete?(input: ReasoningStreamCompletion<Context>): Promise<void> | void
}

export interface SequencedReasoningObserver {
  observer: ReasoningObserver
  reset(): void
}

interface ReasoningStreamState<Context> {
  context: Context
  chunkCount: number
  settled: boolean
  task: Promise<void>
}

/**
 * Provider reasoning deltas are the shared review unit for every host. Reviews
 * run in arrival order, while each host supplies only its context and the work
 * performed for a chunk. Host-specific pause, retry, and UI behavior stays in
 * the hooks rather than becoming part of the Meta Agent core.
 */
export function createSequencedReasoningObserver<Context>(
  options: SequencedReasoningObserverOptions<Context>
): SequencedReasoningObserver {
  const streams = new Map<number, ReasoningStreamState<Context>>()
  const invalidatedStreams = new Set<number>()

  return {
    observer: {
      start: (streamId) => {
        if (invalidatedStreams.has(streamId)) return
        streams.set(streamId, {
          context: options.begin(streamId),
          chunkCount: 0,
          settled: false,
          task: Promise.resolve()
        })
      },
      chunk: (streamId, reasoningChunk, reasoningSoFar) => {
        const state = streams.get(streamId)
        if (!state || reasoningChunk.trim() === '') return
        state.chunkCount++
        const input: ReasoningChunkReview<Context> = {
          context: state.context,
          streamId,
          chunkIndex: state.chunkCount,
          reasoningChunk,
          reasoningSoFar
        }
        state.task = state.task.then(() => options.review(input))
      },
      end: (streamId, reasoning) => {
        const state = streams.get(streamId)
        if (!state || state.chunkCount === 0 || state.settled) return
        state.settled = true
        if (!options.complete) return
        state.task = Promise.resolve(
          options.complete({
            context: state.context,
            streamId,
            chunkCount: state.chunkCount,
            reasoning,
            pendingReviews: state.task
          })
        )
      },
      settled: (streamId) => streams.get(streamId)?.task ?? Promise.resolve()
    },
    reset: () => {
      for (const streamId of streams.keys()) invalidatedStreams.add(streamId)
      streams.clear()
    }
  }
}
