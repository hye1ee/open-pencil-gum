<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, ref, useTemplateRef } from 'vue'

import type { ConversationFeedbackItem, ConversationFeedbackNote } from '@/app/conversation/types'
import { CODE_VISUAL_SIZE_BRIDGE_SOURCE } from '@/app/feedback-note/code-visual/document'
import { captureCodeVisualSelection } from '@/app/feedback-note/draft/code-visual'
import { annotateFeedbackImage } from '@/app/feedback-note/draft/image'
import { copyFeedbackSelection, feedbackSelectionLabel } from '@/app/feedback-note/draft/selection'
import { resolveCodeVisualTarget } from '@/app/feedback-note/draft/target'
import type { FeedbackPoint, FeedbackSelection } from '@/app/feedback-note/draft/types'
import { generateLenChatFeedbackDraft } from '@/app/feedback-note/hosts/lenchat/draft'
import { lenChatFeedbackHistory } from '@/app/feedback-note/hosts/lenchat/history'
import { lenChatFeedbackNote } from '@/app/feedback-note/hosts/lenchat/note'
import type { Proposition } from '@/app/user-model/pipeline'

type FeedbackNotePhase = 'reviewed' | 'current' | 'waiting'
type VisualTool = 'region' | 'point' | 'arrow' | 'sequence' | 'freehand'

interface VisualGesture {
  tool: Exclude<VisualTool, 'point' | 'sequence'>
  start: FeedbackPoint
}

interface TextSelectionPart {
  text: string
  selected: boolean
}

const VISUAL_TOOLS: VisualTool[] = ['region', 'point', 'arrow', 'sequence', 'freehand']

const { note, propositions, disabled, phase } = defineProps<{
  note: ConversationFeedbackNote
  propositions: Proposition[]
  disabled?: boolean
  phase: FeedbackNotePhase
}>()
const emit = defineEmits<{
  activate: [id: string]
  continue: [id: string]
  feedback: [id: string, items: ConversationFeedbackItem[]]
}>()

const reply = ref('')
const selection = ref<FeedbackSelection>()
const selectedTool = ref<VisualTool>('region')
const visualGesture = ref<VisualGesture | null>(null)
const suggestion = ref<string | null>(null)
const suggestionLoading = ref(false)
const feedbackItems = ref<ConversationFeedbackItem[]>([])
const hoveredFeedbackIndex = ref<number | null>(null)
const codeVisualAspectRatio = ref('720 / 240')
const codeVisualFrame = useTemplateRef<HTMLIFrameElement>('codeVisualFrame')
let suggestionVersion = 0

const visualReady = computed(
  () =>
    (note.representation.type === 'code-visual' &&
      note.representation.status === 'ready' &&
      note.representation.artifact !== null) ||
    (note.representation.type === 'image' &&
      note.representation.status === 'ready' &&
      note.representation.url !== null)
)
const activeSelection = computed(
  () =>
    (hoveredFeedbackIndex.value === null
      ? selection.value
      : feedbackItems.value[hoveredFeedbackIndex.value]?.selection) ?? null
)

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

function relativePoint(event: PointerEvent): FeedbackPoint | null {
  const target = event.currentTarget
  if (!(target instanceof Element)) return null
  const bounds = target.getBoundingClientRect()
  if (bounds.width === 0 || bounds.height === 0) return null
  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
  }
}

function withVisualTarget(value: FeedbackSelection, container: HTMLElement): FeedbackSelection {
  if (
    value.type === 'none' ||
    value.type === 'text' ||
    note.representation.type !== 'code-visual' ||
    !note.representation.artifact ||
    !codeVisualFrame.value
  ) {
    return value
  }
  const target = resolveCodeVisualTarget({
    frame: codeVisualFrame.value,
    container,
    targets: note.representation.artifact.targets,
    selection: value
  })
  return target ? { ...value, target } : value
}

