import { describe, expect, test } from 'bun:test'

import { computeStudyMetricsSummary } from '@/app/study/metrics/summary'
import type { StudyMetricEvent } from '@/app/study/metrics/types'
import type { StudyCondition } from '@/app/study/runtime'

const AT = '2026-08-31T09:00:00.000Z'
const ENDED_AT = '2026-08-31T10:00:00.000Z'

function summarize(condition: StudyCondition, events: StudyMetricEvent[]) {
  return computeStudyMetricsSummary({
    participantId: 'p1',
    host: 'lenchat',
    condition,
    events,
    endedAt: ENDED_AT
  })
}

function noteCreated(noteId: string): StudyMetricEvent {
  return { type: 'feedback-note-created', at: AT, noteId, topic: 'topic' }
}

function questionAsked(questionId: string): StudyMetricEvent {
  return {
    type: 'ask-user-question-asked',
    at: AT,
    questionId,
    requestId: 'r1',
    sequence: 1,
    question: 'Which tone?'
  }
}

function chunkShown(reviewId: string): StudyMetricEvent {
  return { type: 'reasoning-chunk-shown', at: AT, reviewId, streamId: 1, chunkIndex: 1 }
}

describe('study metrics summary', () => {
  test('userlens derives skipped from created minus answered', () => {
    const summary = summarize('userlens', [
      { type: 'session-started', at: AT },
      noteCreated('n1'),
      noteCreated('n2'),
      noteCreated('n3'),
      { type: 'feedback-note-answered', at: AT, noteId: 'n1', feedbackItemCount: 2 },
      { type: 'feedback-note-answered', at: AT, noteId: 'n2', feedbackItemCount: 1 },
      { type: 'feedback-note-continued', at: AT, noteId: 'n3' }
    ])
    expect(summary).toMatchObject({
      condition: 'userlens',
      feedbackNotesCreated: 3,
      feedbackNotesAnswered: 2,
      feedbackNotesExplicitlyContinued: 1,
      feedbackOpportunities: 3,
      feedbackLeft: 2,
      feedbackSkipped: 1
    })
  })

  test('ask-user counts mid-run messages as opportunity and feedback at once', () => {
    const summary = summarize('ask-user', [
      { type: 'session-started', at: AT },
      questionAsked('q1'),
      questionAsked('q2'),
      { type: 'ask-user-question-answered', at: AT, questionId: 'q1', answer: 'Warm.', selectedOption: null },
      { type: 'ask-user-question-cancelled', at: AT, questionId: 'q2', reason: 'request-stopped' },
      { type: 'mid-run-message', at: AT, text: 'more contrast' },
      { type: 'mid-run-message', at: AT, text: 'smaller title' }
    ])
    expect(summary).toMatchObject({
      condition: 'ask-user',
      questionsAsked: 2,
      questionsAnswered: 1,
      questionsCancelled: 1,
      midRunMessageCount: 2,
      feedbackOpportunities: 4,
      feedbackLeft: 3,
      feedbackSkipped: 1
    })
  })

  test('user-initiated counts continued and ignored chunks as skipped', () => {
    const summary = summarize('user-initiated', [
      { type: 'session-started', at: AT },
      chunkShown('reasoning-1-1'),
      chunkShown('reasoning-1-2'),
      chunkShown('reasoning-1-3'),
      chunkShown('reasoning-1-4'),
      chunkShown('reasoning-1-5'),
      { type: 'reasoning-chunk-answered', at: AT, reviewId: 'reasoning-1-1' },
      { type: 'reasoning-chunk-answered', at: AT, reviewId: 'reasoning-1-2' },
      { type: 'reasoning-chunk-continued', at: AT, reviewId: 'reasoning-1-3' },
      { type: 'reasoning-chunk-continued', at: AT, reviewId: 'reasoning-1-4' }
    ])
    expect(summary).toMatchObject({
      condition: 'user-initiated',
      reasoningChunksShown: 5,
      reasoningChunksAnswered: 2,
      reasoningChunksContinued: 2,
      feedbackOpportunities: 5,
      feedbackLeft: 2,
      feedbackSkipped: 3
    })
  })

  test('hands-off reports only the common counters', () => {
    const summary = summarize('hands-off', [
      { type: 'session-started', at: AT },
      { type: 'user-request', at: AT, source: 'new-request', text: 'hero' }
    ])
    expect(summary).toMatchObject({ condition: 'hands-off', totalUserRequests: 1 })
    expect('feedbackOpportunities' in summary).toBe(false)
    expect('reasoningAnnotationsLiked' in summary).toBe(false)
  })

  test('only events at and after the last session-started marker count', () => {
    const summary = summarize('userlens', [
      { type: 'session-started', at: '2026-08-31T08:00:00.000Z' },
      noteCreated('stale'),
      { type: 'session-started', at: AT },
      noteCreated('n1')
    ])
    expect(summary).toMatchObject({
      sessionStartedAt: AT,
      feedbackNotesCreated: 1
    })
  })

  test('without a marker the whole file counts and sessionStartedAt is null', () => {
    const summary = summarize('userlens', [noteCreated('n1'), noteCreated('n2')])
    expect(summary).toMatchObject({ sessionStartedAt: null, feedbackNotesCreated: 2 })
  })

  test('continue-run requests are counted in total and reported separately', () => {
    const summary = summarize('userlens', [
      { type: 'user-request', at: AT, source: 'new-request', text: 'hero' },
      { type: 'user-request', at: AT, source: 'new-request', text: 'footer' },
      { type: 'user-request', at: AT, source: 'continue-run', text: 'Continue where you left off' }
    ])
    expect(summary).toMatchObject({ totalUserRequests: 3, continueRunRequests: 1 })
  })

  test('mid-run messages stay out of feedback math outside ask-user', () => {
    const summary = summarize('userlens', [
      noteCreated('n1'),
      { type: 'mid-run-message', at: AT, text: 'more contrast' }
    ])
    expect(summary).toMatchObject({
      midRunMessageCount: 1,
      feedbackOpportunities: 1,
      feedbackLeft: 0
    })
  })

  test('skipped never goes negative', () => {
    const summary = summarize('userlens', [
      { type: 'feedback-note-answered', at: AT, noteId: 'n1', feedbackItemCount: 1 }
    ])
    expect(summary).toMatchObject({ feedbackOpportunities: 0, feedbackLeft: 1, feedbackSkipped: 0 })
  })
})
