import { describe, expect, test } from 'bun:test'

import {
  buildSurveySubmissionPayload,
  classifyPropositionChanges,
  expectedRatingKeys,
  ratingKey
} from '@/app/study/survey/classification'
import type { PropositionSnapshot, StudyBaselineFile } from '@/app/study/survey/types'

function snapshot(overrides: Partial<PropositionSnapshot> = {}): PropositionSnapshot {
  return {
    id: 'proposition-1',
    text: 'Prefers filled primary buttons.',
    confidence: 0.6,
    rationale: null,
    ...overrides
  }
}

describe('proposition change classification', () => {
  test('unchanged proposition is retention', () => {
    const [review] = classifyPropositionChanges([snapshot()], [snapshot()])
    expect(review).toMatchObject({ labels: ['retention'], removed: false })
  })

  test('text, confidence, and rationale changes stack as labels', () => {
    const [review] = classifyPropositionChanges(
      [snapshot()],
      [snapshot({ text: 'Prefers outlined buttons.', confidence: 0.8, rationale: 'Feels lighter.' })]
    )
    expect(review?.labels).toEqual(['refinement', 'recalibration', 'rationale'])
  })

  test('rationale null to value alone is only a rationale change', () => {
    const [review] = classifyPropositionChanges(
      [snapshot()],
      [snapshot({ rationale: 'Feels lighter.' })]
    )
    expect(review?.labels).toEqual(['rationale'])
  })

  test('a new proposition is expansion, plus rationale only when it has one', () => {
    const reviews = classifyPropositionChanges(
      [snapshot()],
      [
        snapshot(),
        snapshot({ id: 'new-plain', text: 'Enjoys teal accents.' }),
        snapshot({ id: 'new-reasoned', text: 'Avoids modals.', rationale: 'They interrupt flow.' })
      ]
    )
    expect(reviews.find((review) => review.id === 'new-plain')?.labels).toEqual(['expansion'])
    expect(reviews.find((review) => review.id === 'new-reasoned')?.labels).toEqual([
      'expansion',
      'rationale'
    ])
  })

  test('a baseline id missing from the current model becomes a removed row', () => {
    const [review] = classifyPropositionChanges([snapshot()], [])
    expect(review).toMatchObject({ removed: true, labels: [], current: null })
  })

  test('keeps baseline order and appends expansions at the end', () => {
    const reviews = classifyPropositionChanges(
      [snapshot({ id: 'first' }), snapshot({ id: 'second' })],
      [
        snapshot({ id: 'added', text: 'Something new.' }),
        snapshot({ id: 'second' }),
        snapshot({ id: 'first' })
      ]
    )
    expect(reviews.map((review) => review.id)).toEqual(['first', 'second', 'added'])
  })
})

describe('expected rating keys', () => {
  test('expands labels into metric keys plus the two whole-model keys', () => {
    const classified = classifyPropositionChanges(
      [snapshot()],
      [snapshot({ text: 'Changed wording.', confidence: 0.9 })]
    )
    const keys = expectedRatingKeys(classified)
    expect(keys).toEqual([
      ratingKey('proposition-1', 'refinement', 'accuracy'),
      ratingKey('proposition-1', 'refinement', 'depth'),
      ratingKey('proposition-1', 'recalibration', 'accuracy'),
      ratingKey('whole-model', 'overall', 'accuracy'),
      ratingKey('whole-model', 'overall', 'depth'),
      ratingKey('feedback-method', 'overall', 'tacit-knowledge-expression'),
      ratingKey('feedback-method', 'overall', 'mental-effort'),
      ratingKey('feedback-method', 'overall', 'want-awareness')
    ])
  })

  test('removed rows contribute only the shared whole-model and method keys', () => {
    const classified = classifyPropositionChanges([snapshot()], [])
    expect(expectedRatingKeys(classified)).toHaveLength(5)
  })
})

describe('survey submission payload', () => {
  const baseline: StudyBaselineFile = {
    participantId: 'p01',
    host: 'lenchat',
    condition: 'ask-user',
    savedAt: '2026-08-31T00:00:00.000Z',
    propositions: [snapshot()]
  }

  test('is self-contained and carries every rating with its wording', () => {
    const classified = classifyPropositionChanges(baseline.propositions, [
      snapshot({ rationale: 'Feels lighter.' })
    ])
    const answers = Object.fromEntries(expectedRatingKeys(classified).map((key) => [key, 6]))
    const payload = buildSurveySubmissionPayload({
      participantId: 'p01',
      baseline,
      classified,
      answers
    })
    expect(payload).toMatchObject({ participantId: 'p01', host: 'lenchat', condition: 'ask-user' })
    expect(payload.propositionReviews[0]?.ratings).toEqual([
      expect.objectContaining({
        label: 'rationale',
        metric: 'accuracy',
        value: 6,
        questionKorean: expect.stringContaining('rationale')
      }),
      expect.objectContaining({ label: 'rationale', metric: 'depth', value: 6 })
    ])
    expect(payload.propositionReviews[0]?.baseline).toEqual(snapshot())
    expect(payload.wholeModelRatings).toHaveLength(2)
    expect(payload.feedbackMethodRatings).toEqual([
      expect.objectContaining({ key: 'tacit-knowledge-expression', value: 6 }),
      expect.objectContaining({ key: 'mental-effort', value: 6 }),
      expect.objectContaining({ key: 'want-awareness', value: 6 })
    ])
  })

  test('throws when a rating is missing', () => {
    const classified = classifyPropositionChanges(baseline.propositions, [snapshot()])
    expect(() =>
      buildSurveySubmissionPayload({ participantId: 'p01', baseline, classified, answers: {} })
    ).toThrow('missing an answer')
  })
})
