<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, watch } from 'vue'

import { dismissFeedbackNote, feedbackNoteState, openFeedbackNote } from '@/app/feedback-note/use'
import { useEditorStore } from '@/app/editor/active-store'
import type { Vector } from '@open-pencil/scene-graph/primitives'

type NoteSelection =
  | { type: 'image'; x: number; y: number; width: number; height: number }
  | { type: 'text'; text: string }

interface RegionDrag {
  noteId: string
  start: Vector
}

const { canvasEl } = defineProps<{ canvasEl: HTMLCanvasElement | null }>()
const store = useEditorStore()
const hoveredId = ref<string | null>(null)
const introducedIds = ref<string[]>([])
const seenIds = new Set<string>()
const introTimers = new Map<string, ReturnType<typeof setTimeout>>()
const selections = reactive<Record<string, NoteSelection | undefined>>({})
const feedbackDrafts = reactive<Record<string, string>>({})
const submittedFeedback = reactive<Record<string, string>>({})
const regionDrag = ref<RegionDrag | null>(null)
const recordingId = ref<string | null>(null)
let ownsHighlight = false

const NOTE_COLUMN_WIDTH = 344
const NOTE_ROW_HEIGHT = 420
const NOTE_EDGE_GAP = 16

function relativePoint(event: PointerEvent): Vector | null {
  const target = event.currentTarget
  if (!(target instanceof Element)) return null
  const bounds = target.getBoundingClientRect()
  if (bounds.width === 0 || bounds.height === 0) return null
  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
  }
}

