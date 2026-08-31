import {
  STUDY_METRIC_EVENTS_ENDPOINT,
  awaitStudyMetricEventsFlushed,
  logStudyMetricEvent
} from '@/app/study/metrics/log'
import { parseStudyMetricEventLines } from '@/app/study/metrics/parse'
import { computeStudyMetricsSummary } from '@/app/study/metrics/summary'
import type { StudyMetricEvent, StudyMetricsSummary } from '@/app/study/metrics/types'
import { getStudyRuntime } from '@/app/study/runtime'
import type { StudyCondition, StudyHost } from '@/app/study/runtime'
import { loadStoredParticipantId } from '@/app/study/survey/participant-storage'

const SUMMARY_ENDPOINT = '/__study-metric-summary'

export async function fetchStudyMetricEvents(
  participantId: string,
  host: StudyHost,
  condition: StudyCondition
): Promise<StudyMetricEvent[]> {
  const query = new URLSearchParams({ participant: participantId, host, condition })
  const response = await fetch(`${STUDY_METRIC_EVENTS_ENDPOINT}?${query.toString()}`)
  if (response.status === 404) return []
  if (!response.ok) throw new Error(`Study metric events fetch failed (${response.status}).`)
  return parseStudyMetricEventLines(await response.text())
}

export async function saveStudyMetricsSummary(summary: StudyMetricsSummary): Promise<void> {
  const response = await fetch(SUMMARY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(summary, null, 2)
  })
  if (!response.ok) throw new Error(`Study metrics summary save failed (${response.status}).`)
}

/**
 * End-session finalizer: marks the session ended, reads the whole events file
 * back, and writes the aggregate summary as a timestamped JSON beside it.
 * Never throws — a metrics failure must not block the survey overlay.
 */
export async function finalizeStudyMetricsSession(): Promise<void> {
  try {
    const participantId = loadStoredParticipantId()
    if (!participantId) return
    const runtime = getStudyRuntime()
    const endedAt = new Date().toISOString()
    logStudyMetricEvent({ type: 'session-ended' })
    await awaitStudyMetricEventsFlushed()
    const events = await fetchStudyMetricEvents(participantId, runtime.host, runtime.condition)
    const summary = computeStudyMetricsSummary({
      participantId,
      host: runtime.host,
      condition: runtime.condition,
      events,
      endedAt
    })
    await saveStudyMetricsSummary(summary)
  } catch (error) {
    console.warn('[study-metrics] end-session summary failed:', error)
  }
}