function startVisualSelection(event: PointerEvent): void {
  if (!visualReady.value || event.button !== 0) return
  const start = relativePoint(event)
  const container = event.currentTarget
  if (!start || !(container instanceof HTMLElement)) return
  suggestionVersion++
  suggestion.value = null
  const tool = selectedTool.value
  if (tool === 'point') {
    selection.value = withVisualTarget({ type: 'point', ...start }, container)
    void requestSuggestion()
    return
  }
  if (tool === 'sequence') {
    const points =
      selection.value?.type === 'sequence' ? [...selection.value.points, start] : [start]
    selection.value = withVisualTarget({ type: 'sequence', points }, container)
    void requestSuggestion()
    return
  }
  visualGesture.value = { tool, start }
  if (tool === 'region') {
    selection.value = { type: 'region', x: start.x, y: start.y, width: 0, height: 0 }
  } else if (tool === 'arrow') {
    selection.value = { type: 'arrow', start, end: start }
  } else {
    selection.value = { type: 'freehand', points: [start] }
  }
  container.setPointerCapture(event.pointerId)
}

function updateVisualSelection(event: PointerEvent): void {
  const gesture = visualGesture.value
  const point = relativePoint(event)
  if (!gesture || !point) return
  if (gesture.tool === 'region') {
    selection.value = {
      type: 'region',
      x: Math.min(gesture.start.x, point.x),
      y: Math.min(gesture.start.y, point.y),
      width: Math.abs(point.x - gesture.start.x),
      height: Math.abs(point.y - gesture.start.y)
    }
  } else if (gesture.tool === 'arrow') {
    selection.value = { type: 'arrow', start: gesture.start, end: point }
  } else if (selection.value?.type === 'freehand') {
    const previous = selection.value.points.at(-1)
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 0.006) {
      selection.value = { type: 'freehand', points: [...selection.value.points, point] }
    }
  }
}

function finishVisualSelection(event: PointerEvent): void {
  if (!visualGesture.value) return
  const container = event.currentTarget
  if (!(container instanceof HTMLElement)) return
  const current = selection.value ? withVisualTarget(selection.value, container) : undefined
  const invalid =
    (current?.type === 'region' && current.width * current.height < 0.001) ||
    (current?.type === 'arrow' &&
      Math.hypot(current.end.x - current.start.x, current.end.y - current.start.y) < 0.025) ||
    (current?.type === 'freehand' && current.points.length < 2)
  selection.value = invalid ? undefined : current
  if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId)
  visualGesture.value = null
  if (selection.value) void requestSuggestion()
}

function selectText(event: MouseEvent, source: 'cue' | 'reasoning', fullText: string): void {
  const container = event.currentTarget
  const browserSelection = window.getSelection()
  const text = browserSelection?.toString().trim() ?? ''
  if (!(container instanceof HTMLElement) || !browserSelection?.anchorNode || !text) return
  if (!container.contains(browserSelection.anchorNode)) return
  const start = fullText.indexOf(text)
  if (start === -1) return
  selection.value = { type: 'text', text, source, start, end: start + text.length }
  browserSelection.removeAllRanges()
  void requestSuggestion()
}

async function requestSuggestion(): Promise<void> {
  const selected = selection.value
  if (!selected) return
  const version = ++suggestionVersion
  suggestion.value = null
  suggestionLoading.value = true
  try {
    let images: { overviewImage?: Uint8Array; annotatedImage?: Uint8Array } = {}
    try {
      if (note.representation.type === 'image' && note.representation.url) {
        images = await annotateFeedbackImage(note.representation.url, selected)
      } else if (note.representation.type === 'code-visual' && codeVisualFrame.value) {
        images = await captureCodeVisualSelection(codeVisualFrame.value, selected)
      }
    } catch (error) {
      // A cross-origin image or an iframe rendering issue should not block a
      // text/context-only draft. The shared generator can operate without images.
      console.warn('[lenchat-feedback-note] visual capture failed; continuing without it:', error)
    }
    const generated = await generateLenChatFeedbackDraft({
      note,
      selection: copyFeedbackSelection(selected),
      propositions,
      ...images
    })
    if (version === suggestionVersion && !reply.value.trim()) suggestion.value = generated
  } catch (error) {
    console.warn('[lenchat-feedback-note] draft suggestion failed:', error)
  } finally {
    if (version === suggestionVersion) suggestionLoading.value = false
  }
}

function selectVisualTool(tool: VisualTool): void {
  selectedTool.value = tool
  if (selection.value?.type !== 'text' && selection.value?.type !== tool) clearSelection()
}

function openGeneralFeedback(): void {
  suggestionVersion++
  selection.value = { type: 'none' }
  suggestion.value = null
}

