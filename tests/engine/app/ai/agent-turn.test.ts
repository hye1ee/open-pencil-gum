import { describe, expect, test } from 'bun:test'

import {
  abandonTurn,
  abandonTurnAtCommit,
  awaitTurnResume,
  currentTurnGeneration,
  pauseTurn,
  resumeTurn,
  setTurnRunning
} from '@/app/ai/chat/agent-turn'

describe('agent turn generation', () => {
  test('permanently rejects a stale stream after its replacement starts', async () => {
    setTurnRunning(true)
    const abandonedGeneration = currentTurnGeneration()

    // The old stream can still be waiting for Meta Agent review here, before
    // it has reached its final before-action gate.
    abandonTurn('test feedback retry')

    const replacementGeneration = currentTurnGeneration()
    setTurnRunning(true)

    expect(replacementGeneration).not.toBe(abandonedGeneration)
    expect(await awaitTurnResume('late old action', abandonedGeneration)).toBe(false)
    expect(await awaitTurnResume('replacement action', replacementGeneration)).toBe(true)

    setTurnRunning(false)
  })

  test('reviews later reasoning chunks before abandoning at the action boundary', async () => {
    setTurnRunning(true)
    const turnGeneration = currentTurnGeneration()
    pauseTurn('reasoning-review')
    const committed = abandonTurnAtCommit('test reasoning feedback')
    let didCommit = false
    void committed.then(() => {
      didCommit = true
    })

    expect(await awaitTurnResume('mid-thought', turnGeneration)).toBe(true)
    expect(await awaitTurnResume('mid-thought', turnGeneration)).toBe(true)
    expect(didCommit).toBe(false)

    const pendingAction = awaitTurnResume('before-action', turnGeneration)
    resumeTurn('reasoning-review')
    expect(await pendingAction).toBe(false)
    await committed
    expect(didCommit).toBe(true)
    expect(currentTurnGeneration()).not.toBe(turnGeneration)
    setTurnRunning(false)
  })

  test('preserves the Meta Agent feedback-note pause during reasoning', async () => {
    setTurnRunning(true)
    const turnGeneration = currentTurnGeneration()
    pauseTurn('feedback-note')

    let resumed = false
    const pendingChunk = awaitTurnResume('mid-thought', turnGeneration).then((allowed) => {
      resumed = true
      return allowed
    })
    await Promise.resolve()
    expect(resumed).toBe(false)

    resumeTurn('feedback-note')
    expect(await pendingChunk).toBe(true)
    setTurnRunning(false)
  })

  test('shares one commit boundary across multiple feedback items in the same step', async () => {
    setTurnRunning(true)
    const turnGeneration = currentTurnGeneration()
    const first = abandonTurnAtCommit('first feedback item')
    const second = abandonTurnAtCommit('second feedback item')

    expect(second).toBe(first)
    expect(await awaitTurnResume('before-action', turnGeneration)).toBe(false)
    await Promise.all([first, second])
    setTurnRunning(false)
  })
})
