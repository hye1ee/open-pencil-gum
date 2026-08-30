import {
  FEEDBACK_METHOD_QUESTIONS,
  PROPOSITION_QUESTIONS_BY_LABEL,
  WHOLE_MODEL_QUESTIONS
} from '@/app/study/survey/questions'
import type {
  ClassifiedProposition,
  PropositionChangeLabel,
  PropositionSnapshot,
  StudyBaselineFile,
  StudySurveySubmission,
  SurveyFeedbackMethodRating,
  SurveyPropositionReview,
  SurveyWholeModelRating
} from '@/app/study/survey/types'

export const WHOLE_MODEL_RATING_KEY_PREFIX = 'whole-model'
export const FEEDBACK_METHOD_RATING_KEY_PREFIX = 'feedback-method'

export function ratingKey(propositionId: string, label: string, metric: string): string {
  return `${propositionId}:${label}:${metric}`
}

function labelsForExistingProposition(
  baseline: PropositionSnapshot,
  current: PropositionSnapshot
): PropositionChangeLabel[] {
  const labels: PropositionChangeLabel[] = []
  if (current.text !== baseline.text) labels.push('refinement')
  // Confidences come from discrete 1-10 elicitations, so exact comparison is
  // safe; decay changes are deliberately ignored.
  if (current.confidence !== baseline.confidence) labels.push('recalibration')
  if (current.rationale !== baseline.rationale) labels.push('rationale')
  if (labels.length === 0) labels.push('retention')
  return labels
}

/**
 * Diff the end-of-session model against the injected baseline. Existing
 * propositions keep the baseline file's order; expansions follow at the end.
 * A new proposition is an expansion, plus a rationale review when it arrived
 * with one — but never a refinement/recalibration, since there is nothing to
 * compare against.
 */
export function classifyPropositionChanges(
  baseline: readonly PropositionSnapshot[],
  current: readonly PropositionSnapshot[]
): ClassifiedProposition[] {
  const currentById = new Map(current.map((snapshot) => [snapshot.id, snapshot]))
  const baselineIds = new Set(baseline.map((snapshot) => snapshot.id))

  const existing: ClassifiedProposition[] = baseline.map((baselineSnapshot) => {
    const currentSnapshot = currentById.get(baselineSnapshot.id)
    if (!currentSnapshot) {
      return {
        id: baselineSnapshot.id,
        labels: [],
        removed: true,
        baseline: baselineSnapshot,
        current: null
      }
    }
    return {
      id: baselineSnapshot.id,
      labels: labelsForExistingProposition(baselineSnapshot, currentSnapshot),
      removed: false,
      baseline: baselineSnapshot,
      current: currentSnapshot
    }
  })

  const expansions: ClassifiedProposition[] = current
    .filter((snapshot) => !baselineIds.has(snapshot.id))
    .map((snapshot) => ({
      id: snapshot.id,
      labels:
        snapshot.rationale === null
          ? (['expansion'] as PropositionChangeLabel[])
          : (['expansion', 'rationale'] as PropositionChangeLabel[]),
      removed: false,
      baseline: null,
      current: snapshot
    }))

  return [...existing, ...expansions]
}

/** Every rating key the survey must collect for this classification, in
 * display order — the single truth shared by the overlay and the payload. */
export function expectedRatingKeys(classified: readonly ClassifiedProposition[]): string[] {
  const keys: string[] = []
  for (const review of classified) {
    if (review.removed) continue
    for (const label of review.labels) {
      for (const question of PROPOSITION_QUESTIONS_BY_LABEL[label]) {
        keys.push(ratingKey(review.id, label, question.metric))
      }
    }
  }
  for (const question of WHOLE_MODEL_QUESTIONS) {
    keys.push(ratingKey(WHOLE_MODEL_RATING_KEY_PREFIX, 'overall', question.metric))
  }
  for (const question of FEEDBACK_METHOD_QUESTIONS) {
    keys.push(ratingKey(FEEDBACK_METHOD_RATING_KEY_PREFIX, 'overall', question.key))
  }
  return keys
}

interface SurveySubmissionInput {
  participantId: string
  baseline: StudyBaselineFile
  classified: readonly ClassifiedProposition[]
  answers: Readonly<Record<string, number>>
}

export function buildSurveySubmissionPayload(input: SurveySubmissionInput): StudySurveySubmission {
  const readAnswer = (key: string): number => {
    const value = input.answers[key]
    if (value === undefined) {
      throw new Error(`Survey submission is missing an answer for "${key}".`)
    }
    return value
  }

  const propositionReviews: SurveyPropositionReview[] = input.classified.map((review) => ({
    propositionId: review.id,
    labels: review.labels,
    removed: review.removed,
    baseline: review.baseline,
    current: review.current,
    ratings: review.removed
      ? []
      : review.labels.flatMap((label) =>
          PROPOSITION_QUESTIONS_BY_LABEL[label].map((question) => ({
            label,
            metric: question.metric,
            questionKorean: question.questionKorean,
            value: readAnswer(ratingKey(review.id, label, question.metric))
          }))
        )
  }))

  const wholeModelRatings: SurveyWholeModelRating[] = WHOLE_MODEL_QUESTIONS.map((question) => ({
    metric: question.metric,
    questionKorean: question.questionKorean,
    value: readAnswer(ratingKey(WHOLE_MODEL_RATING_KEY_PREFIX, 'overall', question.metric))
  }))

  const feedbackMethodRatings: SurveyFeedbackMethodRating[] = FEEDBACK_METHOD_QUESTIONS.map(
    (question) => ({
      key: question.key,
      questionKorean: question.questionKorean,
      value: readAnswer(ratingKey(FEEDBACK_METHOD_RATING_KEY_PREFIX, 'overall', question.key))
    })
  )

  return {
    participantId: input.participantId,
    host: input.baseline.host,
    condition: input.baseline.condition,
    baselineSavedAt: input.baseline.savedAt,
    submittedAt: new Date().toISOString(),
    propositionReviews,
    wholeModelRatings,
    feedbackMethodRatings
  }
}
