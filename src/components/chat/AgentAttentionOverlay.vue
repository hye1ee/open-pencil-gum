<script setup lang="ts">
import { computed } from 'vue'

import { agentAttention, toggleAttentionNode } from '@/app/ai/chat/agent-attention'
import { getActiveEditorStore } from '@/app/editor/active-store'

const { canvasEl } = defineProps<{ canvasEl: HTMLCanvasElement | null }>()

// The glow is drawn by the renderer (drawAiOverlays) and the eye/count rides in
// the cursor's nameplate. All this component adds is the one thing the canvas
// can't do: a click target for editing the set.

// Live only while ` is actually held — not during the auto-reveal. A layer that
// swallowed clicks for two seconds every time the agent moved its attention
// would fight the user mid-edit.
const editing = computed(() => agentAttention.peeking)

const count = computed(() => agentAttention.working.length)

function onPick(e: PointerEvent) {
  e.preventDefault()
  e.stopPropagation()
  const rect = canvasEl?.getBoundingClientRect()
  if (!rect) return
  // The real store, not the reactive proxy — same reason the agent cursor uses
  // it: writes have to land on the state the renderer reads.
  const active = getActiveEditorStore()
  const world = active.screenToCanvas(e.clientX - rect.left, e.clientY - rect.top)
  const hit = active.hitTestAtPoint(world.x, world.y)
  if (hit) toggleAttentionNode(active, hit.id)
}
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-20">
    <!-- Click target while peeking: swallow the click so it toggles attention
         instead of changing the selection. -->
    <div
      v-if="editing"
      class="pointer-events-auto absolute inset-0"
      style="cursor: crosshair"
      @pointerdown="onPick"
    />

    <!-- Hint, so holding ` on an empty attention isn't a dead end -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="editing"
        class="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-panel px-3 py-1.5 text-xs font-medium whitespace-nowrap text-surface shadow-lg ring-1 ring-border"
      >
        {{
          count > 0
            ? `Agent is looking at ${count} ${count === 1 ? 'element' : 'elements'} — click to add or remove`
            : 'Click an element to point the agent at it'
        }}
      </div>
    </Transition>

    <!-- The eye + count is drawn into the cursor's own nameplate by the renderer
         (drawRemoteCursors), so there is no floating badge here. -->
  </div>
</template>
