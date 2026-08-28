<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'

const { reasoning, active, reasoningActive, reasoningChunks, highlight } = defineProps<{
  reasoning: string
  active: boolean
  reasoningActive: boolean
  reasoningChunks: string[]
  highlight: string
}>()
const expanded = ref(false)
const livePreview = ref<HTMLDivElement>()

function trimBoundaryNewlines(value: string): string {
  return value.replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, '')
}

interface ReasoningSegment {
  text: string
  highlighted: boolean
}

function highlightedSegments(value: string, evidence: string): ReasoningSegment[] {
  const cleanEvidence = evidence.trim()
  if (!cleanEvidence) return [{ text: value, highlighted: false }]
  const pattern = cleanEvidence
    .split(/\s+/)
    .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')
  const match = new RegExp(pattern, 'i').exec(value)
  if (!match) return [{ text: value, highlighted: false }]
  const before = value.slice(0, match.index)
  const selected = value.slice(match.index, match.index + match[0].length)
  const after = value.slice(match.index + match[0].length)
  return [
    ...(before ? [{ text: before, highlighted: false }] : []),
    { text: selected, highlighted: true },
    ...(after ? [{ text: after, highlighted: false }] : [])
  ]
}

const visibleReasoningChunks = computed(() => {
  let chunks: string[] = []
  if (reasoningChunks.length > 0) chunks = [...reasoningChunks]
  else if (reasoning) chunks = [reasoning]
  if (chunks.length === 0) return chunks
  chunks[0] = chunks[0]?.replace(/^(?:\r?\n)+/, '') ?? ''
  const last = chunks.length - 1
  chunks[last] = chunks[last]?.replace(/(?:\r?\n)+$/, '') ?? ''
  return chunks.filter((chunk) => chunk !== '')
})
const expandedReasoning = computed(() =>
  trimBoundaryNewlines(visibleReasoningChunks.value.join('\n\n'))
)
const liveReasoning = computed(() => trimBoundaryNewlines(visibleReasoningChunks.value.join('')))
const liveReasoningSegments = computed(() => highlightedSegments(liveReasoning.value, highlight))
const expandedReasoningSegments = computed(() =>
  highlightedSegments(expandedReasoning.value, highlight)
)

watch(
  () => highlight,
  (value, previous) => {
    if (value && value !== previous) expanded.value = true
  },
  { immediate: true }
)

watch([visibleReasoningChunks, expanded, () => highlight], () => {
  if (expanded.value) return
  void nextTick(() => {
    const preview = livePreview.value
    if (!preview) return
    const selected = preview.querySelector<HTMLElement>('[data-reasoning-highlight]')
    if (!selected) {
      preview.scrollTop = preview.scrollHeight
      return
    }
    const previewBox = preview.getBoundingClientRect()
    const selectedBox = selected.getBoundingClientRect()
    const selectedTop = selectedBox.top - previewBox.top + preview.scrollTop
    preview.scrollTop = Math.max(0, selectedTop - (preview.clientHeight - selectedBox.height) / 2)
  })
})
</script>

<template>
  <CollapsibleRoot
    v-if="reasoning || active"
    v-model:open="expanded"
    class="mb-3 w-full"
    :class="expanded ? 'rounded-lg bg-slate-100/70' : ''"
  >
    <CollapsibleTrigger
      class="group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
    >
      <icon-lucide-loader-circle
        v-if="reasoningActive"
        class="size-3.5 animate-spin text-blue-600"
      />
      <icon-lucide-lightbulb v-else class="size-3.5 text-blue-600" />
      <span>{{ reasoningActive ? 'Reasoning…' : 'Reasoning' }}</span>
      <icon-lucide-chevron-down
        class="ml-auto size-3 transition-transform group-data-[state=open]:rotate-180"
      />
    </CollapsibleTrigger>
    <div v-if="active && !expanded" class="mt-1 w-full" aria-live="polite">
      <div
        ref="livePreview"
        class="max-h-[3.75rem] min-h-5 w-full cursor-text overflow-hidden px-2 text-xs leading-5 text-slate-500 select-text [-webkit-user-select:text]"
      >
        <p v-if="highlight && liveReasoning" class="whitespace-pre-wrap">
          <template v-for="(segment, index) in liveReasoningSegments" :key="index">
            <mark
              v-if="segment.highlighted"
              data-reasoning-highlight
              class="rounded bg-amber-200/90 px-0.5 text-slate-800"
              >{{ segment.text }}</mark
            >
            <template v-else>{{ segment.text }}</template>
          </template>
        </p>
        <TransitionGroup
          v-else-if="visibleReasoningChunks.length"
          name="reasoning-update"
          tag="p"
          class="whitespace-pre-wrap"
        >
          <span
            v-for="(chunk, index) in visibleReasoningChunks"
            :key="index"
            class="reasoning-chunk"
            >{{ chunk }}</span
          >
        </TransitionGroup>
        <p v-else class="text-slate-400">Waiting for the model’s reasoning trace…</p>
      </div>
    </div>
    <CollapsibleContent
      class="overflow-hidden data-[state=closed]:collapsible-up data-[state=open]:collapsible-down"
    >
      <div class="mt-1 w-full px-3 py-2 text-xs leading-5 whitespace-pre-wrap text-slate-600">
        <template v-if="expandedReasoning">
          <template v-for="(segment, index) in expandedReasoningSegments" :key="index">
            <mark
              v-if="segment.highlighted"
              data-reasoning-highlight
              class="rounded bg-amber-200/90 px-0.5 text-slate-800"
              >{{ segment.text }}</mark
            >
            <template v-else>{{ segment.text }}</template>
          </template>
        </template>
        <template v-else>Waiting for the model’s reasoning trace…</template>
      </div>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>

<style scoped>
.reasoning-update-enter-active,
.reasoning-update-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.reasoning-update-enter-from {
  opacity: 0;
  transform: translateY(2px);
}

.reasoning-update-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

@media (prefers-reduced-motion: reduce) {
  .reasoning-update-enter-active,
  .reasoning-update-leave-active {
    transition: none;
  }
}
</style>
