<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { computed, ref, useTemplateRef } from 'vue'

import { RING_COLORS } from '@/app/ai/chat/mark-colors'

/**
 * The space a mark's position means something in: the centre is what the agent
 * is reasoning right now, and distance from it is how far a mark sits from that.
 *
 * Only the coordinate system is drawn here. Marks land in it later.
 */

const CENTER_RADIUS = 26
const RING_GAP = 20
const OUTER_RADIUS = CENTER_RADIUS + RING_COLORS.length * RING_GAP
const EDGE_PADDING = 12

const MIN_USER_ZOOM = 0.4
const MAX_USER_ZOOM = 6
/** Below this the two lines of the centre label spill out of the centre circle. */
const LABEL_MIN_RADIUS = 30

const frame = useTemplateRef<HTMLElement>('frame')
const { width, height } = useElementSize(frame)

const userZoom = ref(1)

/** The outermost ring just fits the panel at userZoom 1, so a splitter drag
 * refits the drawing rather than cropping it. */
const zoom = computed(() => {
  const half = Math.min(width.value, height.value) / 2 - EDGE_PADDING
  return half <= 0 ? 0 : (half / OUTER_RADIUS) * userZoom.value
})

const cx = computed(() => width.value / 2)
const cy = computed(() => height.value / 2)
const centerRadius = computed(() => CENTER_RADIUS * zoom.value)

/** Radii carry the zoom so stroke width, dash spacing and text stay put — a
 * scaled `<g>` would grow the dashes along with the circles. */
function ringRadius(index: number): number {
  return (CENTER_RADIUS + (index + 1) * RING_GAP) * zoom.value
}

function onWheel(event: WheelEvent): void {
  const next = userZoom.value * Math.exp(-event.deltaY * 0.0015)
  userZoom.value = Math.min(MAX_USER_ZOOM, Math.max(MIN_USER_ZOOM, next))
}
</script>

<template>
  <section
    data-test-id="reasoning-interaction-panel"
    class="flex min-h-0 flex-1 flex-col border-t border-border bg-panel"
  >
    <header class="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3">
      <icon-lucide-message-circle class="size-3 text-muted" />
      <span class="text-xs font-semibold">Steering Space</span>
    </header>

    <div ref="frame" class="min-h-0 flex-1 overflow-hidden" @wheel.prevent="onWheel">
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
      </svg>
    </div>
  </section>
</template>
