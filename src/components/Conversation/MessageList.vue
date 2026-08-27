<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import InlineFeedbackNote from '@/components/Conversation/InlineFeedbackNote.vue'
import MessageBubble from '@/components/Conversation/MessageBubble.vue'
import type { ConversationFeedbackNote } from '@/app/conversation/types'
import type { ChatStatus, UIMessage } from 'ai'

const { messages, status, feedback, monitorActive, revising, reasoningChunks } = defineProps<{
  messages: UIMessage[]
  status: ChatStatus
  feedback: ConversationFeedbackNote | null
  monitorActive: boolean
  revising: boolean
  reasoningChunks: string[]
}>()
const emit = defineEmits<{ continue: []; feedback: [text: string] }>()
const scroller = ref<HTMLDivElement>()
const followOutput = ref(true)
let lastScrollTop = 0
const lastAssistantId = computed(
  () => [...messages].reverse().find((message) => message.role === 'assistant')?.id ?? null
)

function noteBelongsAfter(message: UIMessage): boolean {
  if (!feedback || message.role !== 'assistant') return false
  return (
    feedback.messageId === message.id ||
    (feedback.messageId === null && lastAssistantId.value === message.id)
  )
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
  () => [messages, feedback, monitorActive, revising, status],
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
      <h1 class="text-2xl font-semibold tracking-tight text-slate-900">LenChat</h1>
    </div>
    <div v-else class="pb-4">
      <template v-for="message in messages" :key="message.id">
        <MessageBubble
          :message="message"
          :active="status === 'streaming' && message.id === messages.at(-1)?.id"
          :reasoning-chunks="
            status === 'streaming' && message.id === messages.at(-1)?.id ? reasoningChunks : []
          "
          :reasoning-highlight="
            noteBelongsAfter(message) && feedback ? feedback.reasoningEvidence : ''
          "
        >
          <template #meta-agent>
            <div
              v-if="
                monitorActive && message.role === 'assistant' && message.id === messages.at(-1)?.id
              "
              class="mb-3 flex w-full items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500"
            >
              <icon-lucide-scan-search class="size-3.5 animate-pulse text-blue-600" />Comparing this
              decision with your conversation preferences…
            </div>
            <InlineFeedbackNote
              v-if="noteBelongsAfter(message) && feedback"
              :note="feedback"
              :disabled="monitorActive"
              @continue="emit('continue')"
              @feedback="emit('feedback', $event)"
            />
          </template>
        </MessageBubble>
      </template>
      <div
        v-if="status === 'submitted' || (revising && status === 'ready')"
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
