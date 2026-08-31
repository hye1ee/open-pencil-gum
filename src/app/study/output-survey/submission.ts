import type { StudyCondition, StudyHost } from '@/app/study/runtime'
import { OUTPUT_QUALITY_QUESTIONS } from '@/app/study/survey/questions'
import type { OutputQualityQuestionKey } from '@/app/study/survey/questions'

export interface OutputQualitySurveyAnswer {
  key: OutputQualityQuestionKey
  questionKorean: string
  value: number
}

export interface OutputQualitySurveySubmission {
  participantId: string
  host: StudyHost
  condition: StudyCondition
  /** The user request whose finished output is being rated. */
  requestText: string
  /** savedAt of the injected-model baseline file, linking this rating to the
   * injected model. Null when no baseline file exists for this identity. */
  baselineSavedAt: string | null
  answers: OutputQualitySurveyAnswer[]
  submittedAt: string
}

export type OutputQualitySurveyAnswerValues = Partial<Record<OutputQualityQuestionKey, number>>

export interface OutputQualitySurveySubmissionInput {
  participantId: string
  host: StudyHost
  condition: StudyCondition
  requestText: string
  baselineSavedAt: string | null
  answerValues: OutputQualitySurveyAnswerValues
  submittedAt?: string
}

/** Null when any of the four questions is unanswered; answers keep the
 * question order and Korean wording from OUTPUT_QUALITY_QUESTIONS. */
export function buildOutputQualitySurveySubmission(
  input: OutputQualitySurveySubmissionInput
): OutputQualitySurveySubmission | null {
  const answers: OutputQualitySurveyAnswer[] = []
  for (const question of OUTPUT_QUALITY_QUESTIONS) {
    const value = input.answerValues[question.key]
    if (typeof value !== 'number') return null
    answers.push({ key: question.key, questionKorean: question.questionKorean, value })
  }
  return {
    participantId: input.participantId,
    host: input.host,
    condition: input.condition,
    requestText: input.requestText,
    baselineSavedAt: input.baselineSavedAt,
    answers,
    submittedAt: input.submittedAt ?? new Date().toISOString()
  }
}
