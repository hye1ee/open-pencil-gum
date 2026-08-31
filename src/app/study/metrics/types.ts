import type { StudyCondition, StudyHost } from '@/app/study/runtime'

export type StudyMetricUserRequestSource = 'new-request' | 'continue-run'

/**
 * One study measurement, before the client logger stamps its timestamp. Call
 * sites build these; `StudyMetricEvent` (with `at`) is what lands in the
 * participant's per-condition JSONL file. Counts must tally events, never
 * unique ids: in-memory id counters (note ids, chunk indexes) restart on a
 * mid-session page refresh, so ids can repeat inside one session window.
 */
export type StudyMetricEventInput =
  | { type: 'session-started' }
  | { type: 'session-ended' }
  | { type: 'user-request'; source: StudyMetricUserRequestSource; text: string }
  | { type: 'mid-run-message'; text: string }
  | { type: 'feedback-note-created'; noteId: string; topic: string }
  | { type: 'feedback-note-answered'; noteId: string; feedbackItemCount: number }
  | { type: 'feedback-note-continued'; noteId: string }
  | {
      type: 'ask-user-question-asked'
      questionId: string
      requestId: string
      sequence: number
      question: string
    }
  | {
      type: 'ask-user-question-answered'
      questionId: string
      answer: string
      selectedOption: string | null
    }
  | { type: 'ask-user-question-cancelled'; questionId: string; reason: string }
  | { type: 'reasoning-chunk-shown'; reviewId: string; streamId: number; chunkIndex: number }
  | { type: 'reasoning-chunk-answered'; reviewId: string }
  | { type: 'reasoning-chunk-continued'; reviewId: string }

/** The stored form: the input plus the ISO timestamp the logger stamped. */
export type StudyMetricEvent = StudyMetricEventInput & { at: string }

export type StudyMetricEventType = StudyMetricEvent['type']

export interface StudyMetricsSummaryCommon {
  participantId: string
  host: StudyHost
  condition: StudyCondition
  /** null when no session-started marker exists — the whole file was counted. */
  sessionStartedAt: string | null
  sessionEndedAt: string
  totalUserRequests: number
  /** Subset of totalUserRequests submitted via "Continue where you left off". */
  continueRunRequests: number
  /** Informational in every condition; feeds feedback math only in ask-user. */
  midRunMessageCount: number
}

export interface StudyFeedbackTotals {
  feedbackOpportunities: number
  feedbackLeft: number
  feedbackSkipped: number
}

export type StudyMetricsSummary =
  | (StudyMetricsSummaryCommon &
      StudyFeedbackTotals & {
        condition: 'userlens'
        feedbackNotesCreated: number
        feedbackNotesAnswered: number
        feedbackNotesExplicitlyContinued: number
      })
  | (StudyMetricsSummaryCommon &
      StudyFeedbackTotals & {
        condition: 'ask-user'
        questionsAsked: number
        questionsAnswered: number
        questionsCancelled: number
      })
  | (StudyMetricsSummaryCommon &
      StudyFeedbackTotals & {
        condition: 'user-initiated'
        reasoningChunksShown: number
        reasoningChunksAnswered: number
        reasoningChunksContinued: number
      })
  | (StudyMetricsSummaryCommon & { condition: 'hands-off' })
