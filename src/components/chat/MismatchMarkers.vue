<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'

import {
  answerMark,
  cancelMarkFeedback,
  mismatch,
  openMarkFeedback,
  setHoveredMark
} from '@/app/ai/chat/mismatch'
import { useEditorStore } from '@/app/editor/active-store'
import { isWarning } from '@/app/meta-agent/judge'
import type { Mark } from '@/app/meta-agent/judge'

// The glow says a node is in question; this says what the question is. Both are
// needed — the glow is visible from across the canvas and survives zoom, the
// badge carries the sentence and only pays off once you look at it.
//
// DOM rather than another renderer pass: this is text that has to wrap and take
// a pointer. The glow is the part that belongs on the canvas.
//
// A mark with no node is about the design as a whole. There is nothing to glow,
// so it rides beside the agent cursor — where the user is already looking.
//
// No number on the badge. How often the agent came back to something is already
// folded into how much the meta-agent says it matters, and two numbers to weigh
// against each other is one more than anybody reads at a glance. Colour carries
// it instead: yellow through to red as it climbs.

const { canvasEl } = defineProps<{ canvasEl: HTMLCanvasElement | null }>()

const store = useEditorStore()

const BADGE_OFFSET = 6
const CARD_MAX_PX = 260

/**
 * Where the loose marks sit relative to the agent cursor.
 *
 * Left and bottom match the nameplate the renderer draws beside the arrow
 * (`drawRemoteCursors` in `pen-overlay.ts`: offset 12 less 4 of padding, and a
 * 14px box starting 10 below the point). They are duplicated rather than shared
 * because the nameplate is drawn on the canvas and this is DOM — there is no
 * layout between them, only a number that has to agree.
 *
 * A row, not a column. Stacking downward walks the badges across whatever is
 * under the cursor and puts each one's hover card over the badge below it,
 * where a row stays a single strip attached to the name.
 */
const CURSOR_STRIP_LEFT = 8
const CURSOR_STRIP_TOP = 24 + 10
const CURSOR_STRIP_GAP = 20

/** Yellow at 1, red at 10. Sitting on a light canvas, so the lightness comes
 * down as it reddens rather than the badge just changing hue. */
function badgeColor(mark: Mark): string {
  if (!isWarning(mark)) return 'hsl(220 9% 60%)'
  const t = Math.min(1, Math.max(0, (mark.importance - 1) / 9))
  return `hsl(${48 - 48 * t} ${85 + 6 * t}% ${56 - 12 * t}%)`
}

const draft = ref('')

// An array because the box sits inside the `v-for` over markers, so Vue
// collects one entry per rendered instance. Only one box is ever open, which
// is what makes taking the first entry unambiguous.
const boxes = useTemplateRef<HTMLInputElement[]>('box')

/** Three states, and the person has to be able to tell them apart at a glance:
 * untouched, box open, already answered. */
function markerClass(id: string): string {
  if (mismatch.composing === id) return 'scale-150 ring-2 ring-surface'
  if (mismatch.answers.some((answer) => answer.id === id)) {
    return 'scale-125 opacity-60 ring-2 ring-accent'
  }
  return 'ring-1 ring-white/40 hover:scale-125'
}

function answerFor(id: string): string {
  return mismatch.answers.find((answer) => answer.id === id)?.text ?? ''
}

function send(id: string): void {
  answerMark(store, id, draft.value)
  draft.value = ''
}

// The box opens from a click on the badge, so the caret is nowhere near it.
// Queried rather than held as a template ref because the box lives inside the
// `v-for` over markers, where a ref collects one entry per marker — and there
// is only ever one box open, which is what makes the query unambiguous.
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

  // Counted over the loose marks only. Using the position in the whole list
  // would leave a gap in the strip wherever an anchored mark sits between two
  // loose ones.
  let slot = 0

  return mismatch.marks.flatMap((mark) => {
    const place = (x: number, y: number) => [
      { mark, x, y, flip: x > width - CARD_MAX_PX, color: badgeColor(mark) }
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
    // Top-right corner, nudged out so the badge sits beside the glow rather
    // than on top of the artwork.
    return place(
      (abs.x + node.width) * zoom + panX + BADGE_OFFSET,
      abs.y * zoom + panY - BADGE_OFFSET
    )
  })
})
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-30">
    <div
      v-for="marker in markers"
      :key="marker.mark.id"
      class="absolute"
      :style="{ left: `${marker.x}px`, top: `${marker.y}px` }"
    >
      <!-- Clicking is the whole disagreement path: a mark left alone is taken
           as agreed with, so this is how the person says otherwise. -->
      <button
        type="button"
        class="pointer-events-auto size-4 -translate-y-1/2 rounded-full shadow transition-transform"
        :class="markerClass(marker.mark.id)"
        :style="{ background: marker.color }"
        :aria-label="marker.mark.notes[marker.mark.notes.length - 1]?.text ?? ''"
        @pointerenter="setHoveredMark(store, marker.mark.id)"
        @pointerleave="setHoveredMark(store, null)"
        @click="openMarkFeedback(store, marker.mark.id)"
      />

      <Transition
        enter-active-class="transition duration-100 ease-out"
        enter-from-class="translate-y-1 opacity-0"
        leave-active-class="transition duration-100 ease-in"
        leave-to-class="translate-y-1 opacity-0"
      >
        <!-- Pinned open while this mark's box is up, so the note stays readable
             above the answer being written about it. -->
        <div
          v-if="mismatch.hovered === marker.mark.id || mismatch.composing === marker.mark.id"
          class="absolute top-3 w-max rounded-lg bg-panel px-2.5 py-1.5 text-[11px] leading-snug text-surface shadow-lg ring-1 ring-border"
          :class="[
            marker.flip ? 'right-3' : 'left-3',
            mismatch.composing === marker.mark.id ? 'pointer-events-auto' : 'pointer-events-none'
          ]"
          :style="{ maxWidth: `${CARD_MAX_PX}px` }"
        >
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

          <!-- What they already said about this one, if they are back for a
               second pass. Answering again replaces it. -->
          <p v-if="answerFor(marker.mark.id)" class="mt-1.5 text-accent">
            {{ answerFor(marker.mark.id) }}
          </p>

          <form
            v-if="mismatch.composing === marker.mark.id"
            class="mt-1.5 flex gap-1"
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
