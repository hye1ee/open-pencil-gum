<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  acceptAndHideMark,
  beginSteeringFeedback,
  beginUnknownFeedback,
  cancelSteeringFeedback,
  confirmSteeringFeedback,
  editSteeringFeedback,
  mismatch,
  moveSteeringFeedback,
  setHoveredMark
} from '@/app/ai/chat/mismatch'
import { STEERABLE_GLYPH, markColor, stepColor } from '@/app/ai/chat/mark-colors'
import { useEditorStore } from '@/app/editor/active-store'
import { SPECTRUM, isUnrelated } from '@/app/meta-agent/judge'
import type { Mark, SpectrumStep } from '@/app/meta-agent/judge'

// DOM badges carry interactive text; CanvasKit draws the matching glow.

const { canvasEl } = defineProps<{ canvasEl: HTMLCanvasElement | null }>()

const store = useEditorStore()
const scaleDragging = ref(false)
/** Top-down, so our end is above the agent's — the same order the timeline uses. */
const SCALE_STEPS: SpectrumStep[] = [...SPECTRUM].reverse()

const BADGE_OFFSET = 6
const CARD_MAX_PX = 260

// Matches the CanvasKit cursor nameplate offsets in pen-overlay.ts.
const CURSOR_STRIP_LEFT = 8
const CURSOR_STRIP_TOP = 24 + 10
const CURSOR_STRIP_GAP = 42
const NODE_MARKER_GAP = 42

function markerClass(id: string): string {
  if (mismatch.answers.some((answer) => answer.id === id)) {
    return 'scale-105 opacity-60 ring-2 ring-accent/60'
  }
  return 'hover:scale-105 hover:ring-2 hover:ring-current/20'
}

function answerFor(id: string): string {
  return mismatch.answers.find((answer) => answer.id === id)?.text ?? ''
}

function openCanvasFeedback(mark: Mark): void {
  if (isUnrelated(mark)) beginUnknownFeedback(store, mark.id, 'canvas')
  else beginSteeringFeedback(store, mark.id, 'canvas')
}

function editDraft(event: Event): void {
  if (event.target instanceof HTMLTextAreaElement) editSteeringFeedback(event.target.value)
}

function stepTop(step: SpectrumStep | null): number {
  const index = SCALE_STEPS.indexOf(step ?? 'halfway')
  return ((Math.max(0, index) + 0.5) / SCALE_STEPS.length) * 100
}

function updatePosition(event: PointerEvent): void {
  if (!scaleDragging.value) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  const bounds = target.getBoundingClientRect()
  const index = Math.min(
    SCALE_STEPS.length - 1,
    Math.max(0, Math.floor(((event.clientY - bounds.top) / bounds.height) * SCALE_STEPS.length))
  )
  const step = SCALE_STEPS[index]
  if (step !== undefined) moveSteeringFeedback(step)
}

function startScaleDrag(event: PointerEvent): void {
  scaleDragging.value = true
  if (event.currentTarget instanceof Element) event.currentTarget.setPointerCapture(event.pointerId)
  updatePosition(event)
}

function stopScaleDrag(): void {
  scaleDragging.value = false
}

