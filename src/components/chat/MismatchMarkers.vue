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

/**
 * The sign picks the direction, the magnitude picks how far along it sits.
 *
 * Conflict runs yellow at −1 to red at −5, alignment pale at +1 to deep at +5.
 * Both darken as they strengthen rather than only changing hue, because the
 * badge sits on a light canvas and hue alone is not a difference you can read at
 * this size. Unknown is grey: it points nowhere on the scale.
 */
function badgeColor(mark: Mark): string {
  if (mark.relation === 'unknown') return 'hsl(220 9% 60%)'
  const t = Math.min(1, Math.max(0, (Math.abs(mark.alignment) - 1) / 4))
  return isWarning(mark)
    ? `hsl(${48 - 48 * t} ${85 + 6 * t}% ${56 - 12 * t}%)`
    : `hsl(${158 - 8 * t} ${52 + 20 * t}% ${58 - 16 * t}%)`
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
      <!-- Clicking is the whole disagreement path: a mark left alone is taken
           as agreed with, so this is how the person says otherwise. -->
      <button
        type="button"
        class="pointer-events-auto size-4 -translate-y-1/2 rounded-full shadow transition-transform"
        :class="markerClass(marker.mark.id)"
        :style="{ background: marker.color }"
        :aria-label="marker.mark.notes[marker.mark.notes.length - 1]?.text ?? ''"
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
        <!-- The card opens the answer box too, not only the badge. The badge is
             16px and unlabelled, and once the dismiss button went on the card it
             became the only control anyone could see — a whole run went by with
             three marks waved away and the answer box never once opened. -->
        <div
          v-if="mismatch.hovered === marker.mark.id || mismatch.composing === marker.mark.id"
          class="pointer-events-auto absolute top-3 w-max cursor-pointer rounded-lg bg-panel py-1.5 pl-2.5 text-[11px] leading-snug text-surface shadow-lg ring-1 ring-border"
          :class="[
            marker.flip ? 'right-3' : 'left-3',
            // Room for the dismiss button, on the only marks that have one.
            marker.mark.relation === 'unknown' ? 'pr-6' : 'pr-2.5'
          ]"
          :style="{ maxWidth: `${CARD_MAX_PX}px` }"
          @click="openMarkFeedback(store, marker.mark.id)"
        >
          <!-- Questions only, and `dismissMark` enforces the same rule. Waving a
               question away is agreeing with it, the same as letting it stand.
               A warning has no such control on purpose: it is the one chance to
               stop a change before it lands, and a button that clears it in a
               click is a button for clearing warnings without reading them.
               It is here rather than on the badge because the badge already has
               the other answer on it, and one control cannot mean both. -->
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

          <!-- What they already said about this one, if they are back for a
               second pass. Answering again replaces it. -->
          <p v-if="answerFor(marker.mark.id)" class="mt-1.5 text-accent">
            {{ answerFor(marker.mark.id) }}
          </p>

          <!-- Says the disagreement path exists. Leaving a mark alone is taken
               as agreeing with it, which is only a fair default if the other
               option was visible. -->
          <p v-if="mismatch.composing !== marker.mark.id" class="mt-1.5 text-muted">
            click to reply
          </p>

          <!-- Stops the box, its send button and its cancel button from
               bubbling a click back to the card, which would reopen the box in
               the same gesture that closed it. -->
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
