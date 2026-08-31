import type {
  StudyFeedbackTotals,
  StudyMetricEvent,
  StudyMetricEventType,
  StudyMetricsSummary,
  StudyMetricsSummaryCommon
} from '@/app/study/metrics/types'
import type { StudyCondition, StudyHost } from '@/app/study/runtime'

export interface StudyMetricsSummaryInput {
  participantId: string
  host: StudyHost
  condition: StudyCondition
  events: readonly StudyMetricEvent[]
  endedAt: string
}

type EventOfType<Type extends StudyMetricEventType> = Extract<StudyMetricEvent, { type: Type }>

function eventsOfType<Type extends StudyMetricEventType>(
  events: readonly StudyMetricEvent[],
  type: Type
): EventOfType<Type>[] {
  return events.filter((event): event is EventOfType<Type> => event.type === type)
}

function countEvents(events: readonly StudyMetricEvent[], type: StudyMetricEventType): number {
  return events.reduce((total, event) => (event.type === type ? total + 1 : total), 0)
}

function feedbackTotals(opportunities: number, left: number): StudyFeedbackTotals {
  return {
    feedbackOpportunities: opportunities,
    feedbackLeft: left,
    feedbackSkipped: Math.max(0, opportunities - left)
  }
}

/**
 * Tallies one participant×host×condition session. The window is everything at
 * and after the LAST session-started marker (a re-injection restarts the
 * session; a mid-session refresh does not re-log the marker, so pre-refresh
 * events stay inside the window). With no marker the whole file counts and
 * sessionStartedAt stays null.
 */
export function computeStudyMetricsSummary(input: StudyMetricsSummaryInput): StudyMetricsSummary {
  let sessionStartedAt: string | null = null
  let windowed: readonly StudyMetricEvent[] = input.events
  for (let index = input.events.length - 1; index >= 0; index -= 1) {
    const event = input.events[index]
    if (event.type === 'session-started') {
      sessionStartedAt = event.at
      windowed = input.events.slice(index)
      break
    }
  }

  const userRequests = eventsOfType(windowed, 'user-request')
  const midRunMessageCount = countEvents(windowed, 'mid-run-message')
  const common: StudyMetricsSummaryCommon = {
    participantId: input.participantId,
    host: input.host,
    condition: input.condition,
    sessionStartedAt,
    sessionEndedAt: input.endedAt,
    totalUserRequests: userRequests.length,
    continueRunRequests: userRequests.filter((event) => event.source === 'continue-run').length,
    midRunMessageCount
  }

  if (input.condition === 'userlens') {
    const created = countEvents(windowed, 'feedback-note-created')
    const answered = countEvents(windowed, 'feedback-note-answered')
    return {
      ...common,
      condition: 'userlens',
      feedbackNotesCreated: created,
      feedbackNotesAnswered: answered,
      feedbackNotesExplicitlyContinued: countEvents(windowed, 'feedback-note-continued'),
      ...feedbackTotals(created, answered)
    }
  }

  if (input.condition === 'ask-user') {
    const asked = countEvents(windowed, 'ask-user-question-asked')
    const answered = countEvents(windowed, 'ask-user-question-answered')
    return {
      ...common,
      condition: 'ask-user',
      questionsAsked: asked,
      questionsAnswered: answered,
      questionsCancelled: countEvents(windowed, 'ask-user-question-cancelled'),
      // A mid-run message is feedback the user chose to leave, so it counts as
      // both an opportunity and feedback left.
      ...feedbackTotals(asked + midRunMessageCount, answered + midRunMessageCount)
    }
  }

  if (input.condition === 'user-initiated') {
    const shown = countEvents(windowed, 'reasoning-chunk-shown')
    const answered = countEvents(windowed, 'reasoning-chunk-answered')
    return {
      ...common,
      condition: 'user-initiated',
      reasoningChunksShown: shown,
      reasoningChunksAnswered: answered,
      reasoningChunksContinued: countEvents(windowed, 'reasoning-chunk-continued'),
      ...feedbackTotals(shown, answered)
    }
  }

  // hands-off: outputs are rated through the per-run output survey (stored as
  // its own files), so the metric summary carries only the common counters.
  return { ...common, condition: 'hands-off' }
}