function clearSelection(): void {
  suggestionVersion++
  selection.value = undefined
  suggestion.value = null
  suggestionLoading.value = false
  reply.value = ''
}

function acceptSuggestion(): void {
  if (!suggestion.value) return
  reply.value = suggestion.value
  suggestion.value = null
}

function acceptSuggestionOnTab(event: KeyboardEvent): void {
  if (!suggestion.value || reply.value) return
  event.preventDefault()
  acceptSuggestion()
}

function addFeedback(): boolean {
  const text = reply.value.trim()
  const selected = selection.value ?? { type: 'none' as const }
  if (!text) return false
  const commonNote = lenChatFeedbackNote(note)
  const copiedSelection = copyFeedbackSelection(selected)
  const id = lenChatFeedbackHistory.remember(commonNote, copiedSelection, text)
  feedbackItems.value = [
    ...feedbackItems.value,
    { id, selection: copiedSelection, text, createdAt: Date.now() }
  ]
  clearSelection()
  return true
}

function removeFeedback(index: number): void {
  const item = feedbackItems.value[index]
  if (item) lenChatFeedbackHistory.forget(item.id)
  feedbackItems.value = feedbackItems.value.filter((_, itemIndex) => itemIndex !== index)
  hoveredFeedbackIndex.value = null
}

function submit(): void {
  if (reply.value.trim()) addFeedback()
  if (feedbackItems.value.length === 0) return
  emit(
    'feedback',
    note.id,
    feedbackItems.value.map((item) => ({
      ...item,
      selection: copyFeedbackSelection(item.selection)
    }))
  )
}

function continueReview(): void {
  if (reply.value.trim() || feedbackItems.value.length > 0) submit()
  else emit('continue', note.id)
}

function regionStyle(): Record<string, string> | undefined {
  const value = activeSelection.value
  if (value?.type !== 'region') return undefined
  return {
    left: `${value.x * 100}%`,
    top: `${value.y * 100}%`,
    width: `${value.width * 100}%`,
    height: `${value.height * 100}%`
  }
}

function pointStyle(point: FeedbackPoint): Record<string, string> {
  return { left: `${point.x * 100}%`, top: `${point.y * 100}%` }
}

function arrowStyle(): Record<string, string> | undefined {
  const value = activeSelection.value
  if (value?.type !== 'arrow') return undefined
  const dx = value.end.x - value.start.x
  const dy = value.end.y - value.start.y
  return {
    left: `${value.start.x * 100}%`,
    top: `${value.start.y * 100}%`,
    width: `${Math.hypot(dx, dy) * 100}%`,
    transform: `rotate(${Math.atan2(dy, dx)}rad)`
  }
}

function freehandPoints(): string {
  const value = activeSelection.value
  return value?.type === 'freehand'
    ? value.points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')
    : ''
}

