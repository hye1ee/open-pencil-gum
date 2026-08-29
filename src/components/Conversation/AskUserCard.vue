<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { AskUserQuestion } from '@/app/study/ask-user'

const { question, compact = false } = defineProps<{
  question: AskUserQuestion
  compact?: boolean
}>()
const emit = defineEmits<{
  answer: [answer: string, selectedOption: string | null]
  stop: []
}>()

const answer = ref('')
const selectedOption = ref<string | null>(null)
const canSubmit = computed(() => answer.value.trim().length > 0)

watch(
  () => question.id,
  () => {
    answer.value = ''
    selectedOption.value = null
  },
  { immediate: true }
)

function choose(option: string): void {
  const previous = selectedOption.value
  selectedOption.value = option
  if (!answer.value.trim() || answer.value === previous) answer.value = option
}

function submit(): void {
  const clean = answer.value.trim()
  if (!clean) return
  emit('answer', clean, selectedOption.value)
}

function keydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  submit()
}
</script>

<template>
  <div :class="compact ? 'w-full px-3 pb-2' : 'mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6 sm:pb-6'">
    <section
      data-test-id="ask-user-card"
      class="border p-4"
      :class="
        compact
          ? 'rounded-lg border-border bg-canvas shadow-sm'
          : 'rounded-2xl border-blue-200 bg-blue-50/60 shadow-lg shadow-blue-100/70'
      "
      aria-live="polite"
    >
      <div
        class="mb-3 flex items-center gap-2 text-xs font-semibold"
        :class="compact ? 'text-accent' : 'text-blue-700'"
      >
        <span
          class="flex size-7 items-center justify-center rounded-lg text-white"
          :class="compact ? 'bg-accent' : 'bg-blue-600'"
        >
          <icon-lucide-message-circle-question class="size-4" />
        </span>
        The agent needs your input
      </div>
      <p
        class="font-medium"
        :class="compact ? 'text-xs leading-5 text-surface' : 'text-[15px] leading-6 text-slate-900'"
      >
        {{ question.question }}
      </p>
      <div
        class="mt-4 grid gap-2"
        :class="compact ? 'grid-cols-1' : 'sm:grid-cols-3'"
        aria-label="Suggested answers"
      >
        <button
          v-for="option in question.options"
          :key="option"
          type="button"
          data-test-id="ask-user-option"
          class="min-h-11 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition"
          :class="
            selectedOption === option
              ? compact
                ? 'border-accent bg-accent text-white shadow-sm'
                : 'border-blue-600 bg-blue-600 text-white shadow-sm'
              : compact
                ? 'border-border bg-input text-surface hover:border-accent/60 hover:bg-hover'
                : 'border-blue-200 bg-white text-slate-700 hover:border-blue-400 hover:bg-blue-50'
          "
          :aria-pressed="selectedOption === option"
          @click="choose(option)"
        >
          <span class="flex items-start gap-2">
            <span
              class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border"
              :class="
                selectedOption === option
                  ? 'border-white bg-white text-blue-600'
                  : compact
                    ? 'border-border bg-input text-transparent'
                    : 'border-blue-300 bg-white text-transparent'
              "
            >
              <icon-lucide-check class="size-3" />
            </span>
            <span>{{ option }}</span>
          </span>
        </button>
      </div>
      <textarea
        v-model="answer"
        data-test-id="ask-user-input"
        rows="2"
        class="mt-3 block max-h-36 min-h-16 w-full resize-y rounded-xl border px-3 py-2.5 text-sm outline-none"
        :class="
          compact
            ? 'border-border bg-input text-surface placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/10'
            : 'border-blue-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
        "
        placeholder="Or type a different answer…"
        @keydown="keydown"
      />
      <div class="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          class="rounded-xl px-3 py-2 text-sm font-medium transition"
          :class="
            compact
              ? 'text-muted hover:bg-hover hover:text-surface'
              : 'text-slate-500 hover:bg-white hover:text-slate-800'
          "
          @click="emit('stop')"
        >
          Stop
        </button>
        <button
          type="button"
          data-test-id="ask-user-submit"
          class="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition"
          :class="
            compact
              ? 'bg-accent hover:bg-accent/90 disabled:bg-accent/30'
              : 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-200'
          "
          :disabled="!canSubmit"
          @click="submit"
        >
          Continue
          <icon-lucide-arrow-right class="size-4" />
        </button>
      </div>
    </section>
  </div>
</template>
