<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  buildSurveySubmissionPayload,
  classifyPropositionChanges,
  expectedRatingKeys,
  ratingKey,
  FEEDBACK_METHOD_RATING_KEY_PREFIX,
  WHOLE_MODEL_RATING_KEY_PREFIX
} from '@/app/study/survey/classification'
import { finalizeStudyMetricsSession } from '@/app/study/metrics/storage'
import { FEEDBACK_METHOD_QUESTIONS, WHOLE_MODEL_QUESTIONS } from '@/app/study/survey/questions'
import { loadStoredParticipantId } from '@/app/study/survey/participant-storage'
import { fetchStudyBaseline, submitStudySurvey } from '@/app/study/survey/storage'
import { snapshotProposition } from '@/app/study/survey/types'
import type { ClassifiedProposition, StudyBaselineFile } from '@/app/study/survey/types'
import { getStudyRuntime } from '@/app/study/runtime'
import { propositions } from '@/app/user-model/store'
import { awaitUserModelSettled } from '@/app/user-model/use'
import PropositionReviewCard from '@/components/StudySurvey/PropositionReviewCard.vue'
import LikertScaleRow from '@/components/StudySurvey/LikertScaleRow.vue'

const { open } = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

type SurveyStage = 'loading' | 'error' | 'reviewing' | 'submitting' | 'completed'

const stage = ref<SurveyStage>('loading')
const errorMessageKorean = ref('')
const participantId = ref('')
const baseline = ref<StudyBaselineFile | null>(null)
const reviews = ref<ClassifiedProposition[]>([])
const answers = ref<Record<string, number>>({})
const submitErrorKorean = ref('')

const expectedKeys = computed(() => expectedRatingKeys(reviews.value))
const answeredCount = computed(
  () => expectedKeys.value.filter((key) => typeof answers.value[key] === 'number').length
)
const allAnswered = computed(() => answeredCount.value === expectedKeys.value.length)

const wholeModelRows = WHOLE_MODEL_QUESTIONS.map((question) => ({
  key: ratingKey(WHOLE_MODEL_RATING_KEY_PREFIX, 'overall', question.metric),
  questionKorean: question.questionKorean
}))

const feedbackMethodRows = FEEDBACK_METHOD_QUESTIONS.map((question) => ({
  key: ratingKey(FEEDBACK_METHOD_RATING_KEY_PREFIX, 'overall', question.key),
  questionKorean: question.questionKorean
}))

async function prepareSurvey(): Promise<void> {
  stage.value = 'loading'
  errorMessageKorean.value = ''
  submitErrorKorean.value = ''
  answers.value = {}

  participantId.value = loadStoredParticipantId()
  if (participantId.value === '') {
    errorMessageKorean.value =
      '참가자 ID가 설정되어 있지 않습니다. 좌측 하단 패널에서 참가자 ID를 입력한 뒤 다시 시도해 주세요.'
    stage.value = 'error'
    return
  }

  // Fire-and-forget: writes the session-ended marker and the aggregate metrics
  // summary even when the survey below errors or is abandoned.
  void finalizeStudyMetricsSession()

  try {
    await awaitUserModelSettled()
    const runtime = getStudyRuntime()
    const loadedBaseline = await fetchStudyBaseline(
      participantId.value,
      runtime.host,
      runtime.condition
    )
    if (!loadedBaseline) {
      errorMessageKorean.value =
        '이 참가자·조건의 베이스라인이 없습니다. 유저 모델을 주입한 뒤 다시 시도해 주세요.'
      stage.value = 'error'
      return
    }
    baseline.value = loadedBaseline
    reviews.value = classifyPropositionChanges(
      loadedBaseline.propositions,
      propositions.value.map(snapshotProposition)
    )
    stage.value = 'reviewing'
  } catch (error) {
    errorMessageKorean.value = error instanceof Error ? error.message : String(error)
    stage.value = 'error'
  }
}

watch(
  () => open,
  (opened) => {
    if (opened) void prepareSurvey()
  },
  { immediate: true }
)

function recordAnswer(key: string, value: number): void {
  answers.value[key] = value
}

