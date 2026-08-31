import { describe, expect, test } from 'bun:test'

import { parseStudyMetricEventLines } from '@/app/study/metrics/parse'
import type { StudyMetricEvent } from '@/app/study/metrics/types'

const SAMPLE_EVENTS: StudyMetricEvent[] = [
  { type: 'session-started', at: '2026-08-31T09:00:00.000Z' },
  { type: 'session-ended', at: '2026-08-31T09:30:00.000Z' },
  { type: 'user-request', at: '2026-08-31T09:01:00.000Z', source: 'new-request', text: 'hero' },
  { type: 'mid-run-message', at: '2026-08-31T09:02:00.000Z', text: 'make it blue' },
  { type: 'feedback-note-created', at: '2026-08-31T09:03:00.000Z', noteId: 'n1', topic: 'color' },
  {
    type: 'feedback-note-answered',
    at: '2026-08-31T09:04:00.000Z',
    noteId: 'n1',
    feedbackItemCount: 2
  },
  { type: 'feedback-note-continued', at: '2026-08-31T09:05:00.000Z', noteId: 'n2' },
  {
    type: 'ask-user-question-asked',
    at: '2026-08-31T09:06:00.000Z',
    questionId: 'q1',
    requestId: 'r1',
    sequence: 1,
    question: 'Which tone?'
  },
  {
    type: 'ask-user-question-answered',
    at: '2026-08-31T09:07:00.000Z',
    questionId: 'q1',
    answer: 'Warm.',
    selectedOption: null
  },
  {
    type: 'ask-user-question-cancelled',
    at: '2026-08-31T09:08:00.000Z',
    questionId: 'q2',
    reason: 'request-stopped'
  },
  {
    type: 'reasoning-chunk-shown',
    at: '2026-08-31T09:09:00.000Z',
    reviewId: 'reasoning-1-1',
    streamId: 1,
    chunkIndex: 1
  },
  { type: 'reasoning-chunk-answered', at: '2026-08-31T09:10:00.000Z', reviewId: 'reasoning-1-1' },
  { type: 'reasoning-chunk-continued', at: '2026-08-31T09:11:00.000Z', reviewId: 'reasoning-1-2' }
]

describe('study metric event parsing', () => {
  test('round-trips every event kind through JSONL', () => {
    const text = SAMPLE_EVENTS.map((event) => JSON.stringify(event)).join('\n') + '\n'
    expect(parseStudyMetricEventLines(text)).toEqual(SAMPLE_EVENTS)
  })

  test('empty and blank input parses to no events', () => {
    expect(parseStudyMetricEventLines('')).toEqual([])
    expect(parseStudyMetricEventLines('\n  \n\n')).toEqual([])
  })

  test('a corrupt line is skipped without losing its neighbours', () => {
    const good = JSON.stringify(SAMPLE_EVENTS[0])
    const text = `${good}\n{"type":"session-ended","at":\n${JSON.stringify(SAMPLE_EVENTS[1])}\n`
    expect(parseStudyMetricEventLines(text)).toEqual([SAMPLE_EVENTS[0], SAMPLE_EVENTS[1]])
  })

  test('an unknown event type is dropped', () => {
    // Also covers legacy hands-off annotation lines in files written before
    // the annotation flow was removed.
    const text = `${JSON.stringify({ type: 'made-up-event', at: '2026-08-31T09:00:00.000Z' })}\n`
    expect(parseStudyMetricEventLines(text)).toEqual([])
  })

  test('an event without a timestamp is dropped', () => {
    const text = `${JSON.stringify({ type: 'session-started' })}\n`
    expect(parseStudyMetricEventLines(text)).toEqual([])
  })
})
