import type { StudyMetricEvent, StudyMetricEventType } from '@/app/study/metrics/types'

const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set<StudyMetricEventType>([
  'session-started',
  'session-ended',
  'user-request',
  'mid-run-message',
  'feedback-note-created',
  'feedback-note-answered',
  'feedback-note-continued',
  'ask-user-question-asked',
  'ask-user-question-answered',
  'ask-user-question-cancelled',
  'reasoning-chunk-shown',
  'reasoning-chunk-answered',
  'reasoning-chunk-continued'
])

interface RawStudyMetricEvent {
  type?: unknown
  at?: unknown
}

function isKnownEventType(value: unknown): value is StudyMetricEventType {
  return typeof value === 'string' && KNOWN_EVENT_TYPES.has(value)
}

/**
 * Parses the raw JSONL text of a participant's events file. Corrupt lines and
 * events with an unrecognised type are dropped with a warning instead of
 * failing the whole read — the summary must survive a partially damaged file.
 */
export function parseStudyMetricEventLines(text: string): StudyMetricEvent[] {
  const events: StudyMetricEvent[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let raw: RawStudyMetricEvent
    try {
      raw = JSON.parse(trimmed) as RawStudyMetricEvent
    } catch (error) {
      console.warn('[study-metrics] skipping corrupt event line:', error)
      continue
    }
    if (!isKnownEventType(raw.type) || typeof raw.at !== 'string') {
      console.warn('[study-metrics] skipping unrecognised event:', trimmed.slice(0, 120))
      continue
    }
    events.push(raw as StudyMetricEvent)
  }
  return events
}
