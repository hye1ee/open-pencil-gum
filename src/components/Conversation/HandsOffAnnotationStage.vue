<script setup lang="ts">
import { computed } from 'vue'

import HandsOffAnnotatableText from '@/components/Conversation/HandsOffAnnotatableText.vue'
import type {
  HandsOffAnnotationPolarity,
  HandsOffTextSelectionAnnotation
} from '@/app/study/hands-off/annotation'
import type {
  HandsOffChatPhase,
  HandsOffChatTextSelection,
  HandsOffReasoningBlock
} from '@/app/study/hands-off/chat-session'

const FINAL_ANSWER_BLOCK_ID = 'hands-off-final-answer'

const { phase, reasoningBlocks, finalAnswerText, annotations } = defineProps<{
  phase: HandsOffChatPhase
  reasoningBlocks: readonly HandsOffReasoningBlock[]
  finalAnswerText: string
  annotations: readonly HandsOffTextSelectionAnnotation[]
}>()

const emit = defineEmits<{
  annotate: [selection: HandsOffChatTextSelection]
  done: []
}>()

const currentBlocks = computed(() =>
  phase === 'annotating-final-answer'
    ? [{ id: FINAL_ANSWER_BLOCK_ID, text: finalAnswerText }]
    : reasoningBlocks.map((block) => ({ id: block.id, text: block.text }))
)

const currentAnnotations = computed(() => {
  const currentPhase = phase === 'annotating-final-answer' ? 'final-output' : 'reasoning'
  return annotations
    .filter((annotation) => annotation.phase === currentPhase)
    .map((annotation) => ({
      ...annotation,
      blockId:
        currentPhase === 'final-output'
          ? FINAL_ANSWER_BLOCK_ID
          : `hands-off-reasoning-${annotation.streamId}-${annotation.chunkIndex}`
    }))
})

function relayAnnotation(
  blockId: string,
  selectedText: string,
  startOffset: number,
  endOffset: number,
  polarity: HandsOffAnnotationPolarity
): void {
  const block = reasoningBlocks.find((candidate) => candidate.id === blockId)
  emit('annotate', {
    streamId: block?.streamId ?? 0,
    chunkIndex: block?.chunkIndex ?? 0,
    selectedText,
    startOffset,
    endOffset,
    polarity
  })
}
</script>

<template>
  <section
    class="mx-auto w-full max-w-3xl px-4 pb-3 sm:px-6"
    :data-test-id="`hands-off-stage-${phase}`"
    aria-label="Hands-off review"
  >
    <div
      v-if="phase === 'agent-running'"
      class="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-900"
    >
      <icon-lucide-loader-circle class="size-3.5 animate-spin" />
      The agent is working on your task — the result is revealed when it finishes.
    </div>
    <article
      v-else
      class="overflow-hidden rounded-2xl border border-amber-300 bg-amber-50/70 shadow-sm"
    >
      <div class="flex items-center gap-2 px-4 pt-3 text-sm font-semibold text-slate-800">
        <icon-lucide-eye class="size-4 text-amber-600" />
        <span>
          {{
            phase === 'annotating-final-answer'
              ? 'Review the agent’s answer'
              : 'Review the agent’s reasoning'
          }}
        </span>
      </div>
      <p class="px-4 pt-1 text-[11px] text-slate-500">
        Drag-select any part and mark it as liked or disliked. Marking is optional.
      </p>
      <div class="max-h-[45vh] overflow-y-auto p-4">
        <HandsOffAnnotatableText
          :blocks="currentBlocks"
          :annotations="currentAnnotations"
          @annotate="relayAnnotation"
        />
      </div>
      <div class="flex justify-end border-t border-amber-200/70 bg-white/70 px-4 py-3">
        <button
          type="button"
          data-test-id="hands-off-stage-done"
          class="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-700"
          @click="emit('done')"
        >
          {{ phase === 'annotating-final-answer' ? 'Finish review' : 'Done — show the answer' }}
          <icon-lucide-arrow-right class="size-3.5" />
        </button>
      </div>
    </article>
  </section>
</template>
