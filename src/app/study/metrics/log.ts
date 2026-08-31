import type { AskUserLifecycleEvent } from '@/app/study/ask-user/types'
import type { StudyMetricEventInput } from '@/app/study/metrics/types'
import { getStudyRuntime } from '@/app/study/runtime'
import { loadStoredParticipantId } from '@/app/study/survey/participant-storage'

export const STUDY_METRIC_EVENTS_ENDPOINT = '/__study-metric-events'

const enabled = import.meta.env?.DEV === true

let warnedMissingParticipantId = false
let pendingAppends: Promise<void> = Promise.resolve()

/**
 * Appends one study metric event to the participant's per-condition JSONL
 * file. Best-effort and fire-and-forget: a failed append never breaks a run.
 * No-ops outside the dev server or while no participant id is stored.
 */
export function logStudyMetricEvent(event: StudyMetricEventInput): void {
  if (!enabled) return
  const participantId = loadStoredParticipantId()
  if (!participantId) {
    if (!warnedMissingParticipantId) {
      warnedMissingParticipantId = true
      console.warn('[study-metrics] no participant id — study metric events are dropped')
    }
    return
  }
  const runtime = getStudyRuntime()
  const payload = JSON.stringify({
    participantId,
    host: runtime.host,
    condition: runtime.condition,
    event: { ...event, at: new Date().toISOString() }
  })
  // Chained so JSONL line order matches event order.
  pendingAppends = pendingAppends.then(() =>
    fetch(STUDY_METRIC_EVENTS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true
    })
      .then(() => undefined)
      .catch(() => {
        // Metric logging is best-effort; never surface a network hiccup.
      })
  )
}

/** Resolves once every event logged so far has been sent (or given up on). */
export function awaitStudyMetricEventsFlushed(): Promise<void> {
  return pendingAppends
}

/**
 * Second subscriber for the hosts' existing AskUserSession lifecycle streams.
 * Only the three user-facing moments become metric events; request-started and
 * question-rejected are internal bookkeeping.
 */
export function logFeedbackNoteCreatedMetric(noteId: string, topic: string): void {
  logStudyMetricEvent({ type: 'feedback-note-created', noteId, topic })
}

/** Zero feedback items means the note was continued without an answer. */
export function logFeedbackNoteOutcomeMetric(noteId: string, feedbackItemCount: number): void {
  if (feedbackItemCount > 0) {
    logStudyMetricEvent({ type: 'feedback-note-answered', noteId, feedbackItemCount })
    return
  }
  logStudyMetricEvent({ type: 'feedback-note-continued', noteId })
}

export function logAskUserLifecycleMetric(event: AskUserLifecycleEvent): void {
  if (event.type === 'question-asked') {
    logStudyMetricEvent({
      type: 'ask-user-question-asked',
      questionId: event.question.id,
      requestId: event.question.requestId,
      sequence: event.question.sequence,
      question: event.question.question
    })
    return
  }
  if (event.type === 'question-answered') {
    logStudyMetricEvent({
      type: 'ask-user-question-answered',
      questionId: event.question.id,
      answer: event.answer,
      selectedOption: event.selectedOption
    })
    return
  }
  if (event.type === 'question-cancelled') {
    logStudyMetricEvent({
      type: 'ask-user-question-cancelled',
      questionId: event.question.id,
      reason: event.reason
    })
  }
}
