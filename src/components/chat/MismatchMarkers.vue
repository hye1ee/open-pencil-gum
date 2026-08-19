<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'

import {
  answerMark,
  cancelMarkFeedback,
  dismissMark,
  mismatch,
  openMarkFeedback,
  setHoveredMark
} from '@/app/ai/chat/mismatch'
import { markColor } from '@/app/ai/chat/mark-colors'
import { useEditorStore } from '@/app/editor/active-store'
import type { Mark } from '@/app/meta-agent/judge'

// DOM badges carry interactive text; CanvasKit draws the matching glow.

const { canvasEl } = defineProps<{ canvasEl: HTMLCanvasElement | null }>()

const store = useEditorStore()

const BADGE_OFFSET = 6
const CARD_MAX_PX = 260

// Matches the CanvasKit cursor nameplate offsets in pen-overlay.ts.
const CURSOR_STRIP_LEFT = 8
const CURSOR_STRIP_TOP = 24 + 10
const CURSOR_STRIP_GAP = 20
const NODE_MARKER_GAP = 20

const draft = ref('')

const boxes = useTemplateRef<HTMLInputElement[]>('box')

function markerClass(id: string): string {
  if (mismatch.composing === id) return 'scale-150 ring-2 ring-surface'
  if (mismatch.answers.some((answer) => answer.id === id)) {
    return 'scale-125 opacity-60 ring-2 ring-accent'
  }
  return 'hover:scale-125'
}

function answerFor(id: string): string {
  return mismatch.answers.find((answer) => answer.id === id)?.text ?? ''
}

function send(id: string): void {
  answerMark(store, id, draft.value)
  draft.value = ''
}

function openCanvasFeedback(mark: Mark): void {
  if (mark.relation === 'unknown') openMarkFeedback(store, mark.id)
}

watch(
  () => mismatch.composing,
  (id) => {
    draft.value = id === null ? '' : answerFor(id)
    if (id === null) return
    void nextTick(() => {
      boxes.value?.[0]?.focus()
    })
  }
)

const markers = computed(() => {
  // The graph is not reactive, so name the versions that move it: pan and zoom
  // move the badge, a scene change moves the node under it.
  const { zoom, panX, panY } = store.state
  void store.state.sceneVersion
  const cursor = store.state.agentCursor
  const width = canvasEl?.clientWidth ?? Infinity

  let slot = 0
  const nodeSlots = new Map<string, number>()

  return mismatch.marks.flatMap((mark) => {
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
      <!-- Rated marks are answered in Steering Space; unknowns keep their
           canvas reply because they have no ring to move to. -->
      <button
        type="button"
        class="pointer-events-auto size-4 -translate-y-1/2 rounded-full border border-[#BBBBBB] shadow transition-transform"
        :class="markerClass(marker.mark.id)"
        :style="{ background: marker.color }"
        :aria-label="marker.mark.notes[marker.mark.notes.length - 1]?.text ?? ''"
        @click="openCanvasFeedback(marker.mark)"
      />

      <Transition
        enter-active-class="transition duration-100 ease-out"
        enter-from-class="translate-y-1 opacity-0"
        leave-active-class="transition duration-100 ease-in"
        leave-to-class="translate-y-1 opacity-0"
      >
        <div
          v-if="mismatch.hovered === marker.mark.id || mismatch.composing === marker.mark.id"
          class="pointer-events-auto absolute top-3 w-max cursor-pointer rounded-lg bg-panel py-1.5 pl-2.5 text-[11px] leading-snug text-surface shadow-lg ring-1 ring-border"
          :class="[
            marker.flip ? 'right-3' : 'left-3',
            // Room for the dismiss button, on the only marks that have one.
            marker.mark.relation === 'unknown' ? 'pr-6' : 'pr-2.5'
          ]"
          :style="{ maxWidth: `${CARD_MAX_PX}px` }"
          @click="openCanvasFeedback(marker.mark)"
        >
          <!-- Only unknown marks can be dismissed. -->
          <button
            v-if="marker.mark.relation === 'unknown'"
            type="button"
            class="absolute top-1 right-1 rounded p-0.5 text-muted hover:text-surface"
            aria-label="Dismiss this marker"
            data-test-id="mark-dismiss"
            @click.stop="dismissMark(store, marker.mark.id)"
          >
            <icon-lucide-x class="size-2.5" />
          </button>

          <!-- Oldest first, faded: an updated mark should read as having moved
               rather than as having always said the newest thing. -->
          <p
            v-for="(note, i) in marker.mark.notes"
            :key="i"
            :class="[
              i > 0 ? 'mt-1' : '',
              i < marker.mark.notes.length - 1 ? 'text-surface/45 line-through' : ''
            ]"
          >
            {{ note.text }}
          </p>

          <p v-if="answerFor(marker.mark.id)" class="mt-1.5 text-accent">
            {{ answerFor(marker.mark.id) }}
          </p>

          <p
            v-if="marker.mark.relation === 'unknown' && mismatch.composing !== marker.mark.id"
            class="mt-1.5 text-muted"
          >
            click to reply
          </p>

          <form
            v-if="mismatch.composing === marker.mark.id"
            class="mt-1.5 flex gap-1"
            @click.stop
            @submit.prevent="send(marker.mark.id)"
          >
            <input
              ref="box"
              v-model="draft"
              class="min-w-0 flex-1 rounded border border-border bg-canvas px-1.5 py-1 text-[11px] text-surface outline-none placeholder:text-muted focus:border-accent"
              placeholder="What should it do instead?"
              data-test-id="mark-answer-input"
              @keydown.esc.stop="cancelMarkFeedback(store)"
              @pointerdown.stop
            />
            <button
              type="submit"
              class="shrink-0 rounded px-1.5 text-muted hover:text-surface disabled:opacity-40"
              :disabled="!draft.trim()"
              aria-label="Send this answer"
            >
              <icon-lucide-send class="size-3" />
            </button>
            <button
              type="button"
              class="shrink-0 rounded px-1 text-muted hover:text-surface"
              aria-label="Stop answering this marker"
              @click="cancelMarkFeedback(store)"
            >
              <icon-lucide-x class="size-3" />
            </button>
          </form>
        </div>
      </Transition>
    </div>
  </div>
</template>
