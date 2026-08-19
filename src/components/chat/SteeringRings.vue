<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { computed, ref, useTemplateRef } from 'vue'

import { RING_COLORS, markColor } from '@/app/ai/chat/mark-colors'
import {
  beginSteeringFeedback,
  cancelSteeringFeedback,
  confirmSteeringFeedback,
  editSteeringFeedback,
  mismatch,
  moveSteeringFeedback,
  resumeAfterAnswers,
  setHoveredMark,
  steeringRating
} from '@/app/ai/chat/mismatch'
import { offsetFor, placeMarks } from '@/app/ai/chat/steering-layout'
import { useEditorStore } from '@/app/editor/active-store'
import type { MarkRating } from '@/app/meta-agent/judge'

/**
 * The space a mark's position means something in: the centre is what the agent
 * is reasoning right now, and the ring it sits on is how far it is from that.
 *
 * Questions live in the strip below instead — a question rests on no
 * proposition, so it is off this scale rather than at one end of it.
 */

const store = useEditorStore()

const CENTER_RADIUS = 26
const RING_GAP = 20
const OUTER_RADIUS = CENTER_RADIUS + RING_COLORS.length * RING_GAP
const EDGE_PADDING = 12

const MIN_USER_ZOOM = 0.4
const MAX_USER_ZOOM = 6
/** Below this the two lines of the centre label spill out of the centre circle. */
const LABEL_MIN_RADIUS = 30

/** In the same units as `RING_GAP`, so a marker is always well under half the
 * gap and two on neighbouring rings never touch. Clamped in px at both ends:
 * zoomed out it has to stay hittable, zoomed in it should not become a blob. */
const MARK_RADIUS = 6
const MARK_MIN_PX = 3
const MARK_MAX_PX = 10
const MARK_HOVER_SCALE = 1.4
const RETIRED_OPACITY = 0.35

const frame = useTemplateRef<HTMLElement>('frame')
const { width, height } = useElementSize(frame)

const userZoom = ref(1)
const dragging = ref<string | null>(null)

/** The outermost ring just fits the panel at userZoom 1, so a splitter drag
 * refits the drawing rather than cropping it. */
const zoom = computed(() => {
  const half = Math.min(width.value, height.value) / 2 - EDGE_PADDING
  return half <= 0 ? 0 : (half / OUTER_RADIUS) * userZoom.value
})

const cx = computed(() => width.value / 2)
const cy = computed(() => height.value / 2)
const centerRadius = computed(() => CENTER_RADIUS * zoom.value)

const markRadius = computed(() =>
  Math.min(MARK_MAX_PX, Math.max(MARK_MIN_PX, MARK_RADIUS * zoom.value))
)

/** Radii carry the zoom so stroke width, dash spacing and text stay put — a
 * scaled `<g>` would grow the dashes along with the circles. */
function ringRadius(index: number): number {
  return (CENTER_RADIUS + (index + 1) * RING_GAP) * zoom.value
}

/** Retired marks keep their place, faintly: a turn's judgments should add up to
 * something rather than blink out one by one as their changes land. */
const markers = computed(() => {
  const retired = new Set(mismatch.retired.map((mark) => mark.id))
  const rated = [...mismatch.marks, ...mismatch.retired]
    .filter((mark) => mark.relation !== 'unknown')
    .map((mark) => ({ ...mark, rating: steeringRating(mark) }))
  return placeMarks(rated).map((placed) => {
    const offset = offsetFor(placed, ringRadius(placed.ring))
    return {
      placed,
      x: cx.value + offset.x,
      y: cy.value + offset.y,
      color: markColor(placed.mark),
      opacity: retired.has(placed.mark.id) ? RETIRED_OPACITY : 1
    }
  })
})

const confirmedCount = computed(() => mismatch.answers.filter((answer) => answer.steering).length)

function ratingAt(event: PointerEvent): MarkRating {
  const bounds = frame.value?.getBoundingClientRect()
  const x = bounds ? event.clientX - bounds.left : event.offsetX
  const y = bounds ? event.clientY - bounds.top : event.offsetY
  const distance = Math.hypot(x - cx.value, y - cy.value)
  let nearest = 0
  let difference = Number.POSITIVE_INFINITY
  for (let ring = 0; ring < RING_COLORS.length; ring++) {
    const next = Math.abs(distance - ringRadius(ring))
    if (next < difference) {
      nearest = ring
      difference = next
    }
  }
  return (nearest < 5 ? 5 - nearest : 4 - nearest) as MarkRating
}

function startDrag(event: PointerEvent, id: string): void {
  const mark = mismatch.marks.find((candidate) => candidate.id === id)
  if (!mark?.feedbackContents) return
  dragging.value = id
  if (event.currentTarget instanceof Element) event.currentTarget.setPointerCapture(event.pointerId)
  beginSteeringFeedback(store, id)
}

