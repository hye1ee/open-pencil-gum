<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { onBeforeUnmount, reactive, ref, useTemplateRef, watch } from 'vue'

import { CODE_VISUAL_SIZE_BRIDGE_SOURCE } from '@/app/feedback-note/code-visual/document'
import { captureCodeVisualSelection } from '@/app/feedback-note/draft/code-visual'
import {
  forgetConfirmedFeedback,
  rememberConfirmedFeedback
} from '@/app/feedback-note/draft/history'
import { cropFeedbackImage } from '@/app/feedback-note/draft/image'
import type { FeedbackSelection } from '@/app/feedback-note/draft/types'
import { generateFeedbackDraft } from '@/app/feedback-note/draft/use'
import { dismissFeedbackNote, feedbackNoteState, openFeedbackNote } from '@/app/feedback-note/use'
import type { FeedbackCueSegment } from '@/app/feedback-note/types'
import { useEditorStore } from '@/app/editor/active-store'
import type { Vector } from '@open-pencil/scene-graph/primitives'

type NoteSelection = FeedbackSelection

type TextSelectionSource = 'cue' | 'reasoning' | 'proposition' | 'proposition-rationale'

interface SelectionPart {
  text: string
  selected: boolean
}

interface CollectedFeedback {
  id: string
  selection: NoteSelection
  text: string
}

interface RegionDrag {
  noteId: string
  start: Vector
}

type NoteQueueOrigin =
  | { type: 'canvas'; x: number; y: number; offsetX: number; offsetY: number }
  | { type: 'screen'; x: number; y: number }

const { canvasEl } = defineProps<{ canvasEl: HTMLCanvasElement | null }>()
const store = useEditorStore()
const hoveredId = ref<string | null>(null)
const introducedIds = ref<string[]>([])
const seenIds = new Set<string>()
const introTimers = new Map<string, ReturnType<typeof setTimeout>>()
const selections = reactive<Record<string, NoteSelection | undefined>>({})
const feedbackDrafts = reactive<Record<string, string>>({})
const feedbackSuggestions = reactive<Record<string, string | undefined>>({})
const suggestionLoading = reactive<Record<string, boolean | undefined>>({})
const collectedFeedback = reactive<Record<string, CollectedFeedback[] | undefined>>({})
const hoveredFeedback = ref<{ noteId: string; index: number } | null>(null)
const provenanceIndices = reactive<Record<string, number | undefined>>({})
const codeVisualAspectRatios = reactive<Record<string, string | undefined>>({})
const codeVisualFrames = useTemplateRef<HTMLIFrameElement[]>('codeVisualFrames')
const regionDrag = ref<RegionDrag | null>(null)
let ownsHighlight = false
let noteQueueOrigin: NoteQueueOrigin | null = null
const suggestionVersions = new Map<string, number>()

const NOTE_COLUMN_WIDTH = 344
const NOTE_EDGE_GAP = 16
const NOTE_MARKER_WIDTH = 40

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
  const note = feedbackNoteState.notes.find((candidate) => candidate.id === noteId)
  if (note?.representation.type !== 'image' && note?.representation.type !== 'code-visual') return
  if (event.button !== 0) return
  const start = relativePoint(event)
  if (!start) return
  beginSuggestionRequest(noteId)
  regionDrag.value = { noteId, start }
  selections[noteId] = { type: 'region', x: start.x, y: start.y, width: 0, height: 0 }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function updateRegion(noteId: string, event: PointerEvent) {
  const drag = regionDrag.value
  const point = relativePoint(event)
  if (!drag || drag.noteId !== noteId || !point) return
  selections[noteId] = {
    type: 'region',
    x: Math.min(drag.start.x, point.x),
    y: Math.min(drag.start.y, point.y),
    width: Math.abs(point.x - drag.start.x),
    height: Math.abs(point.y - drag.start.y)
  }
}

function finishRegion(noteId: string, event: PointerEvent) {
  const selection = selections[noteId]
  if (selection?.type === 'region' && selection.width * selection.height < 0.001) {
    selections[noteId] = undefined
  } else if (selection?.type === 'region') {
    void requestFeedbackSuggestion(noteId, selection)
  }
  const target = event.currentTarget
  if (target instanceof HTMLElement && target.hasPointerCapture(event.pointerId)) {
    target.releasePointerCapture(event.pointerId)
  }
  regionDrag.value = null
}

