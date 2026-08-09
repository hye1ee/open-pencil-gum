<script setup lang="ts">
import { computed } from 'vue'

import { agentSpeech } from '@/app/ai/chat/agent-speech'
import { agentTurn } from '@/app/ai/chat/agent-turn'
import { mismatch, resumeAfterAnswers } from '@/app/ai/chat/mismatch'
import { useEditorStore } from '@/app/editor/active-store'

// What the agent is saying, in a bubble beside its cursor — and, once the
// person has answered a marker and gone quiet, whether to carry on.
//
// The cursor used to be draggable: grabbing it paused the turn, parking it moved
// where it hovered, and poking it while idle got a line back. That is gone —
// pausing is what pointing at a mismatch marker does now, and it does it at
// every point in the run rather than only at a step boundary, so the grab was a
// second way to do one thing.
//
// The resume question lives here rather than beside the marker that was
// answered, because by then there may be two or three answered markers and the
// question is about all of them. The cursor is the one place that stands for
// the run as a whole.

const { canvasEl } = defineProps<{ canvasEl: HTMLCanvasElement | null }>()

const store = useEditorStore()

const BUBBLE_MAX_PX = 260

// Screen (CSS px) position of the agent cursor within the canvas area.
const screen = computed(() => {
  const c = store.state.agentCursor
  if (!c) return null
  return {
    x: c.x * store.state.zoom + store.state.panX,
    y: c.y * store.state.zoom + store.state.panY
  }
})

// `thinking` is styled down — it's the agent talking to itself, not to the user.
const bubble = computed(() => {
  const text = agentTurn.running || agentTurn.paused ? agentSpeech.text : ''
  if (!text) return null
  return { text, thinking: agentSpeech.thinking && !!agentTurn.running }
})

// Anchored to the right of the cursor and clamped so a long line doesn't run off
// the canvas — the cursor itself can sit near the edge.
const bubblePos = computed(() => {
  if (!screen.value) return null
  const width = canvasEl?.clientWidth ?? Infinity
  return {
    left: Math.max(8, Math.min(screen.value.x + 14, width - BUBBLE_MAX_PX - 8)),
    top: screen.value.y - 6
  }
})
</script>

<template>
  <div v-if="screen" class="pointer-events-none absolute inset-0 z-30">
    <!-- Below the cursor, clear of the speech bubble above it. -->
    <div
      v-if="mismatch.askingToResume"
      class="pointer-events-auto absolute flex items-center gap-2 rounded-xl bg-panel px-3 py-2 text-xs shadow-lg ring-1 ring-border"
      :style="{ left: `${screen.x + 14}px`, top: `${screen.y + 30}px` }"
      data-test-id="agent-resume-prompt"
    >
      <span class="text-surface"> {{ mismatch.answers.length }} answered — carry on? </span>
      <button
        type="button"
        class="rounded bg-accent px-2 py-1 font-medium text-white hover:bg-accent/90"
        @click="resumeAfterAnswers()"
      >
        Continue
      </button>
    </div>

    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="translate-y-1 scale-95 opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="translate-y-1 scale-95 opacity-0"
    >
      <div
        v-if="bubble && bubblePos"
        class="pointer-events-none absolute -translate-y-full rounded-2xl rounded-bl-sm px-3 py-1.5 text-xs leading-snug text-balance shadow-lg ring-1 transition-colors"
        :class="
          bubble.thinking
            ? 'bg-panel/80 font-normal text-muted italic ring-border/60'
            : 'bg-panel font-medium text-surface ring-border'
        "
        :style="{
          left: `${bubblePos.left}px`,
          top: `${bubblePos.top}px`,
          maxWidth: `${BUBBLE_MAX_PX}px`
        }"
      >
        {{ bubble.text
        }}<span
          v-if="bubble.thinking"
          class="ml-0.5 inline-block animate-pulse not-italic"
          aria-hidden="true"
          >▌</span
        >
      </div>
    </Transition>
  </div>
</template>
