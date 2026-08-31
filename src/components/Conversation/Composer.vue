<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { ChatStatus } from 'ai'

const { status, configured, blocked, modelName } = defineProps<{
  status: ChatStatus
  configured: boolean
  blocked: boolean
  modelName: string
}>()
const emit = defineEmits<{ submit: [text: string]; stop: []; settings: [] }>()
const input = ref('')
const textarea = ref<HTMLTextAreaElement>()

function submit(): void {
  // Enter mid-run would start a concurrent second run (LenChat has no mid-run
  // queue); returning before the clear keeps the typed text for after the run.
  if (status === 'submitted' || status === 'streaming') return
  const text = input.value.trim()
  if (!text) return
  emit('submit', text)
  input.value = ''
  void nextTick(() => textarea.value?.focus())
}

function keydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  submit()
}
</script>

<template>
  <div class="mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6 sm:pb-6">
    <div
      class="rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lg shadow-slate-200/60 focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100"
    >
      <textarea
        ref="textarea"
        v-model="input"
        data-test-id="conversation-input"
        rows="2"
        class="block max-h-40 min-h-14 w-full resize-none bg-transparent px-2 py-1.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
        :placeholder="
          !configured
            ? 'Add your Gemini API key to begin'
            : blocked
              ? 'Resolve the reasoning checkpoint to continue'
              : 'Write Your Message'
        "
        :disabled="!configured || blocked"
        @keydown="keydown"
      />
      <div class="flex items-center justify-between px-1 pb-1">
        <div class="flex items-center gap-2 px-2 text-[11px] text-slate-400">
          <span>Model: {{ modelName }}</span>
          <button
            type="button"
            title="Model Setting"
            class="flex size-5 cursor-pointer items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-blue-700"
            @click="emit('settings')"
          >
            <icon-lucide-settings-2 class="size-3" />
          </button>
        </div>
        <button
          v-if="status === 'submitted' || status === 'streaming'"
          type="button"
          data-test-id="conversation-stop"
          class="flex size-8 items-center justify-center rounded-lg bg-slate-900 text-white transition hover:bg-slate-700"
          @click="emit('stop')"
        >
          <icon-lucide-square class="size-3" />
        </button>
        <button
          v-else
          type="button"
          data-test-id="conversation-send"
          class="flex size-8 items-center justify-center rounded-lg bg-blue-600 text-white transition hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400"
          :disabled="!configured || blocked || !input.trim()"
          @click="submit"
        >
          <icon-lucide-arrow-up class="size-4" />
        </button>
      </div>
    </div>
  </div>
</template>