function selectText(
  noteId: string,
  event: MouseEvent,
  source: TextSelectionSource,
  fullText: string
) {
  const container = event.currentTarget
  const browserSelection = window.getSelection()
  const text = browserSelection?.toString().trim() ?? ''
  if (!(container instanceof HTMLElement) || !browserSelection?.anchorNode || !text) return
  if (!container.contains(browserSelection.anchorNode)) return
  const start = fullText.indexOf(text)
  if (start === -1) return
  beginSuggestionRequest(noteId)
  const selection: NoteSelection = {
    type: 'text',
    text,
    source,
    start,
    end: start + text.length
  }
  selections[noteId] = selection
  void requestFeedbackSuggestion(noteId, selection)
  requestAnimationFrame(() => browserSelection.removeAllRanges())
}

function beginSuggestionRequest(noteId: string) {
  suggestionVersions.set(noteId, (suggestionVersions.get(noteId) ?? 0) + 1)
  feedbackSuggestions[noteId] = undefined
  suggestionLoading[noteId] = false
}

async function requestFeedbackSuggestion(noteId: string, selection: NoteSelection) {
  const note = feedbackNoteState.notes.find((candidate) => candidate.id === noteId)
  if (!note) return
  const version = suggestionVersions.get(noteId) ?? 0
  suggestionLoading[noteId] = true
  try {
    let images: { overviewImage?: Uint8Array; selectionImage?: Uint8Array } = {}
    if (note.representation.type === 'image' && note.representation.url) {
      try {
        images = await cropFeedbackImage(note.representation.url, selection)
      } catch (error) {
        console.warn('[feedback-note] could not crop draft context:', error)
      }
    } else if (note.representation.type === 'code-visual') {
      const frame = codeVisualFrames.value?.find((candidate) => candidate.dataset.noteId === noteId)
      if (frame) {
        try {
          images = await captureCodeVisualSelection(frame, selection)
        } catch (error) {
          console.warn('[feedback-note] could not capture code visual draft context:', error)
        }
      }
    }
    const suggestion = await generateFeedbackDraft({
      note,
      selection: copySelection(selection),
      ...images
    })
    if (suggestionVersions.get(noteId) !== version) return
    if (!feedbackDrafts[noteId]?.trim()) feedbackSuggestions[noteId] = suggestion ?? undefined
  } catch (error) {
    console.warn('[feedback-note] draft suggestion failed:', error)
  } finally {
    if (suggestionVersions.get(noteId) === version) suggestionLoading[noteId] = false
  }
}

function acceptFeedbackSuggestion(noteId: string) {
  const suggestion = feedbackSuggestions[noteId]
  if (!suggestion) return
  feedbackDrafts[noteId] = suggestion
  feedbackSuggestions[noteId] = undefined
}

function acceptSuggestionOnTab(noteId: string, event: KeyboardEvent) {
  if (!feedbackDrafts[noteId]?.trim() && feedbackSuggestions[noteId]) {
    event.preventDefault()
    acceptFeedbackSuggestion(noteId)
  }
}

function selectionParts(
  noteId: string,
  text: string,
  source: TextSelectionSource,
  offset = 0
): SelectionPart[] {
  const selection = highlightedSelection(noteId)
  if (selection?.type !== 'text' || selection.source !== source) {
    return [{ text, selected: false }]
  }
  const localStart = Math.max(0, selection.start - offset)
  const localEnd = Math.min(text.length, selection.end - offset)
  if (localStart >= localEnd) return [{ text, selected: false }]
  return [
    { text: text.slice(0, localStart), selected: false },
    { text: text.slice(localStart, localEnd), selected: true },
    { text: text.slice(localEnd), selected: false }
  ].filter((part) => part.text !== '')
}

function highlightedSelection(noteId: string): NoteSelection | undefined {
  const hovered = hoveredFeedback.value
  if (hovered?.noteId === noteId) {
    return collectedFeedback[noteId]?.[hovered.index]?.selection
  }
  return selections[noteId]
}

function isFeedbackHighlightActive(noteId: string): boolean {
  return hoveredFeedback.value?.noteId === noteId
}

function cueSegmentOffset(
  note: (typeof feedbackNoteState.notes)[number],
  segmentIndex: number
): number {
  return note.cueSegments
    .slice(0, segmentIndex)
    .reduce((length, segment) => length + segment.text.length + 1, 0)
}

