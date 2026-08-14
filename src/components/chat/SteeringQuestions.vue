<script setup lang="ts">
import { computed } from 'vue'

import { UNKNOWN_COLOR } from '@/app/ai/chat/mark-colors'
import { mismatch, setHoveredMark } from '@/app/ai/chat/mismatch'
import { useEditorStore } from '@/app/editor/active-store'

import type { Mark } from '@/app/meta-agent/judge'

/**
 * Questions the agent raised that no proposition covers. They have no rating,
 * so they have no ring — a strip of their own, standing ones first and the ones
 * that have gone after a divider.
 */

const store = useEditorStore()

const questions = computed(() => mismatch.marks.filter((mark) => mark.relation === 'unknown'))
const gone = computed(() => mismatch.retired.filter((mark) => mark.relation === 'unknown'))

function noteOf(mark: Mark): string {
  return mark.notes[mark.notes.length - 1]?.text ?? ''
}

/** Only the hovered one says anything. A strip of sentences is a list, and the
 * marks on the rings above are dots. */
const hoveredNote = computed(() => {
  const found = [...questions.value, ...gone.value].find((mark) => mark.id === mismatch.hovered)
  return found ? noteOf(found) : null
})
</script>

<template>
  <div
    v-if="questions.length > 0 || gone.length > 0"
    class="relative flex h-9 shrink-0 items-center border-t border-border px-2"
  >
    <!-- Hovering a dot lights the node on the canvas, the same as its badge. -->
    <div class="scrollbar-none flex shrink-0 items-center gap-1.5 overflow-x-auto">
      <button
        v-for="mark in questions"
        :key="mark.id"
        type="button"
        class="size-2.5 shrink-0 rounded-full border border-[#BBBBBB]"
        :style="{ background: UNKNOWN_COLOR }"
        :aria-label="noteOf(mark)"
        @pointerenter="setHoveredMark(store, mark.id)"
        @pointerleave="setHoveredMark(store, null)"
      />

      <!-- Wide enough to read as a break rather than as a gap between two dots. -->
      <div v-if="gone.length > 0" class="mx-2 h-4 w-px shrink-0 bg-border" />

      <button
        v-for="mark in gone"
        :key="mark.id"
        type="button"
        class="size-2.5 shrink-0 rounded-full border border-[#BBBBBB] opacity-40"
        :style="{ background: UNKNOWN_COLOR }"
        :aria-label="noteOf(mark)"
        @pointerenter="setHoveredMark(store, mark.id)"
        @pointerleave="setHoveredMark(store, null)"
      />
    </div>

    <span v-if="hoveredNote" class="ml-3 truncate text-[10px] text-muted">{{ hoveredNote }}</span>
  </div>
</template>
