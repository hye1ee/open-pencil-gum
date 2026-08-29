import { describe, expect, test } from 'bun:test'

import { createReasoningReviewSession } from '@/app/study/user-initiated/reasoning-review'

describe('user-initiated reasoning review', () => {
  test('holds the action boundary when the first reasoning card appears', () => {
    let holds = 0
    let releases = 0
    const session = createReasoningReviewSession({
      hold: () => {
        holds += 1
      },
      release: () => {
        releases += 1
      }
    })

    session.observer.start(7)
    session.observer.chunk(7, 'First decision.', 'First decision.')
    session.observer.chunk(7, '   ', 'First decision.   ')

    expect(holds).toBe(1)
    expect(session.hasPending()).toBe(true)
    expect(session.reviews.value).toEqual([
      expect.objectContaining({
        id: 'reasoning-7-1',
        streamId: 7,
        chunkIndex: 1,
        text: 'First decision.',
        status: 'pending'
      })
    ])

    expect(session.continueReview('reasoning-7-1')).toBe(true)
    expect(session.hasPending()).toBe(false)
    expect(releases).toBe(1)
    expect(session.reviews.value[0]?.status).toBe('continued')
  })

  test('uses one hold while multiple reasoning cards remain pending', () => {
    let holds = 0
    let releases = 0
    const session = createReasoningReviewSession({
      hold: () => {
        holds += 1
      },
      release: () => {
        releases += 1
      }
    })

    session.observer.start(11)
    session.observer.chunk(11, 'First decision.', 'First decision.')
    session.observer.chunk(11, 'Second decision.', 'First decision. Second decision.')

    expect(session.reviews.value).toHaveLength(2)
    expect(holds).toBe(1)

    session.continueReview('reasoning-11-1')
    expect(session.hasPending()).toBe(true)
    expect(releases).toBe(0)

    session.continueReview('reasoning-11-2')
    expect(session.hasPending()).toBe(false)
    expect(releases).toBe(1)
  })

  test('keeps reviewed cards and releases a pending hold when reset', () => {
    let releases = 0
    const session = createReasoningReviewSession({
      hold: () => undefined,
      release: () => {
        releases += 1
      }
    })

    session.observer.start(2)
    session.observer.chunk(2, 'One', 'One')
    session.continueReview('reasoning-2-1')
    session.observer.chunk(2, 'Two', 'OneTwo')

    expect(session.reviews.value.map((review) => review.status)).toEqual(['continued', 'pending'])

    session.reset()

    expect(session.reviews.value).toEqual([])
    expect(releases).toBe(2)
  })

  test('accepts feedback written from scratch without a reasoning selection', () => {
    let releases = 0
    const session = createReasoningReviewSession({
      hold: () => undefined,
      release: () => {
        releases += 1
      }
    })

    session.beginRequest('Plan a weekend trip.')
    session.observer.start(3)
    session.observer.chunk(
      3,
      'I will organize the itinerary around nightlife.',
      'I will organize the itinerary around nightlife.'
    )

    const outcome = session.submitFeedback(
      'reasoning-3-1',
      'Please prioritize quiet cultural activities instead.'
    )

    expect(outcome).toEqual({
      review: expect.objectContaining({
        request: 'Plan a weekend trip.',
        reasoningSoFar: 'I will organize the itinerary around nightlife.',
        status: 'answered'
      }),
      feedback: 'Please prioritize quiet cultural activities instead.',
      selectedReasoning: null
    })
    expect(releases).toBe(1)
  })

  test('records the selected reasoning passage with submitted feedback', () => {
    const session = createReasoningReviewSession({
      hold: () => undefined,
      release: () => undefined
    })

    session.beginRequest('Create a button.')
    session.observer.start(5)
    session.observer.chunk(
      5,
      'I will use a bright blue primary action.',
      'I will use a bright blue primary action.'
    )

    const outcome = session.submitFeedback(
      'reasoning-5-1',
      'Use a warm amber accent.',
      '  bright blue primary action  '
    )

    expect(outcome?.selectedReasoning).toBe('bright blue primary action')
    expect(session.reviews.value[0]?.status).toBe('answered')
  })

  test('does not create review cards while a silent retry is running', () => {
    let holds = 0
    const session = createReasoningReviewSession({
      hold: () => {
        holds += 1
      },
      release: () => undefined
    })

    session.beginRequest('Create a button.')
    session.setObserving(false)
    session.observer.start(8)
    session.observer.chunk(8, 'Replacement reasoning.', 'Replacement reasoning.')

    expect(session.reviews.value).toEqual([])
    expect(holds).toBe(0)
  })

  test('resumes review cards after the host replay boundary clears', () => {
    let replaying = true
    let holds = 0
    const session = createReasoningReviewSession({
      hold: () => {
        holds += 1
      },
      release: () => undefined,
      shouldObserve: () => !replaying
    })

    session.beginRequest('Create a button.')
    session.observer.start(9)
    session.observer.chunk(9, 'Repeated corrected-step reasoning.', 'Repeated corrected-step reasoning.')
    expect(session.reviews.value).toEqual([])

    replaying = false
    session.observer.start(10)
    session.observer.chunk(10, 'A decision from the following step.', 'A decision from the following step.')

    expect(session.reviews.value).toHaveLength(1)
    expect(session.reviews.value[0]?.text).toBe('A decision from the following step.')
    expect(holds).toBe(1)
  })
})
