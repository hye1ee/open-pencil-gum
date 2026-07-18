<script setup lang="ts">
import { refAutoReset, useEventListener } from '@vueuse/core'
import { computed, onUnmounted, ref, watch } from 'vue'

import { dragAgentCursor } from '@/app/ai/chat/agent-cursor'
import { agentTurn, pauseTurn, promptResume, resumeTurn } from '@/app/ai/chat/agent-turn'
import { getActiveEditorStore, useEditorStore } from '@/app/editor/active-store'

const { canvasEl } = defineProps<{ canvasEl: HTMLCanvasElement | null }>()

const store = useEditorStore()

const IDLE_MS = 3000
const POKE_MS = 3200

// Playful lines the agent "says" when the user pokes it while it's idle.
const POKE_LINES = ['뭐 도와줄까요?', '다음은 뭘 만들어 볼까요?', '시킬 일 있어요?', '준비됐어요!']
let pokeIdx = 0
const pokeMessage = refAutoReset('', POKE_MS)

// Screen (CSS px) position of the agent cursor within the canvas area.
const screen = computed(() => {
  const c = store.state.agentCursor
  if (!c) return null
  return { x: c.x * store.state.zoom + store.state.panX, y: c.y * store.state.zoom + store.state.panY }
})

const dragging = ref(false)

function toWorld(e: PointerEvent) {
  const rect = canvasEl?.getBoundingClientRect()
  if (!rect) return null
  return store.screenToCanvas(e.clientX - rect.left, e.clientY - rect.top)
}

function onGrab(e: PointerEvent) {
  e.preventDefault()
  e.stopPropagation()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragging.value = true
  pokeMessage.value = ''
  // While working, grabbing pauses the turn. While idle it's just a poke —
  // the cursor wobbles and springs back (see the frame loop) and reacts below.
  if (agentTurn.running) pauseTurn()
}

function onMove(e: PointerEvent) {
  if (!dragging.value) return
  const w = toWorld(e)
  // Use the real active store (not the reactive proxy) so the parked position
  // lands on the same state the cursor's animation loop reads.
  if (w) dragAgentCursor(getActiveEditorStore(), w.x, w.y)
}

function onRelease(e: PointerEvent) {
  if (!dragging.value) return
  ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  dragging.value = false
  if (agentTurn.paused) {
    // Let go after re-parking the paused cursor → restart the idle countdown.
    armIdle()
  } else if (!agentTurn.running) {
    // Idle poke → the agent reacts, nudging the user to give it something to do.
    pokeMessage.value = POKE_LINES[pokeIdx % POKE_LINES.length]
    pokeIdx++
  }
}

// While paused, offer to resume once the user has been idle for a moment.
let idleTimer = 0
function armIdle() {
  clearTimeout(idleTimer)
  idleTimer = window.setTimeout(promptResume, IDLE_MS)
}

// Reset the countdown on activity only until the prompt is up — once it's shown
// we detach, so moving the mouse toward the button doesn't dismiss it.
const activityTarget = computed(() =>
  agentTurn.paused && !agentTurn.askResume ? window : undefined
)
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const) {
  useEventListener(activityTarget, ev, armIdle, { passive: true })
}

watch(
  () => agentTurn.paused,
  (paused) => {
    clearTimeout(idleTimer)
    if (paused) armIdle()
    else agentTurn.askResume = false
  }
)

onUnmounted(() => clearTimeout(idleTimer))
</script>

<template>
  <div v-if="screen" class="pointer-events-none absolute inset-0 z-30">
    <!-- Grab target over the cursor arrow -->
    <div
      class="pointer-events-auto absolute size-8 -translate-x-1/4 -translate-y-1/4"
      :style="{ left: `${screen.x}px`, top: `${screen.y}px`, cursor: dragging ? 'grabbing' : 'grab' }"
      @pointerdown="onGrab"
      @pointermove="onMove"
      @pointerup="onRelease"
    />

    <!-- Playful reaction when the user pokes the idle cursor -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="translate-y-1 scale-95 opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="translate-y-1 scale-95 opacity-0"
    >
      <div
        v-if="pokeMessage && !agentTurn.running"
        class="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-2xl rounded-bl-sm bg-panel px-3 py-1.5 text-xs font-medium whitespace-nowrap text-surface shadow-lg ring-1 ring-border"
        :style="{ left: `${screen.x + 10}px`, top: `${screen.y - 4}px` }"
      >
        {{ pokeMessage }}
      </div>
    </Transition>

    <!-- Resume prompt after the user goes idle while paused -->
    <button
      v-if="agentTurn.askResume"
      class="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-medium whitespace-nowrap text-white shadow-lg"
      :style="{ left: `${screen.x + 8}px`, top: `${screen.y - 6}px` }"
      @click="resumeTurn"
    >
      <icon-lucide-play class="size-3" />
      Resume agent?
    </button>
  </div>
</template>