function regionStyle(noteId: string) {
  const selection = highlightedSelection(noteId)
  if (selection?.type !== 'region') return undefined
  return {
    left: `${selection.x * 100}%`,
    top: `${selection.y * 100}%`,
    width: `${selection.width * 100}%`,
    height: `${selection.height * 100}%`
  }
}

function clearSelection(noteId: string) {
  beginSuggestionRequest(noteId)
  selections[noteId] = undefined
  feedbackDrafts[noteId] = ''
}

function hasAnnotation(noteId: string) {
  return Boolean(selections[noteId])
}

function hasFeedbackDraft(noteId: string): boolean {
  return Boolean(feedbackDrafts[noteId]?.trim())
}

function feedbackCount(noteId: string): number {
  return collectedFeedback[noteId]?.length ?? 0
}

function feedbackTargetLabel(selection: NoteSelection): string {
  if (selection.type === 'region') return 'Selected visual region'
  const compact = selection.text.replaceAll(/\s+/g, ' ').trim()
  return compact.length > 56 ? `“${compact.slice(0, 56)}…”` : `“${compact}”`
}

function removeFeedback(noteId: string, index: number) {
  if (hoveredFeedback.value?.noteId === noteId) hoveredFeedback.value = null
  const removed = collectedFeedback[noteId]?.[index]
  if (removed) forgetConfirmedFeedback(removed.id)
  collectedFeedback[noteId] = (collectedFeedback[noteId] ?? []).filter(
    (_, itemIndex) => itemIndex !== index
  )
}

function copySelection(selection: NoteSelection): NoteSelection {
  if (selection.type === 'region') {
    return {
      type: 'region',
      x: selection.x,
      y: selection.y,
      width: selection.width,
      height: selection.height
    }
  }
  return {
    type: 'text',
    text: selection.text,
    source: selection.source,
    start: selection.start,
    end: selection.end
  }
}

function addFeedback(noteId: string): boolean {
  const selection = selections[noteId]
  const text = feedbackDrafts[noteId]?.trim()
  const note = feedbackNoteState.notes.find((candidate) => candidate.id === noteId)
  if (!selection || !text || !note) return false
  const copiedSelection = copySelection(selection)
  const id = rememberConfirmedFeedback(note, copiedSelection, text)
  collectedFeedback[noteId] = [
    ...(collectedFeedback[noteId] ?? []),
    { id, selection: copiedSelection, text }
  ]
  clearSelection(noteId)
  return true
}

function continueFeedbackNote(noteId: string) {
  if (hasFeedbackDraft(noteId)) addFeedback(noteId)
  dismissFeedbackNote(noteId)
}

function toggleProvenance(noteId: string, segmentIndex: number) {
  if (window.getSelection()?.toString().trim()) return
  provenanceIndices[noteId] = provenanceIndices[noteId] === segmentIndex ? undefined : segmentIndex
}

function provenanceSegment(
  note: (typeof feedbackNoteState.notes)[number]
): FeedbackCueSegment | null {
  const index = provenanceIndices[note.id]
  return index === undefined ? null : (note.cueSegments[index] ?? null)
}

function propositionConfidence(segment: FeedbackCueSegment | null): string {
  if (segment?.source !== 'proposition') return ''
  return `${(segment.propositionConfidence * 9 + 1).toFixed(0)}/10 confidence`
}

function reasoningEvidence(note: (typeof feedbackNoteState.notes)[number]): string {
  const segment = provenanceSegment(note)
  return segment?.source === 'reasoning' ? segment.evidenceQuote : ''
}

function propositionText(note: (typeof feedbackNoteState.notes)[number]): string {
  const segment = provenanceSegment(note)
  return segment?.source === 'proposition' ? segment.propositionText : ''
}

function propositionRationale(note: (typeof feedbackNoteState.notes)[number]): string {
  const segment = provenanceSegment(note)
  return segment?.source === 'proposition' ? (segment.propositionRationale ?? '') : ''
}

function anchoredNodeId(note: (typeof feedbackNoteState.notes)[number]) {
  return note.nodeId && store.graph.getNode(note.nodeId) ? note.nodeId : null
}