function textSelectionParts(source: 'cue' | 'reasoning', fullText: string): TextSelectionPart[] {
  const value = activeSelection.value
  if (value?.type !== 'text' || value.source !== source) {
    return [{ text: fullText, selected: false }]
  }
  return [
    { text: fullText.slice(0, value.start), selected: false },
    { text: fullText.slice(value.start, value.end), selected: true },
    { text: fullText.slice(value.end), selected: false }
  ].filter((part) => part.text !== '')
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
  <div
    data-test-id="conversation-feedback-note"
    :data-note-id="note.id"
    class="relative shrink-0 snap-start transition"
    :class="{
      'mr-10 w-[22rem] max-w-[calc(100vw-6rem)]': phase === 'current',
      'w-72 max-w-[calc(100vw-4rem)] cursor-pointer': phase === 'waiting',
      'w-64 max-w-[calc(100vw-4rem)] opacity-60 grayscale': phase === 'reviewed'
    }"
    @click="phase === 'waiting' && emit('activate', note.id)"
  >
    <div
      class="absolute -top-3 -left-3 z-10 flex size-7 items-center justify-center rounded-full bg-white shadow-md ring-2"
      :class="markerTone()"
      :aria-label="`${relationshipLabel()} feedback note`"
      :title="relationshipLabel()"
    >
      <icon-lucide-circle-check-big v-if="note.relationship === 'alignment'" class="size-4" />
      <icon-lucide-triangle-alert v-else-if="note.relationship === 'conflict'" class="size-4" />
      <icon-lucide-circle-help v-else class="size-4" />
    </div>

    <div
      class="relative overflow-hidden rounded-xl bg-white transition"
      :class="{
        'shadow-[0_18px_42px_-24px_rgb(15_23_42/0.42)] ring-1 ring-slate-200': phase === 'current',
        'shadow-sm ring-1 ring-slate-200 hover:ring-violet-200': phase === 'waiting',
        'bg-slate-100 ring-1 ring-slate-200': phase === 'reviewed'
      }"
    >
      <div :class="phase === 'current' ? 'p-5' : 'p-4'">
        <p class="mb-3 pr-10 text-xs font-semibold tracking-wide text-slate-500">
          Note from Step {{ note.originStep }} · Chunk {{ note.originChunk }}
        </p>

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
        <div v-else-if="phase === 'current' && visualReady" class="relative mb-3">
          <div
            class="relative touch-none overflow-hidden rounded-lg bg-slate-50 select-none"
            :class="
              selectedTool === 'point' || selectedTool === 'sequence'
                ? 'cursor-cell'
                : 'cursor-crosshair'
            "
            @pointerdown.prevent="startVisualSelection"
            @pointermove="updateVisualSelection"
            @pointerup="finishVisualSelection"
            @pointercancel="finishVisualSelection"
          >
            <iframe
              v-if="note.representation.type === 'code-visual' && note.representation.artifact"
              ref="codeVisualFrame"
              :srcdoc="note.representation.artifact.srcdoc"
              :data-note-id="note.id"
              :style="{ aspectRatio: codeVisualAspectRatio }"
              title="Feedback note code visual"
              sandbox="allow-scripts allow-same-origin"
              class="pointer-events-none block w-full border-0 bg-slate-50"
            />
            <img
              v-else-if="note.representation.type === 'image' && note.representation.url"
              :src="note.representation.url"
              :alt="note.representationGoal"
              draggable="false"
              class="pointer-events-none block max-h-56 w-full object-contain"
            />
            <div
              v-if="activeSelection?.type === 'region'"
              class="pointer-events-none absolute border-2 border-violet-500 bg-violet-400/10"
              :class="{ 'animate-pulse ring-4 ring-violet-300/70': hoveredFeedbackIndex !== null }"
              :style="regionStyle()"
            />
            <div
              v-else-if="activeSelection?.type === 'point'"
              class="pointer-events-none absolute -translate-x-1/2 -translate-y-full text-violet-600"
              :class="{ 'animate-pulse': hoveredFeedbackIndex !== null }"
              :style="pointStyle(activeSelection)"
            >
              <icon-lucide-map-pin class="size-6 fill-violet-100 stroke-[2.5]" />
            </div>
            <template v-else-if="activeSelection?.type === 'sequence'">
              <div
                v-for="(point, index) in activeSelection.points"
                :key="index"
                class="pointer-events-none absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-violet-600 text-[11px] font-bold text-white shadow ring-2 ring-white"
                :class="{ 'animate-pulse': hoveredFeedbackIndex !== null }"
                :style="pointStyle(point)"
              >
                {{ index + 1 }}
              </div>
            </template>
            <div
              v-else-if="activeSelection?.type === 'arrow'"
              class="pointer-events-none absolute h-0.5 origin-left bg-violet-600 after:absolute after:top-1/2 after:right-0 after:size-2.5 after:translate-x-0.5 after:-translate-y-1/2 after:rotate-45 after:border-t-2 after:border-r-2 after:border-violet-600"
              :class="{ 'animate-pulse': hoveredFeedbackIndex !== null }"
              :style="arrowStyle()"
            />
            <svg
              v-else-if="activeSelection?.type === 'freehand'"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              class="pointer-events-none absolute inset-0 size-full overflow-visible"
              :class="{ 'animate-pulse': hoveredFeedbackIndex !== null }"
              aria-hidden="true"
            >
              <polyline
                :points="freehandPoints()"
                fill="none"
                stroke="rgb(124 58 237)"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </svg>
          </div>
        </div>
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
          class="leading-snug text-slate-900 select-text selection:bg-violet-200"
          :class="phase === 'current' ? 'cursor-text text-base' : 'line-clamp-3 text-sm'"
          @mouseup="phase === 'current' && selectText($event, 'cue', note.cue)"
        >
          <span
            v-for="(part, index) in textSelectionParts('cue', note.cue)"
            :key="index"
            :class="{
              'rounded-sm bg-violet-200': part.selected,
              'animate-pulse ring-2 ring-violet-300/70':
                part.selected && hoveredFeedbackIndex !== null
            }"
            >{{ part.text }}</span
          >
        </p>

        <div
          v-if="phase === 'current'"
          class="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-slate-800 ring-1 ring-amber-200"
        >
          <p class="mb-1 flex items-center gap-1.5 font-semibold text-amber-700">
            <icon-lucide-brain class="size-3.5" />
            From agent reasoning
          </p>
          <p
            class="cursor-text leading-relaxed text-slate-600 select-text selection:bg-violet-200"
            @mouseup="selectText($event, 'reasoning', note.reasoningEvidence)"
          >
            <span>“</span
            ><span
              v-for="(part, index) in textSelectionParts('reasoning', note.reasoningEvidence)"
              :key="index"
              :class="{
                'rounded-sm bg-violet-200': part.selected,
                'animate-pulse ring-2 ring-violet-300/70':
                  part.selected && hoveredFeedbackIndex !== null
              }"
              >{{ part.text }}</span
            ><span>”</span>
          </p>
        </div>

        <div v-if="phase === 'current' && feedbackItems.length > 0" class="mt-3 space-y-1.5 pr-10">
          <div
            v-for="(item, index) in feedbackItems"
            :key="item.id"
            class="flex items-center gap-2 rounded-lg bg-violet-50 px-2.5 py-2 text-xs ring-1 ring-violet-200 transition hover:bg-violet-100 hover:ring-violet-400"
            :title="`${feedbackSelectionLabel(item.selection)} — ${item.text}`"
            @mouseenter="hoveredFeedbackIndex = index"
            @mouseleave="hoveredFeedbackIndex = null"
          >
            <icon-lucide-message-square class="size-3.5 shrink-0 text-violet-600" />
            <p class="min-w-0 flex-1 truncate text-slate-700">{{ item.text }}</p>
            <button
              type="button"
              class="flex size-5 items-center justify-center rounded text-violet-400 hover:bg-violet-100 hover:text-violet-700"
              aria-label="Remove this feedback"
              @click="removeFeedback(index)"
            >
              <icon-lucide-x class="size-3" />
            </button>
          </div>
        </div>

        <button
          v-if="phase === 'current' && !selection"
          type="button"
          class="mt-3 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-900"
          aria-label="Write feedback about this note"
          @click="openGeneralFeedback"
        >
          <icon-lucide-message-square-plus class="size-3.5" />
          Add feedback
        </button>
      </div>

      <button
        v-if="phase === 'current' && note.status === 'pending'"
        type="button"
        class="absolute top-2 right-2 flex size-7 items-center justify-center rounded-md bg-slate-900 text-white shadow-sm transition hover:translate-x-0.5 hover:opacity-90 disabled:opacity-40"
        :class="{ 'bg-violet-600': reply.trim() || feedbackItems.length > 0 }"
        :disabled="disabled"
        :aria-label="
          reply.trim() || feedbackItems.length > 0 ? 'Send feedback and continue' : 'Continue'
        "
        :title="
          reply.trim() || feedbackItems.length > 0 ? 'Send feedback and continue' : 'Continue'
        "
        @click="continueReview"
      >
        <icon-lucide-send-horizontal
          v-if="reply.trim() || feedbackItems.length > 0"
          class="size-3.5"
        />
        <icon-lucide-arrow-right v-else class="size-3.5" />
      </button>

      <button
        v-if="phase === 'waiting'"
        type="button"
        class="flex w-full items-center justify-between border-t border-slate-100 bg-slate-50/70 px-4 py-3 text-xs font-semibold text-slate-600 transition hover:bg-violet-50 hover:text-violet-700"
        @click.stop="emit('activate', note.id)"
      >
        Review this note
        <icon-lucide-arrow-right class="size-3.5" />
      </button>
      <div
        v-else-if="phase === 'reviewed'"
        class="flex items-start gap-2 border-t border-slate-200 bg-slate-100 px-4 py-3 text-xs text-slate-500"
      >
        <icon-lucide-check class="mt-0.5 size-3.5 shrink-0 text-slate-400" />
        <span v-if="note.reply" class="line-clamp-2">{{ note.reply }}</span>
        <span v-else>Reviewed — continue with this decision.</span>
      </div>
    </div>

    <div
      v-if="phase === 'current' && visualReady"
      class="absolute top-12 left-full ml-2 flex w-8 flex-col gap-1 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-slate-200"
      aria-label="Visual feedback annotation tools"
    >
      <button
        v-for="tool in VISUAL_TOOLS"
        :key="tool"
        type="button"
        class="flex size-5 items-center justify-center rounded-md transition"
        :class="
          selectedTool === tool
            ? 'bg-violet-600 text-white shadow-sm'
            : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
        "
        :aria-label="`Use ${tool} annotation`"
        :title="
          tool === 'region'
            ? 'Select region'
            : tool === 'point'
              ? 'Place a point'
              : tool === 'arrow'
                ? 'Draw direction'
                : tool === 'sequence'
                  ? 'Mark an order'
                  : 'Draw freely'
        "
        @pointerdown.stop
        @click.stop="selectVisualTool(tool)"
      >
        <icon-lucide-scan v-if="tool === 'region'" class="size-3" />
        <icon-lucide-map-pin v-else-if="tool === 'point'" class="size-3" />
        <icon-lucide-move-up-right v-else-if="tool === 'arrow'" class="size-3" />
        <icon-lucide-list-ordered v-else-if="tool === 'sequence'" class="size-3" />
        <icon-lucide-pencil-line v-else class="size-3" />
      </button>
    </div>

    <form
      v-if="phase === 'current' && note.status === 'pending' && selection"
      class="relative mt-3 w-full min-w-0 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-slate-200"
      @submit.prevent="continueReview"
    >
      <div class="relative">
        <button
          v-if="!reply && suggestion"
          type="button"
          class="absolute top-3 right-10 left-4 z-10 line-clamp-3 text-left text-sm leading-snug text-slate-400 italic hover:text-slate-500"
          aria-label="Use suggested feedback"
          title="Click or press Tab to use this suggestion"
          @click="acceptSuggestion"
        >
          {{ suggestion }}
          <span class="ml-1 whitespace-nowrap text-[10px] font-medium text-violet-500 not-italic">
            Tab to use
          </span>
        </button>
        <div
          v-else-if="suggestionLoading && !reply"
          class="pointer-events-none absolute top-3 left-4 flex items-center gap-1.5 text-sm text-slate-400 italic"
        >
          <icon-lucide-loader-circle class="size-3.5 animate-spin" />
          Drafting a suggestion…
        </div>
        <textarea
          v-model="reply"
          data-test-id="conversation-feedback-input"
          rows="1"
          class="max-h-64 min-h-16 w-full min-w-0 resize-none rounded-lg border border-slate-200 bg-white py-2 pr-10 pl-3 text-sm text-slate-800 outline-none [field-sizing:content] placeholder:text-slate-400 focus:border-violet-400 focus:ring-1 focus:ring-violet-300"
          :placeholder="
            suggestion || suggestionLoading
              ? ''
              : selection.type === 'none'
                ? 'Share feedback about this note…'
                : 'Explain this selection…'
          "
          :disabled="disabled"
          @input="suggestion = null"
          @keydown.tab="acceptSuggestionOnTab"
          @keydown.meta.enter.prevent="continueReview"
          @keydown.ctrl.enter.prevent="continueReview"
        />
      </div>
      <div class="mt-1.5 flex items-center justify-end gap-1.5">
        <button
          type="button"
          class="flex size-8 items-center justify-center rounded-lg bg-violet-600 text-white shadow-sm hover:bg-violet-500 disabled:cursor-default disabled:opacity-40"
          :disabled="disabled || !reply.trim()"
          aria-label="Add feedback to this note"
          title="Add another feedback item"
          @click="addFeedback"
        >
          <icon-lucide-plus class="size-4" />
        </button>
      </div>
      <button
        type="button"
        class="absolute top-2 right-2 flex size-7 items-center justify-center rounded-md bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        aria-label="Close feedback input"
        @click="clearSelection"
      >
        <icon-lucide-x class="size-4" />
      </button>
    </form>
  </div>
</template>
