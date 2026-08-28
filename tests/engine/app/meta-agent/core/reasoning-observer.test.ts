import { describe, expect, test } from 'bun:test'

import { createSequencedReasoningObserver } from '@/app/meta-agent/core/reasoning-observer'

describe('sequenced Meta Agent reasoning observer', () => {
  test('reviews each non-empty provider delta in order', async () => {
    const reviewed: Array<{ chunk: number; text: string; accumulated: string }> = []
    const controller = createSequencedReasoningObserver({
      begin: (streamId) => ({ streamId }),
      review: ({ chunkIndex, reasoningChunk, reasoningSoFar }) => {
        reviewed.push({
          chunk: chunkIndex,
          text: reasoningChunk,
          accumulated: reasoningSoFar
        })
      }
    })

    controller.observer.start(7)
    controller.observer.chunk(7, 'First decision.', 'First decision.')
    controller.observer.chunk(7, '   ', 'First decision.   ')
    controller.observer.chunk(7, 'Second decision.', 'First decision. Second decision.')
    controller.observer.end(7, 'First decision. Second decision.')
    await controller.observer.settled(7)

    expect(reviewed).toEqual([
      { chunk: 1, text: 'First decision.', accumulated: 'First decision.' },
      {
        chunk: 2,
        text: 'Second decision.',
        accumulated: 'First decision. Second decision.'
      }
    ])
  })

  test('lets a host settle only after every queued review finishes', async () => {
    const order: string[] = []
    const controller = createSequencedReasoningObserver({
      begin: () => 'host context',
      review: async ({ reasoningChunk }) => {
        order.push(`review:${reasoningChunk}`)
      },
      complete: async ({ context, pendingReviews }) => {
        order.push(`complete:${context}`)
        await pendingReviews
        order.push('settled')
      }
    })

    controller.observer.start(1)
    controller.observer.chunk(1, 'one', 'one')
    controller.observer.chunk(1, 'two', 'onetwo')
    controller.observer.end(1, 'onetwo')
    await controller.observer.settled(1)

    expect(order).toEqual(['complete:host context', 'review:one', 'review:two', 'settled'])
  })

  test('invalidates streams that belonged to a reset turn', async () => {
    const reviewed: string[] = []
    const controller = createSequencedReasoningObserver({
      begin: () => null,
      review: ({ reasoningChunk }) => {
        reviewed.push(reasoningChunk)
      }
    })

    controller.observer.start(1)
    controller.reset()
    controller.observer.chunk(1, 'stale', 'stale')
    controller.observer.start(1)
    controller.observer.chunk(1, 'still stale', 'still stale')
    controller.observer.start(2)
    controller.observer.chunk(2, 'current', 'current')
    controller.observer.end(2, 'current')
    await controller.observer.settled(2)

    expect(reviewed).toEqual(['current'])
  })
})
