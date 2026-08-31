import { readonly, shallowRef } from 'vue'
import type { DeepReadonly, ShallowRef } from 'vue'

import { submitStudyOutputSurvey } from '@/app/study/output-survey/storage'
import { buildOutputQualitySurveySubmission } from '@/app/study/output-survey/submission'
import type { OutputQualitySurveyAnswerValues } from '@/app/study/output-survey/submission'
import { getStudyRuntime } from '@/app/study/runtime'
import { loadStoredParticipantId } from '@/app/study/survey/participant-storage'
import { fetchStudyBaseline } from '@/app/study/survey/storage'

export interface OutputQualitySurveySession {
  /** Non-null while a finished run awaits its rating; the value is the rated request. */
  pendingRequest: DeepReadonly<ShallowRef<string | null>>
  submitting: DeepReadonly<ShallowRef<boolean>>
  submitErrorKorean: DeepReadonly<ShallowRef<string>>
  open(requestText: string): void
  /** Resolves true and clears pendingRequest only on a persisted submission. */
  submit(answerValues: OutputQualitySurveyAnswerValues): Promise<boolean>
  reset(): void
}

/**
 * Hands-off condition state: after a run finishes, the host swaps its input
 * for the output survey card and keeps it there until the rating is stored.
 * A failed submit keeps pendingRequest set, so blocking persists.
 */
export function createOutputQualitySurveySession(): OutputQualitySurveySession {
  const pendingRequest = shallowRef<string | null>(null)
  const submitting = shallowRef(false)
  const submitErrorKorean = shallowRef('')

  return {
    pendingRequest: readonly(pendingRequest),
    submitting: readonly(submitting),
    submitErrorKorean: readonly(submitErrorKorean),
    open: (requestText) => {
      // Dev-only, like the study endpoints this feeds: in a production build
      // the save endpoint does not exist and an unresolvable pending survey
      // would block the input forever.
      if (import.meta.env?.DEV !== true) return
      if (pendingRequest.value !== null) {
        console.warn('[output-survey] a rating is already pending; keeping the first run')
        return
      }
      pendingRequest.value = requestText
      submitErrorKorean.value = ''
    },
    submit: async (answerValues) => {
      const requestText = pendingRequest.value
      if (requestText === null || submitting.value) return false
      const participantId = loadStoredParticipantId()
      if (participantId === '') {
        submitErrorKorean.value =
          '참가자 ID가 설정되어 있지 않습니다. 좌측 하단 패널에서 참가자 ID를 입력한 뒤 다시 제출해 주세요.'
        return false
      }
      submitting.value = true
      submitErrorKorean.value = ''
      try {
        const runtime = getStudyRuntime()
        let baselineSavedAt: string | null = null
        try {
          const baseline = await fetchStudyBaseline(participantId, runtime.host, runtime.condition)
          baselineSavedAt = baseline?.savedAt ?? null
        } catch (error) {
          console.warn('[output-survey] baseline lookup failed; submitting without link:', error)
        }
        const submission = buildOutputQualitySurveySubmission({
          participantId,
          host: runtime.host,
          condition: runtime.condition,
          requestText,
          baselineSavedAt,
          answerValues
        })
        if (!submission) {
          submitErrorKorean.value = '네 문항에 모두 응답해 주세요.'
          return false
        }
        await submitStudyOutputSurvey(submission)
        pendingRequest.value = null
        return true
      } catch (error) {
        console.warn('[output-survey] submit failed:', error)
        const message = error instanceof Error ? error.message : String(error)
        submitErrorKorean.value = `제출에 실패했습니다: ${message}`
        return false
      } finally {
        submitting.value = false
      }
    },
    reset: () => {
      pendingRequest.value = null
      submitErrorKorean.value = ''
    }
  }
}

/** LenCanvas instance, shared by the transport (open) and ChatPanel (render/submit). */
export const lencanvasOutputQualitySurvey = createOutputQualitySurveySession()