function createQueueOrigin(note: (typeof feedbackNoteState.notes)[number]): NoteQueueOrigin {
  const nodeId = anchoredNodeId(note)
  if (nodeId) {
    const node = store.graph.getNode(nodeId)
    if (node) {
      const absolute = store.graph.getAbsolutePosition(nodeId)
      return {
        type: 'canvas',
        x: absolute.x + node.width,
        y: absolute.y,
        offsetX: 8,
        offsetY: -8
      }
    }
  }
  const cursor = store.state.agentCursor
  if (cursor) {
    return { type: 'canvas', x: cursor.x, y: cursor.y, offsetX: 8, offsetY: 34 }
  }
  return { type: 'screen', x: NOTE_EDGE_GAP, y: 24 }
}

function queueOriginPosition(note: (typeof feedbackNoteState.notes)[number]): Vector {
  noteQueueOrigin ??= createQueueOrigin(note)
  if (noteQueueOrigin.type === 'screen') return noteQueueOrigin
  const { zoom, panX, panY } = store.state
  return {
    x: noteQueueOrigin.x * zoom + panX + noteQueueOrigin.offsetX,
    y: noteQueueOrigin.y * zoom + panY + noteQueueOrigin.offsetY
  }
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
  void store.state.sceneVersion
  const origin = queueOriginPosition(note)
  const canvasWidth = canvasEl?.clientWidth ?? NOTE_COLUMN_WIDTH
  const noteWidth = (candidate: (typeof feedbackNoteState.notes)[number]) =>
    feedbackNoteState.activeId === candidate.id ? NOTE_COLUMN_WIDTH : NOTE_MARKER_WIDTH
  const offsetX = feedbackNoteState.notes
    .slice(0, index)
    .reduce((width, candidate) => width + noteWidth(candidate), 0)
  const rowWidth = feedbackNoteState.notes.reduce(
    (width, candidate) => width + noteWidth(candidate),
    0
  )
  const startX = Math.min(
    Math.max(NOTE_EDGE_GAP, origin.x),
    Math.max(NOTE_EDGE_GAP, canvasWidth - rowWidth - NOTE_EDGE_GAP)
  )
  return {
    x: startX + offsetX,
    y: origin.y
  }
}

function rating(relationship: (typeof feedbackNoteState.notes)[number]['relationship']) {
  if (relationship === 'conflict') return -3
  if (relationship === 'alignment') return 3
  return 0
}

function visualUrl(note: (typeof feedbackNoteState.notes)[number]): string | null {
  if (note.representation.type === 'image') return note.representation.url
  return null
}

function visualHtml(note: (typeof feedbackNoteState.notes)[number]): string | null {
  return note.representation.type === 'code-visual'
    ? (note.representation.artifact?.srcdoc ?? null)
    : null
}

function visualIsLoading(note: (typeof feedbackNoteState.notes)[number]): boolean {
  return (
    (note.representation.type === 'code-visual' || note.representation.type === 'image') &&
    note.representation.status === 'loading'
  )
}

function hasVisualArtifact(note: (typeof feedbackNoteState.notes)[number]): boolean {
  return Boolean(visualUrl(note) || visualHtml(note))
}

function codeVisualStyle(noteId: string) {
  return { aspectRatio: codeVisualAspectRatios[noteId] ?? '720 / 240' }
}

useEventListener(window, 'message', (event: MessageEvent) => {
  const message = event.data
  if (
    typeof message !== 'object' ||
    message === null ||
    message.source !== CODE_VISUAL_SIZE_BRIDGE_SOURCE ||
    typeof message.noteId !== 'string' ||
    typeof message.width !== 'number' ||
    typeof message.height !== 'number' ||
    message.width < 1 ||
    message.height < 1 ||
    message.height > 1200
  ) {
    return
  }
  const note = feedbackNoteState.notes.find((candidate) => candidate.id === message.noteId)
  if (note?.representation.type !== 'code-visual') return
  codeVisualAspectRatios[note.id] = `${message.width} / ${message.height}`
})

