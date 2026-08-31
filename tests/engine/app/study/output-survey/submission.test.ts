import { describe, expect, test } from 'bun:test'

import { buildOutputQualitySurveySubmission } from '@/app/study/output-survey/submission'
import type { OutputQualitySurveySubmissionInput } from '@/app/study/output-survey/submission'
import { OUTPUT_QUALITY_QUESTIONS } from '@/app/study/survey/questions'

function submissionInput(
  overrides: Partial<OutputQualitySurveySubmissionInput> = {}
): OutputQualitySurveySubmissionInput {
  return {
    participantId: 'p1',
    host: 'lenchat',
    condition: 'hands-off',
    requestText: 'Design a hero section.',
    baselineSavedAt: '2026-08-31T09:00:00.000Z',
    answerValues: {
      'request-fulfillment': 6,
      'overall-quality': 5,
      'preference-alignment': 4,
      'implicit-knowledge-alignment': 3
    },
    submittedAt: '2026-08-31T10:00:00.000Z',
    ...overrides
  }
}

describe('output quality survey submission', () => {
  test('keeps question order, Korean wording, and values', () => {
    const submission = buildOutputQualitySurveySubmission(submissionInput())
    expect(submission).not.toBeNull()
    expect(submission?.answers.map((answer) => answer.key)).toEqual(
      OUTPUT_QUALITY_QUESTIONS.map((question) => question.key)
    )
    expect(submission?.answers.map((answer) => answer.questionKorean)).toEqual(
      OUTPUT_QUALITY_QUESTIONS.map((question) => question.questionKorean)
    )
    expect(submission?.answers.map((answer) => answer.value)).toEqual([6, 5, 4, 3])
  })

  test('returns null when any question is unanswered', () => {
    const submission = buildOutputQualitySurveySubmission(
      submissionInput({
        answerValues: { 'request-fulfillment': 6, 'overall-quality': 5 }
      })
    )
    expect(submission).toBeNull()
  })

  test('passes identity, request, baseline link, and submittedAt through', () => {
    const submission = buildOutputQualitySurveySubmission(
      submissionInput({ baselineSavedAt: null })
    )
    expect(submission).toMatchObject({
      participantId: 'p1',
      host: 'lenchat',
      condition: 'hands-off',
      requestText: 'Design a hero section.',
      baselineSavedAt: null,
      submittedAt: '2026-08-31T10:00:00.000Z'
    })
  })
})
