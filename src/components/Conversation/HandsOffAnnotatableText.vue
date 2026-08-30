<script setup lang="ts">
import { ref } from 'vue'
import { useEventListener } from '@vueuse/core'

import type { HandsOffAnnotationPolarity } from '@/app/study/hands-off/annotation'

const { blocks, annotations, disabled = false } = defineProps<{
  blocks: readonly { id: string; text: string }[]
  annotations: readonly {
    id: string
    blockId: string
    selectedText: string
    startOffset: number
    endOffset: number
    polarity: HandsOffAnnotationPolarity
  }[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  annotate: [
    blockId: string,
    selectedText: string,
    startOffset: number,
    endOffset: number,
    polarity: HandsOffAnnotationPolarity
  ]
}>()

interface PendingTextSelection {
  blockId: string
  selectedText: string
  startOffset: number
  endOffset: number
  toolbarLeft: number
  toolbarTop: number
}

const containerElement = ref<HTMLElement | null>(null)
const toolbarElement = ref<HTMLElement | null>(null)
const blockElements = new Map<string, HTMLElement>()
const pendingSelection = ref<PendingTextSelection | null>(null)

function setBlockElement(blockId: string, element: unknown): void {
  if (element instanceof HTMLElement) blockElements.set(blockId, element)
  else blockElements.delete(blockId)
}

interface BlockTextSegment {
  text: string
  polarity: HandsOffAnnotationPolarity | null
}

/** The block text split at annotation boundaries, so marked spans render
 * highlighted in place. Overlapping marks are clipped to the first one. */
function blockSegments(block: { id: string; text: string }): BlockTextSegment[] {
  const marks = annotations
    .filter((annotation) => annotation.blockId === block.id)
    .toSorted((first, second) => first.startOffset - second.startOffset)
  const segments: BlockTextSegment[] = []
  let cursor = 0
  for (const mark of marks) {
    const start = Math.max(mark.startOffset, cursor)
    const end = Math.min(mark.endOffset, block.text.length)
    if (end <= start) continue
    if (start > cursor) segments.push({ text: block.text.slice(cursor, start), polarity: null })
    segments.push({ text: block.text.slice(start, end), polarity: mark.polarity })
    cursor = end
  }
  if (cursor < block.text.length) segments.push({ text: block.text.slice(cursor), polarity: null })
  return segments
}

function toolbarPosition(range: Range): { left: number; top: number } {
  const container = containerElement.value
  if (!container) return { left: 0, top: 0 }
  const containerRect = container.getBoundingClientRect()
  // The last client rect is the line the drag ended on, so the buttons appear
  // right under the pointer instead of at the bottom of the whole text.
  const rects = range.getClientRects()
  const endRect = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect()
  const rawLeft = endRect.right - containerRect.left
  const left = Math.max(0, Math.min(rawLeft, container.clientWidth - 180))
  return { left, top: endRect.bottom - containerRect.top + 6 }
}

function captureSelection(blockId: string): void {
  if (disabled) return
  const selection = window.getSelection()
  const element = blockElements.get(blockId)
  if (!selection || selection.rangeCount === 0 || !element) return
  const range = selection.getRangeAt(0)
  if (!element.contains(range.commonAncestorContainer)) return
  const selectedText = selection.toString()
  if (selectedText.trim() === '') {
    pendingSelection.value = null
    return
  }
  // Measure the offset by walking the rendered text rather than searching for
  // the selected string, so repeated phrases resolve to the right place.
  const precedingRange = document.createRange()
  precedingRange.selectNodeContents(element)
  precedingRange.setEnd(range.startContainer, range.startOffset)
  const startOffset = precedingRange.toString().length
  const { left, top } = toolbarPosition(range)
  pendingSelection.value = {
    blockId,
    selectedText,
    startOffset,
    endOffset: startOffset + selectedText.length,
    toolbarLeft: left,
    toolbarTop: top
  }
}

function markSelection(polarity: HandsOffAnnotationPolarity): void {
  const pending = pendingSelection.value
  if (!pending || disabled) return
  emit(
    'annotate',
    pending.blockId,
    pending.selectedText,
    pending.startOffset,
    pending.endOffset,
    polarity
  )
  pendingSelection.value = null
  window.getSelection()?.removeAllRanges()
}

function dismissOnOutsideMouseDown(event: MouseEvent): void {
  if (!pendingSelection.value) return
  if (event.target instanceof Node && toolbarElement.value?.contains(event.target)) return
  pendingSelection.value = null
}

useEventListener(document, 'mousedown', dismissOnOutsideMouseDown)
</script>

<template>
  <div ref="containerElement" class="relative space-y-3">
    <p
      v-for="block in blocks"
      :key="block.id"
      :ref="(element) => setBlockElement(block.id, element)"
      tabindex="0"
      class="rounded-xl bg-white/70 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-slate-700 selection:bg-amber-200"
      @mouseup="captureSelection(block.id)"
      @keyup="captureSelection(block.id)"
    ><template v-for="(segment, segmentIndex) in blockSegments(block)" :key="segmentIndex"><mark
          v-if="segment.polarity"
          :class="[
            'rounded-sm px-0.5',
            segment.polarity === 'liked'
              ? 'bg-emerald-100 text-emerald-900'
              : 'bg-rose-100 text-rose-900'
          ]"
          >{{ segment.text }}</mark
        ><template v-else>{{ segment.text }}</template></template></p>
    <div
      v-if="pendingSelection"
      ref="toolbarElement"
      data-test-id="hands-off-annotation-toolbar"
      class="absolute z-10 flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
      :style="{ left: `${pendingSelection.toolbarLeft}px`, top: `${pendingSelection.toolbarTop}px` }"
    >
      <button
        type="button"
        :disabled="disabled"
        data-test-id="hands-off-mark-liked"
        class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
        @mousedown.prevent
        @click="markSelection('liked')"
      >
        <icon-lucide-thumbs-up class="size-3.5" />
        Like
      </button>
      <button
        type="button"
        :disabled="disabled"
        data-test-id="hands-off-mark-disliked"
        class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
        @mousedown.prevent
        @click="markSelection('disliked')"
      >
        <icon-lucide-thumbs-down class="size-3.5" />
        Dislike
      </button>
    </div>
    <ul v-if="annotations.length > 0" class="flex flex-wrap gap-1.5" aria-label="Marked selections">
      <li
        v-for="annotation in annotations"
        :key="annotation.id"
        :class="[
          'inline-flex max-w-64 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
          annotation.polarity === 'liked'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-rose-200 bg-rose-50 text-rose-800'
        ]"
      >
        <icon-lucide-thumbs-up v-if="annotation.polarity === 'liked'" class="size-3 shrink-0" />
        <icon-lucide-thumbs-down v-else class="size-3 shrink-0" />
        <span class="truncate">{{ annotation.selectedText.trim() }}</span>
      </li>
    </ul>
  </div>
</template>