watch(
  () => feedbackNoteState.notes.map((note) => note.id),
  (ids, previousIds) => {
    if (ids.length === 0 || !previousIds?.some((id) => ids.includes(id))) {
      noteQueueOrigin = null
    }
  },
  { flush: 'sync' }
)

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
      class="pointer-events-none absolute transition-[left,top] duration-300 ease-out"
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
        <icon-lucide-circle-check-big v-if="note.relationship === 'alignment'" class="size-4" />
        <icon-lucide-triangle-alert v-else-if="note.relationship === 'conflict'" class="size-4" />
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
            class="relative min-h-36 w-80 max-w-[min(80vw,52rem)] min-w-72 resize-x overflow-auto rounded-xl bg-panel p-4 shadow-xl ring-1 ring-border h-auto!"
          >
            <p class="mb-2 pr-10 text-xs font-semibold tracking-wide text-muted">
              Note from Step {{ note.originStep }} · Chunk {{ note.originChunk }}
            </p>
            <div
              v-if="visualIsLoading(note)"
              class="mb-3 flex aspect-3/2 items-center justify-center rounded-lg bg-hover text-muted"
            >
              <icon-lucide-loader-circle class="size-5 animate-spin" />
            </div>
            <div
              v-else-if="hasVisualArtifact(note)"
              class="relative mb-3 cursor-crosshair touch-none overflow-hidden rounded-lg select-none"
              @pointerdown.prevent="startRegion(note.id, $event)"
              @pointermove="updateRegion(note.id, $event)"
              @pointerup="finishRegion(note.id, $event)"
              @pointercancel="finishRegion(note.id, $event)"
            >
              <iframe
                v-if="visualHtml(note)"
                ref="codeVisualFrames"
                :srcdoc="visualHtml(note) ?? undefined"
                :data-note-id="note.id"
                title="Interactive feedback representation"
                sandbox="allow-scripts allow-same-origin"
                class="pointer-events-none block w-full border-0 bg-transparent"
                :style="codeVisualStyle(note.id)"
              />
              <img
                v-else
                :src="visualUrl(note) ?? undefined"
                alt="Interactive feedback representation"
                draggable="false"
                class="pointer-events-none h-auto w-full object-contain"
              />
              <div
                v-if="highlightedSelection(note.id)?.type === 'region'"
                class="pointer-events-none absolute border-2 border-violet-500 bg-violet-400/10 shadow-sm"
                :class="{
                  'animate-pulse ring-4 ring-violet-300/70': isFeedbackHighlightActive(note.id)
                }"
                :style="regionStyle(note.id)"
              />
            </div>
            <p
              class="cursor-text text-base leading-snug select-text [-webkit-user-select:text] selection:bg-violet-300/70 selection:text-surface"
              @mouseup="selectText(note.id, $event, 'cue', note.text)"
            >
              <template v-for="(cueSegment, cueIndex) in note.cueSegments" :key="cueIndex">
                <span v-if="cueIndex > 0">{{ ' ' }}</span>
                <span
                  :role="cueSegment.source === 'neutral' ? undefined : 'button'"
                  :tabindex="cueSegment.source === 'neutral' ? undefined : 0"
                  :class="{
                    'cursor-pointer rounded-sm underline decoration-amber-500 decoration-2 decoration-dotted underline-offset-4 transition hover:bg-amber-100':
                      cueSegment.source === 'reasoning',
                    'cursor-pointer rounded-sm underline decoration-sky-500 decoration-2 decoration-dotted underline-offset-4 transition hover:bg-sky-100':
                      cueSegment.source === 'proposition',
                    'bg-amber-100':
                      cueSegment.source === 'reasoning' && provenanceIndices[note.id] === cueIndex,
                    'bg-sky-100':
                      cueSegment.source === 'proposition' && provenanceIndices[note.id] === cueIndex
                  }"
                  @click.stop="
                    cueSegment.source !== 'neutral' && toggleProvenance(note.id, cueIndex)
                  "
                  @keydown.enter.prevent="
                    cueSegment.source !== 'neutral' && toggleProvenance(note.id, cueIndex)
                  "
                  @keydown.space.prevent="
                    cueSegment.source !== 'neutral' && toggleProvenance(note.id, cueIndex)
                  "
                >
                  <span
                    v-for="(part, partIndex) in selectionParts(
                      note.id,
                      cueSegment.text,
                      'cue',
                      cueSegmentOffset(note, cueIndex)
                    )"
                    :key="partIndex"
                    :class="{
                      'rounded-sm bg-violet-300/60': part.selected,
                      'animate-pulse ring-2 ring-violet-300/70':
                        part.selected && isFeedbackHighlightActive(note.id)
                    }"
                    >{{ part.text }}</span
                  >
                </span>
              </template>
            </p>
            <div
              v-if="provenanceSegment(note)?.source === 'reasoning'"
              class="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-surface ring-1 ring-amber-200"
            >
              <p class="mb-1 flex items-center gap-1.5 font-semibold text-amber-700">
                <icon-lucide-brain class="size-3.5" />
                From agent reasoning
              </p>
              <p
                class="cursor-text leading-relaxed text-muted select-text [-webkit-user-select:text] selection:bg-violet-300/70 selection:text-surface"
                @mouseup="
                  provenanceSegment(note)?.source === 'reasoning' &&
                  selectText(note.id, $event, 'reasoning', reasoningEvidence(note))
                "
              >
                <span>“</span
                ><span
                  v-for="(part, partIndex) in selectionParts(
                    note.id,
                    reasoningEvidence(note),
                    'reasoning'
                  )"
                  :key="partIndex"
                  :class="{
                    'rounded-sm bg-violet-300/60': part.selected,
                    'animate-pulse ring-2 ring-violet-300/70':
                      part.selected && isFeedbackHighlightActive(note.id)
                  }"
                  >{{ part.text }}</span
                ><span>”</span>
              </p>
            </div>
            <div
              v-else-if="provenanceSegment(note)?.source === 'proposition'"
              class="mt-3 rounded-lg bg-sky-50 p-3 text-xs text-surface ring-1 ring-sky-200"
            >
              <p class="mb-1 flex items-center justify-between gap-2 font-semibold text-sky-700">
                <span class="flex items-center gap-1.5">
                  <icon-lucide-user-round class="size-3.5" />
                  From user model
                </span>
                <span class="font-normal text-sky-600">
                  {{ propositionConfidence(provenanceSegment(note)) }}
                </span>
              </p>
              <p
                class="cursor-text leading-relaxed text-muted select-text [-webkit-user-select:text] selection:bg-violet-300/70 selection:text-surface"
                @mouseup="
                  provenanceSegment(note)?.source === 'proposition' &&
                  selectText(note.id, $event, 'proposition', propositionText(note))
                "
              >
                <span
                  v-for="(part, partIndex) in selectionParts(
                    note.id,
                    propositionText(note),
                    'proposition'
                  )"
                  :key="partIndex"
                  :class="{
                    'rounded-sm bg-violet-300/60': part.selected,
                    'animate-pulse ring-2 ring-violet-300/70':
                      part.selected && isFeedbackHighlightActive(note.id)
                  }"
                  >{{ part.text }}</span
                >
              </p>
              <p
                v-if="
                  provenanceSegment(note)?.source === 'proposition' && propositionRationale(note)
                "
                class="mt-1.5 cursor-text border-t border-sky-200 pt-1.5 leading-relaxed text-muted select-text [-webkit-user-select:text] selection:bg-violet-300/70 selection:text-surface"
                @mouseup="
                  provenanceSegment(note)?.source === 'proposition' &&
                  selectText(note.id, $event, 'proposition-rationale', propositionRationale(note))
                "
              >
                <span
                  v-for="(part, partIndex) in selectionParts(
                    note.id,
                    propositionRationale(note),
                    'proposition-rationale'
                  )"
                  :key="partIndex"
                  :class="{
                    'rounded-sm bg-violet-300/60': part.selected,
                    'animate-pulse ring-2 ring-violet-300/70':
                      part.selected && isFeedbackHighlightActive(note.id)
                  }"
                  >{{ part.text }}</span
                >
              </p>
            </div>
            <div v-if="feedbackCount(note.id) > 0" class="mt-3 space-y-1.5 pr-10">
              <div
                v-for="(feedback, feedbackIndex) in collectedFeedback[note.id] ?? []"
                :key="feedbackIndex"
                class="flex items-center gap-2 rounded-lg bg-violet-50 px-2.5 py-2 text-xs ring-1 ring-violet-200 transition hover:bg-violet-100 hover:ring-violet-400"
                :title="`${feedbackTargetLabel(feedback.selection)} — ${feedback.text}`"
                @mouseenter="hoveredFeedback = { noteId: note.id, index: feedbackIndex }"
                @mouseleave="hoveredFeedback = null"
              >
                <icon-lucide-message-square class="size-3.5 shrink-0 text-violet-600" />
                <p class="min-w-0 flex-1 truncate text-surface">{{ feedback.text }}</p>
                <button
                  type="button"
                  class="flex size-5 shrink-0 items-center justify-center rounded text-violet-400 hover:bg-violet-100 hover:text-violet-700"
                  aria-label="Remove this feedback"
                  @click="removeFeedback(note.id, feedbackIndex)"
                >
                  <icon-lucide-x class="size-3" />
                </button>
              </div>
            </div>
            <button
              type="button"
              class="absolute top-2 right-2 flex size-7 items-center justify-center rounded-md bg-surface text-panel shadow-sm transition hover:translate-x-0.5 hover:opacity-90"
              :class="{ 'bg-violet-600': hasFeedbackDraft(note.id) || feedbackCount(note.id) > 0 }"
              :aria-label="
                hasFeedbackDraft(note.id) || feedbackCount(note.id) > 0
                  ? 'Send feedback and continue'
                  : feedbackNoteState.notes.length > 1
                    ? 'Next note'
                    : 'Continue'
              "
              :title="
                hasFeedbackDraft(note.id) || feedbackCount(note.id) > 0
                  ? 'Send feedback and continue'
                  : feedbackNoteState.notes.length > 1
                    ? 'Next note'
                    : 'Continue'
              "
              @click="continueFeedbackNote(note.id)"
            >
              <icon-lucide-send-horizontal
                v-if="hasFeedbackDraft(note.id) || feedbackCount(note.id) > 0"
                class="size-3.5"
              />
              <icon-lucide-arrow-right v-else class="size-3.5" />
            </button>
          </div>

          <div class="absolute top-full left-0 mt-3 flex w-full items-end">
            <Transition
              enter-active-class="transition duration-200 ease-out"
              enter-from-class="-translate-x-2 opacity-0"
              leave-active-class="transition duration-150 ease-in"
              leave-to-class="-translate-x-2 opacity-0"
            >
              <div
                v-if="hasAnnotation(note.id)"
                class="relative w-full min-w-0 rounded-xl bg-panel p-1.5 shadow-lg ring-1 ring-border"
              >
                <button
                  v-if="!feedbackDrafts[note.id] && feedbackSuggestions[note.id]"
                  type="button"
                  class="absolute top-3 right-10 left-4 z-10 line-clamp-3 text-left text-sm leading-snug text-muted/70 italic hover:text-muted"
                  aria-label="Use suggested feedback"
                  title="Click or press Tab to use this suggestion"
                  @click="acceptFeedbackSuggestion(note.id)"
                >
                  {{ feedbackSuggestions[note.id] }}
                  <span
                    class="ml-1 whitespace-nowrap text-[10px] font-medium text-violet-500 not-italic"
                  >
                    Tab to use
                  </span>
                </button>
                <div
                  v-else-if="suggestionLoading[note.id] && !feedbackDrafts[note.id]"
                  class="pointer-events-none absolute top-3 left-4 flex items-center gap-1.5 text-sm text-muted/60 italic"
                >
                  <icon-lucide-loader-circle class="size-3.5 animate-spin" />
                  Drafting a suggestion…
                </div>
                <textarea
                  v-model="feedbackDrafts[note.id]"
                  rows="1"
                  class="max-h-64 min-h-16 w-full min-w-0 resize-none rounded-lg border border-border bg-panel py-2 pr-10 pl-3 text-sm text-surface outline-none [field-sizing:content] placeholder:text-muted focus:border-violet-400 focus:ring-1 focus:ring-violet-300"
                  :placeholder="
                    feedbackSuggestions[note.id] || suggestionLoading[note.id]
                      ? ''
                      : 'Explain this selection…'
                  "
                  aria-label="Feedback about selected area"
                  @input="feedbackSuggestions[note.id] = undefined"
                  @keydown.tab="acceptSuggestionOnTab(note.id, $event)"
                  @keydown.meta.enter.prevent="continueFeedbackNote(note.id)"
                  @keydown.ctrl.enter.prevent="continueFeedbackNote(note.id)"
                />
                <div class="mt-1.5 flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    class="flex size-8 items-center justify-center rounded-lg bg-violet-600 text-white shadow-sm hover:bg-violet-500 disabled:cursor-default disabled:opacity-40"
                    :disabled="!hasFeedbackDraft(note.id)"
                    aria-label="Add feedback to this note"
                    title="Add another feedback item"
                    @click="addFeedback(note.id)"
                  >
                    <icon-lucide-plus class="size-4" />
                  </button>
                </div>
                <button
                  type="button"
                  class="absolute top-2 right-2 flex size-7 items-center justify-center rounded-md bg-panel text-muted hover:bg-hover hover:text-surface"
                  aria-label="Close feedback input"
                  @click="clearSelection(note.id)"
                >
                  <icon-lucide-x class="size-4" />
                </button>
              </div>
            </Transition>
          </div>
        </div>
      </Transition>
    </div>
  </template>
</template>
