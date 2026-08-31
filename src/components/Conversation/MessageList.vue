<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import FeedbackNoteCarousel from '@/components/Conversation/FeedbackNoteCarousel.vue'
import MessageBubble from '@/components/Conversation/MessageBubble.vue'
import ReasoningReviewCard from '@/components/Conversation/ReasoningReviewCard.vue'
import type { ConversationFeedbackItem, ConversationFeedbackNote } from '@/app/conversation/types'
import type { ReasoningReview } from '@/app/study/user-initiated/reasoning-review'
import type { Proposition } from '@/app/user-model/pipeline'
import type { ChatStatus, UIMessage } from 'ai'

const {
  messages,
  status,
  feedbackNotes,
  feedbackGenerating,
  reasoningReviews,
  revising,
  propositions
} = defineProps<{
  messages: UIMessage[]
  status: ChatStatus
  feedbackNotes: ConversationFeedbackNote[]
  feedbackGenerating: boolean
  reasoningReviews: readonly ReasoningReview[]
  revising: boolean
  propositions: Proposition[]
}>()
const emit = defineEmits<{
  continue: [id: string]
  feedback: [id: string, items: ConversationFeedbackItem[]]
  continueReasoning: [id: string]
  reasoningFeedback: [id: string, feedback: string, selectedReasoning: string | null]
}>()
const scroller = ref<HTMLDivElement>()
const followOutput = ref(true)
let lastScrollTop = 0
const lastUserId = computed(
  () => [...messages].reverse().find((message) => message.role === 'user')?.id ?? null
)

function relayFeedback(id: string, items: ConversationFeedbackItem[]): void {
  emit('feedback', id, items)
}

function relayReasoningFeedback(
  id: string,
  feedback: string,
  selectedReasoning: string | null
): void {
  emit('reasoningFeedback', id, feedback, selectedReasoning)
}

function nearBottom(element: HTMLDivElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 32
}

function handleWheel(event: WheelEvent): void {
  if (event.deltaY < 0) followOutput.value = false
}

function handleScroll(): void {
  const element = scroller.value
  if (!element) return
  const movingUp = element.scrollTop < lastScrollTop - 1
  const movingDown = element.scrollTop > lastScrollTop + 1
  if (movingUp) followOutput.value = false
  else if (!followOutput.value && movingDown && nearBottom(element)) followOutput.value = true
  lastScrollTop = element.scrollTop
}

watch(
  () => messages.length,
  (count, previousCount) => {
    if (count > previousCount && messages.at(-1)?.role === 'user') followOutput.value = true
  }
)

watch(
  () => [messages, feedbackNotes, feedbackGenerating, reasoningReviews, revising, status],
  () =>
    nextTick(() => {
      const element = scroller.value
      if (!element || !followOutput.value) return
      element.scrollTop = element.scrollHeight
      lastScrollTop = element.scrollTop
    }),
  { deep: true }
)
</script>

<template>
  <div
    ref="scroller"
    data-test-id="conversation-scroller"
    class="min-h-0 flex-1 overflow-y-auto bg-white"
    @scroll.passive="handleScroll"
    @wheel.passive="handleWheel"
  >
    <div
      v-if="messages.length === 0"
      class="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center px-6 py-16 text-center"
    >
      <div class="flex items-center gap-4">
        <img src="/lenchat.svg?v=2" alt="" class="size-8" />
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">LenChat</h1>
      </div>
    </div>
    <div v-else class="pb-4">
      <template v-for="message in messages" :key="message.id">
        <MessageBubble
          :message="message"
          :active="status === 'streaming' && message.id === messages.at(-1)?.id"
        >
        </MessageBubble>
        <FeedbackNoteCarousel
          v-if="message.id === lastUserId && (feedbackNotes.length > 0 || feedbackGenerating)"
          :notes="feedbackNotes"
          :generating="feedbackGenerating"
          :disabled="revising"
          :propositions="propositions"
          @continue="emit('continue', $event)"
          @feedback="relayFeedback"
        />
        <section
          v-if="reasoningReviews.length > 0 && message.id === lastUserId"
          class="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-5 sm:px-6"
          aria-label="Reasoning reviews"
        >
          <ReasoningReviewCard
            v-for="review in reasoningReviews"
            :key="review.id"
            :review="review"
            :disabled="revising"
            @continue="emit('continueReasoning', $event)"
            @feedback="relayReasoningFeedback"
          />
        </section>
      </template>
      <div
        v-if="
          (status === 'submitted' || (revising && status === 'ready')) &&
          feedbackNotes.length === 0 &&
          !feedbackGenerating
        "
        :data-test-id="revising ? 'conversation-revision-pending' : 'conversation-request-pending'"
        class="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-5 sm:px-6"
        aria-live="polite"
      >
        <div
          class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm"
        >
          <icon-lucide-glasses class="size-3.5" />
        </div>
        <div
          class="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500"
        >
          <icon-lucide-loader-circle class="size-3.5 animate-spin text-blue-600" />
          {{ revising ? 'Revising response…' : 'Preparing response…' }}
        </div>
      </div>
    </div>
  </div>
</template>
