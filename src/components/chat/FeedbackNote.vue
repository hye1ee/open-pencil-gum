<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

import { dismissFeedbackNote, feedbackNoteState, openFeedbackNote } from '@/app/feedback-note/use'
import { useEditorStore } from '@/app/editor/active-store'

const { canvasEl } = defineProps<{ canvasEl: HTMLCanvasElement | null }>()
const store = useEditorStore()
const hoveredId = ref<string | null>(null)
const introducedIds = ref<string[]>([])
const seenIds = new Set<string>()
const introTimers = new Map<string, ReturnType<typeof setTimeout>>()
let ownsHighlight = false

function anchorSlot(note: (typeof feedbackNoteState.notes)[number], index: number) {
  const nodeId = anchoredNodeId(note)
  return feedbackNoteState.notes
    .slice(0, index)
    .filter((candidate) => anchoredNodeId(candidate) === nodeId).length
}

function anchoredNodeId(note: (typeof feedbackNoteState.notes)[number]) {
  return note.nodeId && store.graph.getNode(note.nodeId) ? note.nodeId : null
}

function position(note: (typeof feedbackNoteState.notes)[number], index: number) {
  const { zoom, panX, panY } = store.state
  const slot = anchorSlot(note, index)
  void store.state.sceneVersion
  const nodeId = anchoredNodeId(note)
  if (nodeId) {
    const node = store.graph.getNode(nodeId)
    if (node) {
      const absolute = store.graph.getAbsolutePosition(nodeId)
      return {
        x: (absolute.x + node.width) * zoom + panX + 8 + slot * 34,
        y: absolute.y * zoom + panY - 8
      }
    }
  }
  const cursor = store.state.agentCursor
  if (cursor) {
    return {
      x: cursor.x * zoom + panX + 8 + slot * 34,
      y: cursor.y * zoom + panY + 34
    }
  }
  return { x: Math.min(24, (canvasEl?.clientWidth ?? 48) / 2) + slot * 34, y: 24 }
}

function rating(relationship: (typeof feedbackNoteState.notes)[number]['relationship']) {
  if (relationship === 'conflict') return -3
  if (relationship === 'alignment') return 3
  return 0
}

function syncHighlights() {
  const entries = feedbackNoteState.notes
    .filter(
      (note) =>
        anchoredNodeId(note) &&
        (introducedIds.value.includes(note.id) ||
          hoveredId.value === note.id ||
          feedbackNoteState.activeId === note.id)
    )
    .flatMap((note): Array<[string, number]> => {
      const nodeId = anchoredNodeId(note)
      return nodeId ? [[nodeId, rating(note.relationship)]] : []
    })

  if (entries.length > 0) {
    ownsHighlight = true
    store.aiSetMismatch(entries)
  } else if (ownsHighlight) {
    ownsHighlight = false
    store.aiClearMismatch()
  }
}

watch(
  () => feedbackNoteState.notes.map((note) => note.id),
  (ids) => {
    for (const id of ids) {
      if (seenIds.has(id)) continue
      seenIds.add(id)
      introducedIds.value = [...introducedIds.value, id]
      introTimers.set(
        id,
        setTimeout(() => {
          introducedIds.value = introducedIds.value.filter((candidate) => candidate !== id)
          introTimers.delete(id)
        }, 2600)
      )
    }
  },
  { immediate: true }
)

watch(
  [
    () => feedbackNoteState.notes.map((note) => `${note.id}:${note.nodeId}:${note.relationship}`),
    introducedIds,
    hoveredId,
    () => feedbackNoteState.activeId
  ],
  syncHighlights,
  { immediate: true }
)

onBeforeUnmount(() => {
  for (const timer of introTimers.values()) clearTimeout(timer)
  if (ownsHighlight) store.aiClearMismatch()
})

function tone(relationship: (typeof feedbackNoteState.notes)[number]['relationship']) {
  if (relationship === 'conflict') return 'text-rose-600 ring-rose-300'
  if (relationship === 'alignment') {
    return 'text-emerald-600 ring-emerald-300'
  }
  return 'text-violet-600 ring-violet-300'
}
</script>

<template>
  <div
    v-for="(note, index) in feedbackNoteState.notes"
    :key="note.id"
    class="pointer-events-none absolute z-30"
    :style="{ left: `${position(note, index).x}px`, top: `${position(note, index).y}px` }"
    @pointerenter="hoveredId = note.id"
    @pointerleave="hoveredId = null"
  >
    <button
      type="button"
      class="pointer-events-auto flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-panel shadow-md ring-2 transition hover:scale-105"
      :class="[tone(note.relationship), { 'animate-pulse': introducedIds.includes(note.id) }]"
      aria-label="Open feedback note"
      @click="openFeedbackNote(note.id)"
    >
      <icon-lucide-message-square-text class="size-4" />
    </button>

    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="translate-y-1 opacity-0"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="translate-y-1 opacity-0"
    >
      <div
        v-if="
          feedbackNoteState.activeId === note.id ||
          (feedbackNoteState.activeId === null && hoveredId === note.id)
        "
        class="pointer-events-auto absolute top-5 left-2 min-h-24 w-56 max-w-[min(70vw,48rem)] min-w-44 resize overflow-auto rounded-xl bg-panel p-3 text-sm text-surface shadow-xl ring-1 ring-border"
      >
        <p class="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
          Interactive Feedback Note
        </p>
        <div
          v-if="note.imageStatus === 'loading'"
          class="mb-2 flex aspect-3/2 items-center justify-center rounded-lg bg-hover text-muted"
        >
          <icon-lucide-loader-circle class="size-5 animate-spin" />
        </div>
        <div v-else-if="note.imageUrl" class="relative mb-2 overflow-hidden rounded-lg">
          <img
            :src="note.imageUrl"
            alt="Interactive feedback representation"
            class="h-auto w-full object-contain"
          />
          <div
            class="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-panel/90 px-2 py-1 text-[11px] font-medium text-surface shadow-sm ring-1 ring-border backdrop-blur-sm"
          >
            <icon-lucide-pencil class="size-3 shrink-0" />
            <span class="truncate">{{ note.annotationAffordance }}</span>
          </div>
        </div>
        <p class="leading-snug">{{ note.text }}</p>
        <p
          v-if="note.mode === 'text'"
          class="mt-2 flex items-center gap-1 text-xs font-medium text-muted"
        >
          <icon-lucide-pencil class="size-3" />
          {{ note.annotationAffordance }}
        </p>
        <button
          type="button"
          class="mt-3 rounded-md bg-surface px-3 py-1.5 text-xs font-medium text-panel"
          @click="dismissFeedbackNote(note.id)"
        >
          {{ feedbackNoteState.notes.length > 1 ? 'Next note' : 'Continue' }}
        </button>
      </div>
    </Transition>
  </div>
</template>