function startRegion(noteId: string, event: PointerEvent) {
  if (event.button !== 0) return
  const start = relativePoint(event)
  if (!start) return
  regionDrag.value = { noteId, start }
  selections[noteId] = { type: 'image', x: start.x, y: start.y, width: 0, height: 0 }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function updateRegion(noteId: string, event: PointerEvent) {
  const drag = regionDrag.value
  const point = relativePoint(event)
  if (!drag || drag.noteId !== noteId || !point) return
  selections[noteId] = {
    type: 'image',
    x: Math.min(drag.start.x, point.x),
    y: Math.min(drag.start.y, point.y),
    width: Math.abs(point.x - drag.start.x),
    height: Math.abs(point.y - drag.start.y)
  }
}

function finishRegion(noteId: string, event: PointerEvent) {
  const selection = selections[noteId]
  if (selection?.type === 'image' && selection.width * selection.height < 0.001) {
    delete selections[noteId]
  }
  const target = event.currentTarget
  if (target instanceof HTMLElement && target.hasPointerCapture(event.pointerId)) {
    target.releasePointerCapture(event.pointerId)
  }
  regionDrag.value = null
}

function selectText(noteId: string, event: MouseEvent) {
  const container = event.currentTarget
  const browserSelection = window.getSelection()
  const text = browserSelection?.toString().trim() ?? ''
  if (!(container instanceof HTMLElement) || !browserSelection?.anchorNode || !text) return
  if (!container.contains(browserSelection.anchorNode)) return
  selections[noteId] = { type: 'text', text }
  browserSelection.removeAllRanges()
}

function textSegments(noteId: string, text: string): string[] {
  const selection = selections[noteId]
  if (selection?.type !== 'text') return [text]
  const start = text.indexOf(selection.text)
  if (start < 0) return [text]
  const end = start + selection.text.length
  return [text.slice(0, start), text.slice(start, end), text.slice(end)]
}

function regionStyle(noteId: string) {
  const selection = selections[noteId]
  if (selection?.type !== 'image') return undefined
  return {
    left: `${selection.x * 100}%`,
    top: `${selection.y * 100}%`,
    width: `${selection.width * 100}%`,
    height: `${selection.height * 100}%`
  }
}

function clearSelection(noteId: string) {
  delete selections[noteId]
  delete feedbackDrafts[noteId]
  delete submittedFeedback[noteId]
  if (recordingId.value === noteId) recordingId.value = null
}

function hasAnnotation(noteId: string) {
  return Boolean(selections[noteId])
}

function undoAnnotation(noteId: string) {
  clearSelection(noteId)
}

function toggleRecording(noteId: string) {
  recordingId.value = recordingId.value === noteId ? null : noteId
}

function submitSelectionFeedback(noteId: string) {
  const feedback = feedbackDrafts[noteId]?.trim()
  if (!feedback) return
  submittedFeedback[noteId] = feedback
}

function anchorSlot(note: (typeof feedbackNoteState.notes)[number], index: number) {
  const nodeId = anchoredNodeId(note)
  return feedbackNoteState.notes
    .slice(0, index)
    .filter((candidate) => anchoredNodeId(candidate) === nodeId).length
}

function anchoredNodeId(note: (typeof feedbackNoteState.notes)[number]) {
  return note.nodeId && store.graph.getNode(note.nodeId) ? note.nodeId : null
}

function targetStyle(note: (typeof feedbackNoteState.notes)[number]) {
  const nodeId = anchoredNodeId(note)
  if (!nodeId) return undefined
  const node = store.graph.getNode(nodeId)
  if (!node) return undefined
  const absolute = store.graph.getAbsolutePosition(nodeId)
  const { zoom, panX, panY } = store.state
  void store.state.sceneVersion
  return {
    left: `${absolute.x * zoom + panX}px`,
    top: `${absolute.y * zoom + panY}px`,
    width: `${node.width * zoom}px`,
    height: `${node.height * zoom}px`
  }
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
        x: (absolute.x + node.width) * zoom + panX + 8 + slot * 344,
        y: absolute.y * zoom + panY - 8
      }
    }
  }
  const cursor = store.state.agentCursor
  if (cursor) {
    const canvasWidth = canvasEl?.clientWidth ?? NOTE_COLUMN_WIDTH
    const columns = Math.max(1, Math.floor((canvasWidth - NOTE_EDGE_GAP * 2) / NOTE_COLUMN_WIDTH))
    const column = slot % columns
    const row = Math.floor(slot / columns)
    const rowWidth = Math.min(columns, feedbackNoteState.notes.length) * NOTE_COLUMN_WIDTH
    const cursorX = cursor.x * zoom + panX + 8
    const startX = Math.min(
      Math.max(NOTE_EDGE_GAP, cursorX),
      Math.max(NOTE_EDGE_GAP, canvasWidth - rowWidth - NOTE_EDGE_GAP)
    )
    return {
      x: startX + column * NOTE_COLUMN_WIDTH,
      y: cursor.y * zoom + panY + 34 + row * NOTE_ROW_HEIGHT
    }
  }
  return {
    x: NOTE_EDGE_GAP + (slot % 2) * NOTE_COLUMN_WIDTH,
    y: 24 + Math.floor(slot / 2) * NOTE_ROW_HEIGHT
  }
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
  <template v-for="(note, index) in feedbackNoteState.notes" :key="note.id">
    <div
      v-if="feedbackNoteState.activeId === note.id && targetStyle(note)"
      class="pointer-events-none absolute z-20 animate-pulse rounded-md ring-2 ring-current ring-offset-2 ring-offset-transparent"
      :class="tone(note.relationship)"
      :style="targetStyle(note)"
    />

    <div
      class="pointer-events-none absolute"
      :class="feedbackNoteState.activeId === note.id ? 'z-40' : 'z-30'"
      :style="{ left: `${position(note, index).x}px`, top: `${position(note, index).y}px` }"
      @pointerenter="hoveredId = note.id"
      @pointerleave="hoveredId = null"
    >
      <button
        type="button"
        class="pointer-events-auto flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-panel shadow-md ring-2 transition hover:scale-105"
        :class="[tone(note.relationship), { 'animate-pulse': introducedIds.includes(note.id) }]"
        :aria-label="`Open ${note.relationship} feedback note`"
        @click="openFeedbackNote(note.id)"
      >
        <icon-lucide-circle-check-big
          v-if="note.relationship === 'alignment'"
          class="size-4"
        />
        <icon-lucide-triangle-alert
          v-else-if="note.relationship === 'conflict'"
          class="size-4"
        />
        <icon-lucide-circle-help v-else class="size-4" />
      </button>

      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="translate-y-1 opacity-0"
        leave-active-class="transition duration-150 ease-in"
        leave-to-class="translate-y-1 opacity-0"
      >
        <div
          v-if="feedbackNoteState.activeId === note.id"
          class="pointer-events-auto absolute top-5 left-2 w-max max-w-[min(80vw,52rem)] text-sm text-surface"
          @pointerdown="openFeedbackNote(note.id)"
        >
          <div
            class="relative min-h-36 w-80 max-w-[min(80vw,52rem)] min-w-72 resize overflow-auto rounded-xl bg-panel p-4 shadow-xl ring-1 ring-border"
          >
            <p class="mb-2 text-xs font-semibold tracking-wide text-muted">
              Note from Step {{ note.originStep }} · Chunk {{ note.originChunk }}
            </p>
            <div
              v-if="note.imageStatus === 'loading'"
              class="mb-3 flex aspect-3/2 items-center justify-center rounded-lg bg-hover text-muted"
            >
              <icon-lucide-loader-circle class="size-5 animate-spin" />
            </div>
            <div
              v-else-if="note.imageUrl"
              class="relative mb-3 cursor-crosshair touch-none overflow-hidden rounded-lg select-none"
              @pointerdown.prevent="startRegion(note.id, $event)"
              @pointermove="updateRegion(note.id, $event)"
              @pointerup="finishRegion(note.id, $event)"
              @pointercancel="finishRegion(note.id, $event)"
            >
              <img
                :src="note.imageUrl"
                alt="Interactive feedback representation"
                draggable="false"
                class="pointer-events-none h-auto w-full object-contain"
              />
              <div
                v-if="selections[note.id]?.type === 'image'"
                class="pointer-events-none absolute border-2 border-violet-500 bg-violet-400/10 shadow-sm"
                :style="regionStyle(note.id)"
              />
              <div
                class="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-panel/90 px-2 py-1 text-[11px] font-medium text-surface shadow-sm ring-1 ring-border backdrop-blur-sm"
              >
                <icon-lucide-pencil class="size-3 shrink-0" />
                <span class="truncate">{{ note.annotationAffordance }}</span>
              </div>
            </div>
            <p
              class="cursor-text text-base leading-snug select-text [-webkit-user-select:text] selection:bg-violet-300/70 selection:text-surface"
              @mouseup="selectText(note.id, $event)"
            >
              <span
                v-for="(segment, segmentIndex) in textSegments(note.id, note.text)"
                :key="segmentIndex"
                :class="{
                  'rounded-sm bg-violet-300/60':
                    textSegments(note.id, note.text).length === 3 && segmentIndex === 1
                }"
                >{{ segment }}</span
              >
            </p>
            <p
              v-if="note.mode === 'text'"
              class="mt-3 flex items-center gap-1 text-sm font-medium text-muted"
            >
              <icon-lucide-pencil class="size-3.5" />
              {{ note.annotationAffordance }}
            </p>
          </div>

          <div class="absolute top-full left-0 mt-3 flex w-full items-center gap-2">
            <div
              class="grid flex-1 transition-[grid-template-columns,opacity,transform] duration-500 ease-out"
              :class="
                hasAnnotation(note.id)
                  ? 'grid-cols-[1fr] translate-x-0 opacity-100'
                  : 'pointer-events-none grid-cols-[0fr] -translate-x-2 opacity-0'
              "
            >
              <div
                v-if="hasAnnotation(note.id)"
                class="flex min-w-0 items-center gap-1.5 overflow-hidden rounded-xl bg-panel p-1.5 shadow-lg ring-1 ring-border"
              >
                <input
                  v-model="feedbackDrafts[note.id]"
                  type="text"
                  class="h-9 min-w-0 flex-1 rounded-lg border border-border bg-panel px-3 text-sm text-surface outline-none placeholder:text-muted focus:border-violet-400 focus:ring-1 focus:ring-violet-300"
                  :class="{
                    'border-emerald-400': submittedFeedback[note.id] === feedbackDrafts[note.id]
                  }"
                  placeholder="Explain this selection…"
                  aria-label="Feedback about selected area"
                  @keydown.enter.prevent="submitSelectionFeedback(note.id)"
                />
                <button
                  type="button"
                  class="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted ring-1 ring-border hover:bg-hover hover:text-surface"
                  :class="{ 'bg-violet-100': recordingId === note.id }"
                  :aria-pressed="recordingId === note.id"
                  aria-label="Record feedback about selection"
                  @click="toggleRecording(note.id)"
                >
                  <icon-lucide-square v-if="recordingId === note.id" class="size-3" />
                  <span v-else class="relative size-4" aria-hidden="true">
                    <icon-lucide-user-round class="absolute bottom-0 left-0 size-3" />
                    <icon-lucide-audio-lines class="absolute -top-0.5 -right-1 size-2.5" />
                  </span>
                </button>
                <button
                  type="button"
                  class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:cursor-default disabled:opacity-40"
                  :disabled="!feedbackDrafts[note.id]?.trim()"
                  aria-label="Send feedback about selection"
                  @click="submitSelectionFeedback(note.id)"
                >
                  <icon-lucide-send class="size-4" />
                </button>
                <button
                  type="button"
                  class="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted ring-1 ring-border hover:bg-hover hover:text-surface"
                  aria-label="Undo selection"
                  @click="undoAnnotation(note.id)"
                >
                  <icon-lucide-undo-2 class="size-4" />
                </button>
              </div>
            </div>
            <button
              type="button"
              class="ml-auto flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface text-panel shadow-lg transition hover:translate-x-0.5 hover:opacity-90"
              :aria-label="feedbackNoteState.notes.length > 1 ? 'Next note' : 'Continue'"
              :title="feedbackNoteState.notes.length > 1 ? 'Next note' : 'Continue'"
              @click="dismissFeedbackNote(note.id)"
            >
              <icon-lucide-arrow-right class="size-5" />
            </button>
          </div>
        </div>
      </Transition>
    </div>
  </template>
</template>
