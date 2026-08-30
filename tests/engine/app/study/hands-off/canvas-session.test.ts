import { describe, expect, test } from 'bun:test'

import { createHandsOffCanvasSession } from '@/app/study/hands-off/canvas-session'

function makeSession(stepNumber = 3) {
  const calls: string[] = []
  const session = createHandsOffCanvasSession({
    hold: () => calls.push('hold'),
    release: () => calls.push('release'),
    getCurrentStepNumber: () => stepNumber
  })
  return { session, calls }
}

describe('hands-off canvas session', () => {
  test('one hold covers a batch of reasoning cards and the last done card releases', () => {
    const { session, calls } = makeSession()
    session.beginRun('Create a card')
    session.observer.start(1)
    session.observer.chunk(1, 'Reasoning one.', 'Reasoning one.')
    session.observer.chunk(1, 'Reasoning two.', 'Reasoning one. Reasoning two.')
    expect(calls).toEqual(['hold'])
    expect(session.cards.value).toHaveLength(2)
    expect(session.cards.value[0]).toMatchObject({ stepNumber: 3, status: 'pending' })

    session.completeReasoningAnnotation(session.cards.value[0].id)
    expect(calls).toEqual(['hold'])
    session.completeReasoningAnnotation(session.cards.value[1].id)
    expect(calls).toEqual(['hold', 'release'])
  })

  test('reasoning annotations record but never release the hold', () => {
    const { session, calls } = makeSession()
    session.beginRun('Create a card')
    session.observer.start(1)
    session.observer.chunk(1, 'Reasoning one.', 'Reasoning one.')
    session.addReasoningAnnotation(session.cards.value[0].id, 'one', 10, 13, 'disliked')
    expect(session.annotations.value).toEqual([
      expect.objectContaining({
        phase: 'reasoning',
        streamId: 1,
        chunkIndex: 1,
        stepNumber: 3,
        polarity: 'disliked'
      })
    ])
    expect(calls).toEqual(['hold'])
  })

  test('a step action verdict holds until submitted, and skip counts as an answer', () => {
    const { session, calls } = makeSession()
    session.beginRun('Create a card')
    session.beginStepActionAnnotation(2, ['render'], ['node-a'])
    expect(calls).toEqual(['hold'])
    expect(session.pendingStepAction.value).toMatchObject({ stepNumber: 2, isFinalResponse: false })
    session.submitStepActionAnnotation('skipped')
    expect(calls).toEqual(['hold', 'release'])
    expect(session.pendingStepAction.value).toBeNull()
    expect(session.stepActionAnnotations.value).toEqual([
      expect.objectContaining({ stepNumber: 2, polarity: 'skipped' })
    ])
  })

  test('the final response verdict never holds the turn', () => {
    const { session, calls } = makeSession()
    session.beginRun('Create a card')
    session.beginFinalResponseAnnotation()
    expect(calls).toEqual([])
    session.submitStepActionAnnotation('liked')
    expect(calls).toEqual([])
    expect(session.stepActionAnnotations.value).toEqual([
      expect.objectContaining({ stepNumber: 0, polarity: 'liked' })
    ])
  })

  test('reset releases an active hold and clears all state', () => {
    const { session, calls } = makeSession()
    session.beginRun('Create a card')
    session.observer.start(1)
    session.observer.chunk(1, 'Reasoning one.', 'Reasoning one.')
    session.reset()
    expect(calls).toEqual(['hold', 'release'])
    expect(session.cards.value).toHaveLength(0)
    expect(session.pendingStepAction.value).toBeNull()
    expect(session.annotations.value).toHaveLength(0)
    expect(session.stepActionAnnotations.value).toHaveLength(0)
  })

  test('beginRun releases a hold left over from an abandoned run', () => {
    const { session, calls } = makeSession()
    session.observer.start(1)
    session.observer.chunk(1, 'Stale reasoning.', 'Stale reasoning.')
    session.beginRun('New request')
    expect(calls).toEqual(['hold', 'release'])
    expect(session.cards.value).toHaveLength(0)
  })
})
