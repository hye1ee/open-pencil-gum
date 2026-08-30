<script setup lang="ts">
import type { HandsOffAnnotationPolarity } from '@/app/study/hands-off/annotation'
import type { HandsOffPendingStepAction } from '@/app/study/hands-off/canvas-session'

const { pendingStepAction } = defineProps<{
  pendingStepAction: HandsOffPendingStepAction
}>()

const emit = defineEmits<{
  submit: [polarity: HandsOffAnnotationPolarity | 'skipped']
}>()
</script>

<template>
  <article
    data-test-id="hands-off-step-action"
    class="overflow-hidden rounded-2xl border border-amber-300 bg-amber-50/70 text-xs shadow-sm"
  >
    <div class="p-3">
      <div class="mb-1 flex items-center gap-2 font-semibold">
        <icon-lucide-wand-sparkles class="text-amber-600" />
        <span>
          {{
            pendingStepAction.isFinalResponse
              ? 'How was the agent’s final response?'
              : `How was step ${pendingStepAction.stepNumber}’s action?`
          }}
        </span>
      </div>
      <p
        v-if="!pendingStepAction.isFinalResponse"
        class="text-[11px] leading-relaxed text-slate-500"
      >
        Applied {{ pendingStepAction.executedToolNames.join(', ') }} on the canvas.
      </p>
    </div>
    <div class="flex justify-end gap-2 border-t border-amber-200/70 bg-white/70 px-3 py-2">
      <button
        type="button"
        data-test-id="hands-off-step-skip"
        class="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
        @click="emit('submit', 'skipped')"
      >
        Skip
      </button>
      <button
        type="button"
        data-test-id="hands-off-step-liked"
        class="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
        @click="emit('submit', 'liked')"
      >
        <icon-lucide-thumbs-up class="size-3.5" />
        Like
      </button>
      <button
        type="button"
        data-test-id="hands-off-step-disliked"
        class="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50"
        @click="emit('submit', 'disliked')"
      >
        <icon-lucide-thumbs-down class="size-3.5" />
        Dislike
      </button>
    </div>
  </article>
</template>
