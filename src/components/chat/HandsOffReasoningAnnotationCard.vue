<script setup lang="ts">
import { computed, ref } from 'vue'

import HandsOffAnnotatableText from '@/components/Conversation/HandsOffAnnotatableText.vue'
import type {
  HandsOffAnnotationPolarity,
  HandsOffTextSelectionAnnotation
} from '@/app/study/hands-off/annotation'
import type { HandsOffReasoningAnnotationCard } from '@/app/study/hands-off/canvas-session'

const {
  card,
  annotations,
  collapsed = false
} = defineProps<{
  card: HandsOffReasoningAnnotationCard
  annotations: readonly HandsOffTextSelectionAnnotation[]
  /** Once the step's action has been judged, its reasoning cards fold to a
   * header row; the toggle reopens one for reference. */
  collapsed?: boolean
}>()

const annotationsWithBlockId = computed(() =>
  annotations.map((annotation) => ({ ...annotation, blockId: card.id }))
)

const expandedWhileCollapsed = ref(false)
const showBody = computed(() => !collapsed || expandedWhileCollapsed.value)

const emit = defineEmits<{
  annotate: [
    cardId: string,
    selectedText: string,
    startOffset: number,
    endOffset: number,
    polarity: HandsOffAnnotationPolarity
  ]
  done: [cardId: string]
}>()

function relayAnnotation(
  _blockId: string,
  selectedText: string,
  startOffset: number,
  endOffset: number,
  polarity: HandsOffAnnotationPolarity
): void {
  emit('annotate', card.id, selectedText, startOffset, endOffset, polarity)
}
</script>

<template>
  <article
    :data-test-id="`hands-off-reasoning-${card.status}`"
    :class="[
      'overflow-hidden rounded-2xl border text-xs transition-colors',
      card.status === 'pending'
        ? 'border-amber-300 bg-amber-50/70 shadow-sm'
        : 'border-slate-200 bg-slate-50/70 text-slate-500'
    ]"
  >
    <div :class="showBody ? 'p-3' : 'px-3 py-2'">
      <component
        :is="collapsed ? 'button' : 'div'"
        :type="collapsed ? 'button' : undefined"
        :class="[
          'flex w-full items-center gap-2 font-semibold',
          showBody ? 'mb-2' : '',
          collapsed ? 'cursor-pointer text-left' : ''
        ]"
        @click="collapsed && (expandedWhileCollapsed = !expandedWhileCollapsed)"
      >
        <icon-lucide-eye
          :class="card.status === 'pending' ? 'text-amber-600' : 'text-slate-400'"
        />
        <span>Reasoning</span>
        <icon-lucide-check v-if="collapsed" class="size-3.5 text-emerald-600" />
        <span class="ml-auto text-[10px] font-medium text-slate-400">
          Step {{ card.stepNumber }} · Chunk {{ card.chunkIndex }}
        </span>
        <icon-lucide-chevron-down
          v-if="collapsed"
          class="size-3.5 text-slate-400 transition-transform"
          :class="expandedWhileCollapsed ? 'rotate-180' : ''"
        />
      </component>
      <HandsOffAnnotatableText
        v-if="showBody"
        :blocks="[{ id: card.id, text: card.text }]"
        :annotations="annotationsWithBlockId"
        :disabled="card.status !== 'pending'"
        @annotate="relayAnnotation"
      />
    </div>
    <div
      v-if="card.status === 'pending'"
      class="flex justify-end border-t border-amber-200/70 bg-white/70 px-3 py-2"
    >
      <button
        type="button"
        data-test-id="hands-off-reasoning-done"
        class="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700"
        @click="emit('done', card.id)"
      >
        Done
        <icon-lucide-arrow-right class="size-3.5" />
      </button>
    </div>
    <div
      v-else-if="!collapsed"
      class="flex items-center gap-1.5 border-t border-slate-200 px-3 py-2 text-xs"
    >
      <icon-lucide-check class="size-3.5 text-emerald-600" />
      Reviewed
    </div>
  </article>
</template>