async function submit(): Promise<void> {
  const loadedBaseline = baseline.value
  if (!loadedBaseline || !allAnswered.value || stage.value !== 'reviewing') return
  stage.value = 'submitting'
  submitErrorKorean.value = ''
  try {
    await submitStudySurvey(
      buildSurveySubmissionPayload({
        participantId: participantId.value,
        baseline: loadedBaseline,
        classified: reviews.value,
        answers: answers.value
      })
    )
    stage.value = 'completed'
  } catch (error) {
    submitErrorKorean.value = `제출에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`
    stage.value = 'reviewing'
  }
}
</script>

<template>
  <div
    v-if="open"
    data-test-id="study-survey-overlay"
    class="fixed inset-0 z-[200] overflow-y-auto bg-white text-slate-800"
  >
    <div class="mx-auto w-full max-w-3xl px-6 py-10">
      <header class="mb-6">
        <h1 class="text-xl font-semibold text-slate-900">세션 종료 설문</h1>
        <p class="mt-1 text-sm text-slate-500">
          세션 동안 유저 모델이 어떻게 바뀌었는지 항목별로 평가해 주세요. 변경된 항목에는 초기
          버전이 함께 표시됩니다.
        </p>
      </header>

      <div v-if="stage === 'loading'" class="flex items-center gap-2 py-16 text-sm text-slate-500">
        <icon-lucide-loader-circle class="size-4 animate-spin text-blue-600" />
        유저 모델 변경 내역을 불러오는 중…
      </div>

      <div
        v-else-if="stage === 'error'"
        class="rounded-2xl border border-red-200 bg-red-50/60 p-6 text-sm text-red-700"
      >
        <p>{{ errorMessageKorean }}</p>
        <div class="mt-4 flex gap-2">
          <button
            type="button"
            class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            @click="emit('close')"
          >
            닫기
          </button>
          <button
            type="button"
            class="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
            @click="prepareSurvey"
          >
            다시 시도
          </button>
        </div>
      </div>

      <div v-else-if="stage === 'completed'" class="py-16 text-center">
        <icon-lucide-check-circle-2 class="mx-auto size-10 text-emerald-500" />
        <p class="mt-3 text-base font-semibold text-slate-900">제출되었습니다. 감사합니다!</p>
        <button
          type="button"
          class="mt-6 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          @click="emit('close')"
        >
          닫기
        </button>
      </div>

      <template v-else>
        <section class="flex flex-col gap-4" aria-label="Proposition 평가">
          <PropositionReviewCard
            v-for="review in reviews"
            :key="review.id"
            :review="review"
            :answers="answers"
            @rate="recordAnswer"
          />
        </section>

        <section class="mt-8 rounded-xl border border-slate-200 bg-white p-4" aria-label="전체 모델 평가">
          <h2 class="mb-1 text-sm font-semibold text-slate-900">전체 유저 모델 평가</h2>
          <div class="divide-y divide-slate-100">
            <LikertScaleRow
              v-for="row in wholeModelRows"
              :key="row.key"
              :question-korean="row.questionKorean"
              :model-value="answers[row.key] ?? null"
              @update:model-value="recordAnswer(row.key, $event)"
            />
          </div>
        </section>

        <section
          class="mt-4 rounded-xl border border-slate-200 bg-white p-4"
          aria-label="피드백 방식 평가"
        >
          <h2 class="mb-1 text-sm font-semibold text-slate-900">피드백 방식 평가</h2>
          <p class="mb-1 text-[11px] text-slate-500">
            이번 세션에서 사용한 피드백 방식에 대해 평가해 주세요.
          </p>
          <div class="divide-y divide-slate-100">
            <LikertScaleRow
              v-for="row in feedbackMethodRows"
              :key="row.key"
              :question-korean="row.questionKorean"
              :model-value="answers[row.key] ?? null"
              @update:model-value="recordAnswer(row.key, $event)"
            />
          </div>
        </section>

        <footer
          class="sticky bottom-0 mt-8 -mx-6 flex items-center justify-between gap-4 border-t border-slate-200 bg-white/95 px-6 py-4 backdrop-blur"
        >
          <span class="text-xs text-slate-500">
            {{ answeredCount }} / {{ expectedKeys.length }} 문항 응답
          </span>
          <p v-if="submitErrorKorean" class="text-xs text-red-600">{{ submitErrorKorean }}</p>
          <button
            type="button"
            data-test-id="study-survey-submit"
            :disabled="!allAnswered || stage === 'submitting'"
            class="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            @click="submit"
          >
            {{ stage === 'submitting' ? '제출 중…' : '설문 제출' }}
          </button>
        </footer>
      </template>
    </div>
  </div>
</template>
