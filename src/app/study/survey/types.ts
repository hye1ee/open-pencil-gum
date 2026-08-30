import type { Proposition } from '@/app/user-model/pipeline'
import type { StudyCondition, StudyHost } from '@/app/study/runtime'

export type PropositionChangeLabel =
  | 'expansion'
  | 'refinement'
  | 'recalibration'
  | 'rationale'
  | 'retention'

export type SurveyRatingMetric = 'accuracy' | 'depth'

/** The fields the survey compares and shows; embeddings and bookkeeping stay
 * out of the baseline file. */
export interface PropositionSnapshot {
  id: string
  text: string
  confidence: number
  rationale: string | null
}

export function snapshotProposition(proposition: Proposition): PropositionSnapshot {
  return {
    id: proposition.id,
    text: proposition.text,
    confidence: proposition.confidence,
    rationale: proposition.rationale
  }
}

export interface ClassifiedProposition {
  id: string
  labels: PropositionChangeLabel[]
  /** Present in the baseline but gone from the current model — informational
   * row only, not expected to occur (the pipeline retires by confidence). */
  removed: boolean
  baseline: PropositionSnapshot | null
  current: PropositionSnapshot | null
}

/** Saved at the moment the external user model is injected (or fixtures are
 * seeded); the survey diffs the end-of-session model against this file. */
export interface StudyBaselineFile {
  participantId: string
  host: StudyHost
  condition: StudyCondition
  savedAt: string
  propositions: PropositionSnapshot[]
}

export interface SurveyRatingAnswer {
  label: PropositionChangeLabel
  metric: SurveyRatingMetric
  questionKorean: string
  value: number
}

export interface SurveyPropositionReview {
  propositionId: string
  labels: PropositionChangeLabel[]
  removed: boolean
  baseline: PropositionSnapshot | null
  current: PropositionSnapshot | null
  ratings: SurveyRatingAnswer[]
}

export interface SurveyWholeModelRating {
  metric: SurveyRatingMetric
  questionKorean: string
  value: number
}

export interface SurveyFeedbackMethodRating {
  key: string
  questionKorean: string
  value: number
}

export interface StudySurveySubmission {
  participantId: string
  host: StudyHost
  condition: StudyCondition
  baselineSavedAt: string
  submittedAt: string
  propositionReviews: SurveyPropositionReview[]
  wholeModelRatings: SurveyWholeModelRating[]
  feedbackMethodRatings: SurveyFeedbackMethodRating[]
}
