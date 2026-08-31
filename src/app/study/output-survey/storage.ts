import type { OutputQualitySurveySubmission } from '@/app/study/output-survey/submission'
import { postStudyJson } from '@/app/study/survey/storage'

const OUTPUT_SURVEY_ENDPOINT = '/__study-output-survey'

export async function submitStudyOutputSurvey(
  submission: OutputQualitySurveySubmission
): Promise<void> {
  await postStudyJson(OUTPUT_SURVEY_ENDPOINT, submission, 'Output survey save failed')
}
