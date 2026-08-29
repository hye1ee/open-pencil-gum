<script setup lang="ts">
import { ref, watch } from 'vue'

import { generateReasoningFeedbackDraft } from '@/app/study/user-initiated/draft/generate'
import type { ReasoningReview } from '@/app/study/user-initiated/reasoning-review'

const {
  review,
  compact = false,
  disabled = false
} = defineProps<{
  review: ReasoningReview
  compact?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  continue: [id: string]
  feedback: [id: string, feedback: string, selectedReasoning: string | null]
}>()

const reasoningElement = ref<HTMLElement | null>(null)
const feedback = ref('')
const selectedReasoning = ref<string | null>(null)
const generatedDraft = ref('')
const generating = ref(false)
let generation = 0

watch(
  () => review.id,
  () => {
    generation += 1
    feedback.value = ''
    selectedReasoning.value = null
    generatedDraft.value = ''
    generating.value = false
  }
)

function selectedTextWithinReasoning(): string | null {
  const selection = window.getSelection()
  const element = reasoningElement.value
  if (!selection || selection.rangeCount === 0 || !element) return null
  const range = selection.getRangeAt(0)
  if (!element.contains(range.commonAncestorContainer)) return null
  return selection.toString().trim() || null
}

async function suggestFromSelection(): Promise<void> {
  if (review.status !== 'pending' || disabled) return
  const selection = selectedTextWithinReasoning()
  if (!selection || selection === selectedReasoning.value) return

  const previousGeneratedDraft = generatedDraft.value
  selectedReasoning.value = selection
  const requestGeneration = ++generation
  generating.value = true
  try {
    const draft = await generateReasoningFeedbackDraft({
      request: review.request,
      reasoningSoFar: review.reasoningSoFar,
      selectedReasoning: selection
    })
    if (requestGeneration !== generation || !draft) return
    generatedDraft.value = draft
    if (feedback.value.trim() === '' || feedback.value === previousGeneratedDraft) {
      feedback.value = draft
    }
  } catch (error) {
    console.warn('[reasoning-feedback-draft] generation failed:', error)
  } finally {
    if (requestGeneration === generation) generating.value = false
  }
}

function submitFeedback(): void {
  const clean = feedback.value.trim()
  if (!clean || disabled) return
  emit('feedback', review.id, clean, selectedReasoning.value)
}
</script>

<template>
  <article
    :data-test-id="`reasoning-review-${review.status}`"
    :class="[
      'overflow-hidden rounded-2xl border transition-colors',
      compact ? 'text-xs' : 'text-sm',
      review.status === 'pending'
        ? 'border-blue-300 bg-blue-50/70 shadow-sm'
        : 'border-slate-200 bg-slate-50/70 text-slate-500'
    ]"
  >
    <div :class="compact ? 'p-3' : 'p-4'">
      <div class="mb-2 flex items-center gap-2 font-semibold">
        <icon-lucide-message-square-text
          :class="review.status === 'pending' ? 'text-blue-600' : 'text-slate-400'"
        />
        <span>Reasoning checkpoint</span>
        <span class="ml-auto text-[10px] font-medium text-slate-400">
          Chunk {{ review.chunkIndex }}
        </span>
      </div>
      <p
        ref="reasoningElement"
        tabindex="0"
        class="whitespace-pre-wrap leading-relaxed selection:bg-blue-200"
        @mouseup="suggestFromSelection"
        @keyup="suggestFromSelection"
      >
        {{ review.text }}
      </p>
    </div>
    <div
      v-if="review.status === 'pending'"
      class="space-y-2 border-t border-blue-200/70 bg-white/70 px-3 py-3"
    >
      <div class="relative">
        <textarea
          v-model="feedback"
          :rows="compact ? 2 : 3"
          :disabled="disabled"
          placeholder="Write feedback, or select part of the reasoning for a suggestion…"
          class="block w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 pr-9 text-xs leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
          @keydown.meta.enter.prevent="submitFeedback"
          @keydown.ctrl.enter.prevent="submitFeedback"
        />
        <icon-lucide-loader-circle
          v-if="generating"
          class="absolute top-2.5 right-2.5 size-3.5 animate-spin text-blue-600"
          aria-label="Generating feedback suggestion"
        />
      </div>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          :disabled="disabled"
          class="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          @click="emit('continue', review.id)"
        >
          Continue
          <icon-lucide-arrow-right class="size-3.5" />
        </button>
        <button
          type="button"
          :disabled="disabled || feedback.trim() === ''"
          class="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          @click="submitFeedback"
        >
          Submit feedback
          <icon-lucide-send class="size-3.5" />
        </button>
      </div>
    </div>
    <div v-else class="flex items-center gap-1.5 border-t border-slate-200 px-3 py-2 text-xs">
      <icon-lucide-check class="size-3.5 text-emerald-600" />
      {{ review.status === 'answered' ? 'Feedback submitted' : 'Reviewed' }}
    </div>
  </article>
</template>
