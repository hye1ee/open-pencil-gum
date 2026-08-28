<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { ref } from 'vue'

import type { ConversationFeedbackNote } from '@/app/conversation/types'
import { CODE_VISUAL_SIZE_BRIDGE_SOURCE } from '@/app/feedback-note/code-visual/document'

type FeedbackNotePhase = 'reviewed' | 'current' | 'waiting'

const { note, disabled, phase } = defineProps<{
  note: ConversationFeedbackNote
  disabled?: boolean
  phase: FeedbackNotePhase
}>()
const emit = defineEmits<{
  activate: [id: string]
  continue: [id: string]
  feedback: [id: string, text: string]
}>()
const reply = ref('')
const codeVisualAspectRatio = ref('720 / 240')

function submit(): void {
  const text = reply.value.trim()
  if (!text) return
  emit('feedback', note.id, text)
}

function markerTone(): string {
  if (phase === 'reviewed') return 'text-slate-400 ring-slate-300'
  if (note.relationship === 'conflict') return 'text-rose-600 ring-rose-300'
  if (note.relationship === 'alignment') return 'text-emerald-600 ring-emerald-300'
  return 'text-gray-500 ring-gray-300'
}

function relationshipLabel(): string {
  if (note.relationship === 'conflict') return 'Conflict'
  if (note.relationship === 'alignment') return 'Alignment'
  return 'Uncovered'
}

function phaseLabel(): string {
  if (phase === 'reviewed') return 'Reviewed'
  if (phase === 'current') return 'Reviewing'
  return 'Waiting'
}

useEventListener(window, 'message', (event: MessageEvent) => {
  const message = event.data
  if (
    typeof message !== 'object' ||
    message === null ||
    message.source !== CODE_VISUAL_SIZE_BRIDGE_SOURCE ||
    message.noteId !== note.id ||
    typeof message.width !== 'number' ||
    typeof message.height !== 'number' ||
    message.width < 1 ||
    message.height < 1 ||
    message.height > 1200
  ) {
    return
  }
  codeVisualAspectRatio.value = `${message.width} / ${message.height}`
})
</script>

<template>
  <aside
    data-test-id="conversation-feedback-note"
    :data-note-id="note.id"
    class="relative shrink-0 snap-start overflow-hidden rounded-xl bg-white transition"
    :class="{
      'w-80 max-w-[calc(100vw-4rem)] shadow-lg ring-2 ring-violet-400': phase === 'current',
      'w-72 max-w-[calc(100vw-4rem)] cursor-pointer shadow-sm ring-1 ring-slate-200 hover:ring-violet-200':
        phase === 'waiting',
      'w-64 max-w-[calc(100vw-4rem)] bg-slate-100 opacity-60 grayscale ring-1 ring-slate-200':
        phase === 'reviewed'
    }"
    @click="phase === 'waiting' && emit('activate', note.id)"
  >
    <div class="px-4 pt-4 pb-3">
      <div class="mb-3 flex items-center gap-2">
        <div
          class="flex size-6 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-2"
          :class="markerTone()"
        >
          <icon-lucide-circle-check-big v-if="note.relationship === 'alignment'" class="size-3.5" />
          <icon-lucide-triangle-alert
            v-else-if="note.relationship === 'conflict'"
            class="size-3.5"
          />
          <icon-lucide-circle-help v-else class="size-3.5" />
        </div>
        <span class="text-xs font-semibold tracking-wide text-slate-500">Feedback note</span>
        <span
          class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
        >
          {{ relationshipLabel() }}
        </span>
        <span
          class="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold"
          :class="{
            'bg-slate-200 text-slate-500': phase === 'reviewed',
            'bg-violet-100 text-violet-700': phase === 'current',
            'bg-amber-50 text-amber-700': phase === 'waiting'
          }"
        >
          {{ phaseLabel() }}
        </span>
      </div>

      <div
        v-if="
          phase === 'current' &&
          note.representation.type !== 'text' &&
          note.representation.status === 'loading'
        "
        class="mb-3 flex aspect-3/2 items-center justify-center rounded-lg bg-slate-100 text-slate-400"
        aria-label="Generating visual"
      >
        <icon-lucide-loader-circle class="size-5 animate-spin" />
      </div>
      <iframe
        v-else-if="
          phase === 'current' &&
          note.representation.type === 'code-visual' &&
          note.representation.status === 'ready' &&
          note.representation.artifact
        "
        :srcdoc="note.representation.artifact.srcdoc"
        :style="{ aspectRatio: codeVisualAspectRatio }"
        title="Feedback note code visual"
        sandbox="allow-scripts"
        class="pointer-events-none mb-3 block w-full rounded-lg border-0 bg-slate-50"
      />
      <img
        v-else-if="
          phase === 'current' &&
          note.representation.type === 'image' &&
          note.representation.status === 'ready' &&
          note.representation.url
        "
        :src="note.representation.url"
        :alt="note.representationGoal"
        class="pointer-events-none mb-3 block max-h-56 w-full rounded-lg bg-slate-50 object-contain"
      />
      <div
        v-else-if="
          phase === 'current' &&
          note.representation.type !== 'text' &&
          note.representation.status === 'failed'
        "
        class="mb-3 flex items-center justify-center gap-2 rounded-lg bg-slate-100 px-3 py-4 text-xs text-slate-500"
        role="status"
      >
        <icon-lucide-image-off class="size-4" />
        Visual unavailable
      </div>

      <p
        class="text-sm leading-5 text-slate-900"
        :class="phase === 'current' ? '' : 'line-clamp-3'"
      >
        {{ note.cue }}
      </p>

      <div
        v-if="phase === 'current'"
        class="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-slate-800 ring-1 ring-amber-200"
      >
        <p class="mb-1 flex items-center gap-1.5 font-semibold text-amber-700">
          <icon-lucide-brain class="size-3.5" />
          From agent reasoning
        </p>
        <p class="leading-relaxed text-slate-600">“{{ note.reasoningEvidence }}”</p>
      </div>
    </div>

    <form
      v-if="phase === 'current' && note.status === 'pending'"
      class="border-t border-slate-100 bg-slate-50/70 p-3"
      @submit.prevent="submit"
    >
      <input
        v-model="reply"
        data-test-id="conversation-feedback-input"
        class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        placeholder="Tell the agent what to change…"
        :disabled="disabled"
      />
      <div class="mt-2 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
          @click="emit('continue', note.id)"
        >
          Continue
        </button>
        <button
          type="submit"
          class="rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
          :disabled="disabled || !reply.trim()"
        >
          Revise answer
        </button>
      </div>
    </form>
    <button
      v-else-if="phase === 'waiting'"
      type="button"
      class="flex w-full items-center justify-between border-t border-slate-100 bg-slate-50/70 px-4 py-3 text-xs font-semibold text-slate-600 transition hover:bg-violet-50 hover:text-violet-700"
      @click.stop="emit('activate', note.id)"
    >
      Review this note
      <icon-lucide-arrow-right class="size-3.5" />
    </button>
    <div
      v-else
      class="flex items-start gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3 text-xs text-slate-600"
    >
      <icon-lucide-check class="mt-0.5 size-3.5 shrink-0 text-slate-400" />
      <span v-if="note.reply">{{ note.reply }}</span>
      <span v-else>Reviewed — continue with this decision.</span>
    </div>
  </aside>
</template>
