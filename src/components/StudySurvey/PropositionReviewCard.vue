<script setup lang="ts">
import { computed } from 'vue'

import { LABEL_PRESENTATION, PROPOSITION_QUESTIONS_BY_LABEL } from '@/app/study/survey/questions'
import { ratingKey } from '@/app/study/survey/classification'
import type { ClassifiedProposition, PropositionChangeLabel } from '@/app/study/survey/types'
import LikertScaleRow from '@/components/StudySurvey/LikertScaleRow.vue'

const { review, answers } = defineProps<{
  review: ClassifiedProposition
  answers: Readonly<Record<string, number>>
}>()

const emit = defineEmits<{
  rate: [key: string, value: number]
}>()

function confidenceOutOfTen(confidence: number): number {
  return Math.round(confidence * 9 + 1)
}

const hasLabel = (label: PropositionChangeLabel): boolean => review.labels.includes(label)

const confidenceChangeClasses = computed(() => {
  if (!review.baseline || !review.current) return 'text-slate-500'
  if (review.current.confidence > review.baseline.confidence) return 'text-green-700'
  return 'text-red-700'
})

interface RatingRow {
  key: string
  questionKorean: string
}

const ratingRows = computed<RatingRow[]>(() =>
  review.labels.flatMap((label) =>
    PROPOSITION_QUESTIONS_BY_LABEL[label].map((question) => ({
      key: ratingKey(review.id, label, question.metric),
      questionKorean: question.questionKorean
    }))
  )
)
</script>

<template>
  <article
    :class="[
      'rounded-xl border p-4',
      review.removed ? 'border-slate-200 bg-slate-50 text-slate-400' : 'border-slate-200 bg-white'
    ]"
    :data-test-id="`survey-proposition-${review.id}`"
  >
    <div class="mb-2 flex flex-wrap items-center gap-1.5">
      <span
        v-for="label in review.labels"
        :key="label"
        :class="[
          'rounded-full border px-2 py-0.5 text-[10px] font-semibold',
          LABEL_PRESENTATION[label].chipClasses
        ]"
      >
        {{ LABEL_PRESENTATION[label].displayName }}
      </span>
      <span v-if="review.removed" class="text-[10px] font-semibold text-slate-400">Removed</span>
      <span
        v-if="hasLabel('recalibration') && review.baseline && review.current"
        :class="['ml-auto text-[11px] font-semibold', confidenceChangeClasses]"
      >
        확신도 {{ confidenceOutOfTen(review.baseline.confidence) }}/10 →
        {{ confidenceOutOfTen(review.current.confidence) }}/10
      </span>
      <span
        v-else-if="review.current"
        class="ml-auto rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700"
      >
        확신도 {{ confidenceOutOfTen(review.current.confidence) }}/10
      </span>
    </div>

    <p v-if="review.current" class="text-sm leading-6 font-medium text-slate-800">
      {{ review.current.text }}
    </p>
    <p
      v-if="hasLabel('refinement') && review.baseline"
      class="mt-1 text-xs leading-5 text-slate-400"
    >
      <span
        class="mr-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-semibold text-slate-500"
        >기존</span
      >
      <span class="line-through">{{ review.baseline.text }}</span>
    </p>

    <div v-if="hasLabel('rationale') && review.current" class="mt-2 rounded-lg bg-blue-50/50 p-2">
      <p
        v-if="review.baseline?.rationale"
        class="mb-1 text-xs leading-5 text-slate-400 line-through"
      >
        {{ review.baseline.rationale }}
      </p>
      <p class="text-xs leading-5 text-slate-600">{{ review.current.rationale }}</p>
    </div>

    <p v-if="review.removed && review.baseline" class="text-sm leading-6">
      <span class="line-through">{{ review.baseline.text }}</span>
    </p>
    <p v-if="review.removed" class="mt-1 text-[11px]">
      이 proposition은 세션 중 제거되어 평가 대상이 아닙니다.
    </p>

    <div v-if="ratingRows.length > 0" class="mt-3 divide-y divide-slate-100 border-t border-slate-100">
      <LikertScaleRow
        v-for="row in ratingRows"
        :key="row.key"
        :question-korean="row.questionKorean"
        :model-value="answers[row.key] ?? null"
        @update:model-value="emit('rate', row.key, $event)"
      />
    </div>
  </article>
</template>
