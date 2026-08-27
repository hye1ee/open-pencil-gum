import { describe, expect, test } from 'bun:test'

import {
  abandonTurn,
  awaitTurnResume,
  currentTurnGeneration,
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
})
