<script setup lang="ts">
import { ref } from 'vue'

import type { ConversationFeedbackNote } from '@/app/conversation/types'

const { note, disabled } = defineProps<{
  note: ConversationFeedbackNote
  disabled?: boolean
}>()
const emit = defineEmits<{ continue: []; feedback: [text: string] }>()
const reply = ref('')

function submit(): void {
  const text = reply.value.trim()
  if (!text) return
  emit('feedback', text)
}
</script>

<template>
  <aside
    data-test-id="conversation-feedback-note"
    class="my-4 overflow-hidden rounded-2xl border border-blue-200 bg-blue-50/70 shadow-sm"
  >
    <div class="flex items-start gap-3 border-b border-blue-100 px-4 py-3">
      <div
        class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white"
      >
        <icon-lucide-message-circle-warning class="size-3.5" />
      </div>
      <div class="min-w-0">
        <div class="mb-0.5 flex items-center gap-2">
          <span class="text-xs font-semibold text-slate-800">Reasoning checkpoint</span>
          <span
            class="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-blue-700 capitalize"
            >{{ note.relationship }}</span
          >
        </div>
        <p class="text-sm leading-5 text-slate-700">{{ note.cue }}</p>
        <p class="mt-1 text-xs text-slate-500">“{{ note.reasoningEvidence }}”</p>
      </div>
    </div>
    <form class="flex flex-col gap-2 p-3 sm:flex-row" @submit.prevent="submit">
      <input
        v-model="reply"
        data-test-id="conversation-feedback-input"
        class="min-w-0 flex-1 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        placeholder="Tell the agent what to change…"
        :disabled="disabled"
      />
      <button
        type="button"
        class="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"
        :disabled="disabled"
        @click="emit('continue')"
      >
        Continue
      </button>
      <button
        type="submit"
        class="rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
        :disabled="disabled || !reply.trim()"
      >
        Revise answer
      </button>
    </form>
  </aside>
</template>