const markers = computed(() => {
  // The graph is not reactive, so name the versions that move it: pan and zoom
  // move the badge, a scene change moves the node under it.
  const { zoom, panX, panY } = store.state
  void store.state.sceneVersion
  const cursor = store.state.agentCursor
  const width = canvasEl?.clientWidth ?? Infinity

  let slot = 0
  const nodeSlots = new Map<string, number>()

  return mismatch.marks
    .filter(
      (mark) =>
        !mismatch.hidden.includes(mark.id) &&
        Math.max(1, mark.changedInStep ?? mark.raisedInStep) === mismatch.activeSteeringStep
    )
    .flatMap((mark) => {
      const place = (x: number, y: number) => [
        { mark, x, y, flip: x > width - CARD_MAX_PX, color: markColor(mark) }
      ]

      if (mark.nodeId === null) {
        if (!cursor) return []
        const offset = slot++ * CURSOR_STRIP_GAP
        return place(
          cursor.x * zoom + panX + CURSOR_STRIP_LEFT + offset,
          cursor.y * zoom + panY + CURSOR_STRIP_TOP
        )
      }

      const node = store.graph.getNode(mark.nodeId)
      if (!node) return []
      const abs = store.graph.getAbsolutePosition(mark.nodeId)
      const nodeSlot = nodeSlots.get(mark.nodeId) ?? 0
      nodeSlots.set(mark.nodeId, nodeSlot + 1)
      return place(
        (abs.x + node.width) * zoom + panX + BADGE_OFFSET + nodeSlot * NODE_MARKER_GAP,
        abs.y * zoom + panY - BADGE_OFFSET
      )
    })
})
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-30">
    <!-- Hover is tracked on the wrapper rather than the badge, so moving onto
         the card to reach its dismiss button is still hovering this mark. On the
         badge alone that move reads as leaving, and the card starts closing
         under the pointer on its way there. -->
    <div
      v-for="marker in markers"
      :key="marker.mark.id"
      class="absolute"
      :style="{ left: `${marker.x}px`, top: `${marker.y}px` }"
      @pointerenter="setHoveredMark(store, marker.mark.id)"
      @pointerleave="setHoveredMark(store, null)"
    >
      <button
        type="button"
        class="pointer-events-auto inline-flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 bg-panel shadow transition-transform"
        :class="markerClass(marker.mark.id)"
        :style="{ borderColor: marker.color, color: marker.color }"
        :aria-label="marker.mark.notes[marker.mark.notes.length - 1]?.text ?? ''"
        @click="openCanvasFeedback(marker.mark)"
      >
        <!-- The steering space marker, at canvas size: same ring, same glyph, so
             one mark is one shape wherever it is seen. -->
        <svg viewBox="-10 -10 20 20" class="size-full">
          <path
            v-if="!isUnrelated(marker.mark)"
            :d="STEERABLE_GLYPH"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <text v-else y="4" text-anchor="middle" fill="currentColor" class="text-[11px] font-bold">
            ?
          </text>
        </svg>
      </button>

      <div
        v-if="
          mismatch.steeringDraft?.id === marker.mark.id &&
          mismatch.steeringDraft.source === 'canvas'
        "
        class="pointer-events-auto absolute top-3 z-20 w-[300px] rounded-xl border border-border bg-panel p-3 text-surface shadow-xl"
        :class="marker.flip ? 'right-3' : 'left-3'"
        @click.stop
      >
        <p class="mb-2 text-[11px] font-semibold">Adjust this decision</p>
        <div class="flex gap-3">
          <div
            v-if="!isUnrelated(marker.mark)"
            class="relative h-44 w-16 shrink-0 touch-none rounded-lg bg-hover select-none"
            @pointerdown="startScaleDrag"
            @pointermove="updatePosition"
            @pointerup="stopScaleDrag"
            @pointercancel="stopScaleDrag"
          >
            <span class="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-[#a9a49c]" />
            <span
              v-for="(step, index) in SCALE_STEPS"
              :key="step"
              class="absolute left-1/2 h-px w-3 -translate-x-1/2 -translate-y-1/2 bg-[#c8c3bb]"
              :style="{ top: `${((index + 0.5) / SCALE_STEPS.length) * 100}%` }"
            />
            <span
              class="absolute left-1/2 h-4 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              :style="{
                top: `${stepTop(mismatch.steeringDraft.toPosition)}%`,
                background: stepColor(mismatch.steeringDraft.toPosition)
              }"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div
              v-if="mismatch.steeringDraft.toPosition !== null"
              class="mb-1.5 text-[9px] text-muted"
            >
              {{ mismatch.steeringDraft.toPosition.replaceAll('_', ' ') }}
            </div>
            <textarea
              :value="mismatch.steeringDraft.text"
              rows="5"
              class="w-full resize-none rounded-lg border border-border bg-white p-2 text-[10px] leading-relaxed text-surface outline-none focus:border-[#8f857b]"
              @input="editDraft"
            />
            <div class="mt-2 flex justify-end gap-1.5">
              <button
                class="rounded px-2 py-1 text-[10px] text-muted hover:bg-hover"
                @click="cancelSteeringFeedback(store)"
              >
                Cancel
              </button>
              <button
                class="rounded bg-surface px-2.5 py-1 text-[10px] text-white"
                @click="confirmSteeringFeedback(store)"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      </div>

      <Transition
        enter-active-class="transition duration-100 ease-out"
        enter-from-class="translate-y-1 opacity-0"
        leave-active-class="transition duration-100 ease-in"
        leave-to-class="translate-y-1 opacity-0"
      >
        <div
          v-if="
            // Any open draft closes it, wherever it was opened: the card and the
            // editor say different things about the same mark.
            mismatch.hovered === marker.mark.id && !mismatch.steeringDraft
          "
          class="pointer-events-auto absolute top-3 w-max cursor-pointer rounded-lg bg-panel py-1.5 pl-2.5 text-[11px] leading-snug text-surface shadow-lg ring-1 ring-border"
          :class="[
            marker.flip ? 'right-3' : 'left-3',
            // Room for the dismiss button, on the only marks that have one.
            isUnrelated(marker.mark) ? 'pr-6' : 'pr-2.5'
          ]"
          :style="{ maxWidth: `${CARD_MAX_PX}px` }"
          @click="openCanvasFeedback(marker.mark)"
        >
          <!-- Only marks no proposition covers can be dismissed. -->
          <button
            v-if="isUnrelated(marker.mark)"
            type="button"
            class="absolute top-1 right-1 rounded p-0.5 text-muted hover:text-surface"
            data-test-id="mark-dismiss"
            aria-label="Accept and hide"
            title="Accept and hide"
            @click.stop="acceptAndHideMark(store, marker.mark.id)"
          >
            <icon-lucide-eye-off class="size-2.5" />
          </button>

          <p>{{ marker.mark.notes.at(-1)?.text ?? '' }}</p>

          <p v-if="answerFor(marker.mark.id)" class="mt-1.5 text-accent">
            {{ answerFor(marker.mark.id) }}
          </p>

          <p class="mt-1.5 text-muted">click to review feedback</p>
        </div>
      </Transition>
    </div>
  </div>
</template>
