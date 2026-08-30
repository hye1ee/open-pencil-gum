<script setup lang="ts">
import {
  SURVEY_SCALE_MAXIMUM_LABEL_KOREAN,
  SURVEY_SCALE_MINIMUM_LABEL_KOREAN,
  SURVEY_SCALE_POINTS
} from '@/app/study/survey/questions'

const { questionKorean, modelValue } = defineProps<{
  questionKorean: string
  modelValue: number | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const scalePoints = Array.from({ length: SURVEY_SCALE_POINTS }, (_, index) => index + 1)
</script>

<template>
  <div class="py-2">
    <p class="mb-1.5 text-xs leading-5 text-slate-700">{{ questionKorean }}</p>
    <div class="flex items-center gap-2">
      <span class="w-24 shrink-0 text-right text-[10px] leading-3 text-slate-400">
        {{ SURVEY_SCALE_MINIMUM_LABEL_KOREAN }}
      </span>
      <div role="radiogroup" :aria-label="questionKorean" class="flex items-center gap-1.5">
        <button
          v-for="point in scalePoints"
          :key="point"
          type="button"
          role="radio"
          :aria-checked="modelValue === point"
          :class="[
            'flex size-7 cursor-pointer items-center justify-center rounded-full border text-[11px] font-semibold transition-colors',
            modelValue === point
              ? 'border-blue-600 bg-blue-600 text-white'
              : 'border-slate-300 bg-white text-slate-600 hover:border-blue-400 hover:text-blue-700'
          ]"
          @click="emit('update:modelValue', point)"
        >
          {{ point }}
        </button>
      </div>
      <span class="w-24 shrink-0 text-[10px] leading-3 text-slate-400">
        {{ SURVEY_SCALE_MAXIMUM_LABEL_KOREAN }}
      </span>
    </div>
  </div>
</template>