function drag(event: PointerEvent): void {
  if (!dragging.value) return
  moveSteeringFeedback(ratingAt(event))
}

function finishDrag(): void {
  dragging.value = null
}

function cancelDrag(): void {
  dragging.value = null
  cancelSteeringFeedback(store)
}

function editDraft(event: Event): void {
  if (event.target instanceof HTMLTextAreaElement) editSteeringFeedback(event.target.value)
}

const hoveredNote = computed(() => {
  const found = markers.value.find((marker) => marker.placed.mark.id === mismatch.hovered)
  if (!found) return null
  const notes = found.placed.mark.notes
  return { text: notes[notes.length - 1]?.text ?? '', x: found.x, y: found.y }
})

function onWheel(event: WheelEvent): void {
  const next = userZoom.value * Math.exp(-event.deltaY * 0.0015)
  userZoom.value = Math.min(MAX_USER_ZOOM, Math.max(MIN_USER_ZOOM, next))
}
</script>

<template>
  <div ref="frame" class="relative min-h-0 flex-1 overflow-hidden" @wheel.prevent="onWheel">
    <svg :width="width" :height="height" class="block">
      <circle
        v-for="(color, index) in RING_COLORS"
        :key="index"
        :cx="cx"
        :cy="cy"
        :r="ringRadius(index)"
        fill="none"
        :stroke="color"
        stroke-width="1"
        stroke-dasharray="3 4"
      />
      <circle :cx="cx" :cy="cy" :r="centerRadius" fill="#59BF73" fill-opacity="0.16" />
      <text
        v-if="centerRadius >= LABEL_MIN_RADIUS"
        :x="cx"
        :y="cy"
        text-anchor="middle"
        fill="currentColor"
        class="text-[10px] font-semibold text-surface"
      >
        <tspan :x="cx" dy="-0.1em">Agent</tspan>
        <tspan :x="cx" dy="1.1em">reasoning</tspan>
      </text>

      <!-- Hovering here is the same act as hovering the badge on the canvas: the
           node it names lights up and the run holds while it is being read. -->
      <circle
        v-for="marker in markers"
        :key="marker.placed.mark.id"
        :cx="marker.x"
        :cy="marker.y"
        :r="mismatch.hovered === marker.placed.mark.id ? markRadius * MARK_HOVER_SCALE : markRadius"
        :fill="marker.color"
        :opacity="marker.opacity"
        stroke="#BBBBBB"
        class="cursor-pointer"
        @pointerdown.prevent="startDrag($event, marker.placed.mark.id)"
        @pointermove.prevent="drag"
        @pointerup.prevent="finishDrag"
        @pointercancel="cancelDrag"
        @pointerenter="setHoveredMark(store, marker.placed.mark.id)"
        @pointerleave="setHoveredMark(store, null)"
      />
    </svg>

    <div
      v-if="mismatch.steeringDraft && !dragging"
      class="absolute inset-x-2 bottom-2 rounded border border-border bg-panel p-2 shadow"
    >
      <div class="mb-1 text-[10px] font-semibold text-muted">
        <template v-if="mismatch.steeringDraft.fromRating !== null">
          {{ mismatch.steeringDraft.fromRating }} → {{ mismatch.steeringDraft.toRating }}
        </template>
        <template v-else>Suggested feedback</template>
      </div>
      <textarea
        :value="mismatch.steeringDraft.text"
        rows="3"
        class="w-full resize-none rounded border border-border bg-transparent p-1.5 text-xs text-surface outline-none focus:border-accent"
        @input="editDraft"
      />
      <div class="mt-2 flex justify-end gap-1.5">
        <button
          class="rounded px-2 py-1 text-xs text-muted hover:bg-hover"
          @click="cancelSteeringFeedback(store)"
        >
          Cancel
        </button>
        <button
          class="rounded bg-accent px-2 py-1 text-xs text-white"
          @click="confirmSteeringFeedback(store)"
        >
          Confirm
        </button>
      </div>
    </div>

    <div
      v-if="confirmedCount > 0 && !mismatch.steeringDraft"
      class="absolute inset-x-2 bottom-2 rounded border border-border bg-panel p-2 shadow"
    >
      <p class="mb-2 text-[10px] text-muted">
        Feedback saved. Add feedback to another marker, or continue when you’re ready.
      </p>
      <button
        class="w-full rounded bg-accent px-2 py-1.5 text-xs text-white"
        @click="resumeAfterAnswers"
      >
        Apply feedback and continue
      </button>
    </div>

    <div
      v-if="hoveredNote"
      class="pointer-events-none absolute max-w-[80%] rounded border border-border bg-panel px-1.5 py-1 text-[10px] text-surface shadow"
      :style="{ left: `${hoveredNote.x + 10}px`, top: `${hoveredNote.y + 10}px` }"
    >
      {{ hoveredNote.text }}
    </div>
  </div>
</template>
