<script setup lang="ts">
import { computed, ref } from 'vue'

import { OUTPUT_QUALITY_QUESTIONS } from '@/app/study/survey/questions'
import type { OutputQualitySurveyAnswerValues } from '@/app/study/output-survey/submission'
import LikertScaleRow from '@/components/StudySurvey/LikertScaleRow.vue'

const {
  compact = false,
  submitting,
  errorKorean
} = defineProps<{
  compact?: boolean
  submitting: boolean
  errorKorean: string
}>()
const emit = defineEmits<{
  submit: [answerValues: OutputQualitySurveyAnswerValues]
}>()

const answerValues = ref<OutputQualitySurveyAnswerValues>({})
const allAnswered = computed(() =>
  OUTPUT_QUALITY_QUESTIONS.every((question) => typeof answerValues.value[question.key] === 'number')
)

function recordAnswer(key: (typeof OUTPUT_QUALITY_QUESTIONS)[number]['key'], value: number): void {
  answerValues.value = { ...answerValues.value, [key]: value }
}

function submit(): void {
  if (!allAnswered.value || submitting) return
  emit('submit', { ...answerValues.value })
}
</script>

<template>
  <div :class="compact ? 'w-full px-3 pb-2' : 'mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6 sm:pb-6'">
    <section
      data-test-id="output-quality-survey-card"
      class="rounded-2xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200/60"
      aria-live="polite"
    >
      <div class="mb-1 flex items-center gap-2 text-xs font-semibold text-blue-700">
        <span class="flex size-7 items-center justify-center rounded-lg bg-blue-600 text-white">
          <icon-lucide-clipboard-check class="size-4" />
        </span>
        결과물 평가
      </div>
      <p class="text-xs leading-5 text-slate-500">
        다음 요청을 보내기 전에 이번 결과물을 평가해 주세요.
      </p>
      <div class="mt-2 divide-y divide-slate-100" :class="compact ? 'overflow-x-auto' : ''">
        <LikertScaleRow
          v-for="question in OUTPUT_QUALITY_QUESTIONS"
          :key="question.key"
          :question-korean="question.questionKorean"
          :model-value="answerValues[question.key] ?? null"
          @update:model-value="recordAnswer(question.key, $event)"
        />
      </div>
      <p v-if="errorKorean" class="mt-2 text-xs text-red-600">{{ errorKorean }}</p>
      <div class="mt-3 flex justify-end">
        <button
          type="button"
          data-test-id="output-quality-survey-submit"
          class="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400"
          :disabled="!allAnswered || submitting"
          @click="submit"
        >
          {{ submitting ? '제출 중…' : '평가 제출' }}
        </button>
      </div>
    </section>
  </div>
</template>
