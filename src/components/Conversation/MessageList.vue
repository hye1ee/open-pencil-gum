<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import InlineFeedbackNote from '@/components/Conversation/InlineFeedbackNote.vue'
import MessageBubble from '@/components/Conversation/MessageBubble.vue'
import type { ConversationFeedbackItem, ConversationFeedbackNote } from '@/app/conversation/types'
import type { Proposition } from '@/app/user-model/pipeline'
import type { ChatStatus, UIMessage } from 'ai'

const { messages, status, feedbackNotes, feedbackGenerating, revising, propositions } =
  defineProps<{
    messages: UIMessage[]
    status: ChatStatus
    feedbackNotes: ConversationFeedbackNote[]
    feedbackGenerating: boolean
    revising: boolean
    propositions: Proposition[]
  }>()
const emit = defineEmits<{
  continue: [id: string]
  feedback: [id: string, items: ConversationFeedbackItem[]]
}>()
const scroller = ref<HTMLDivElement>()
const activeNoteId = ref<string | null>(null)
const followOutput = ref(true)
let lastScrollTop = 0
const lastAssistantId = computed(
  () => [...messages].reverse().find((message) => message.role === 'assistant')?.id ?? null
)

function notesAfter(message: UIMessage): ConversationFeedbackNote[] {
  if (message.role !== 'assistant') return []
  return feedbackNotes.filter(
    (note) =>
      note.messageId === message.id ||
      (note.messageId === null && lastAssistantId.value === message.id)
  )
}

function notePhase(note: ConversationFeedbackNote): 'reviewed' | 'current' | 'waiting' {
  if (note.status !== 'pending') return 'reviewed'
  return note.id === activeNoteId.value ? 'current' : 'waiting'
}

function activateNote(id: string): void {
  if (!feedbackNotes.some((note) => note.id === id && note.status === 'pending')) return
  activeNoteId.value = id
}

function relayFeedback(id: string, items: ConversationFeedbackItem[]): void {
  emit('feedback', id, items)
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
  () => feedbackNotes,
  (notes) => {
    const activeStillPending = notes.some(
      (note) => note.id === activeNoteId.value && note.status === 'pending'
    )
    if (!activeStillPending) {
      activeNoteId.value = notes.find((note) => note.status === 'pending')?.id ?? null
    }
    const id = activeNoteId.value
    if (!id) return
    void nextTick(() => {
      const card = scroller.value?.querySelector<HTMLElement>(`[data-note-id="${id}"]`)
      card?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    })
  },
  { deep: true, immediate: true }
)

watch(
  () => [messages, feedbackNotes, feedbackGenerating, revising, status],
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
        >
          <template #meta-agent>
            <section
              v-if="
                notesAfter(message).length > 0 ||
                (feedbackGenerating &&
                  message.role === 'assistant' &&
                  message.id === messages.at(-1)?.id)
              "
              class="my-6"
              aria-label="Feedback notes"
            >
              <div class="mb-1 flex items-center justify-between gap-3 px-1">
                <p class="text-xs font-semibold tracking-wide text-slate-500">Feedback notes</p>
                <p class="text-[11px] text-slate-400">
                  {{ notesAfter(message).filter((note) => note.status !== 'pending').length }} of
                  {{ notesAfter(message).length }} reviewed
                </p>
              </div>
              <div
                class="flex snap-x snap-mandatory scroll-px-7 items-start gap-5 overflow-x-auto px-7 pt-7 pb-9 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <InlineFeedbackNote
                  v-for="note in notesAfter(message)"
                  :key="note.id"
                  :note="note"
                  :phase="notePhase(note)"
                  :disabled="revising"
                  :propositions="propositions"
                  @activate="activateNote"
                  @continue="emit('continue', $event)"
                  @feedback="relayFeedback"
                />
                <div
                  v-if="
                    feedbackGenerating &&
                    message.role === 'assistant' &&
                    message.id === messages.at(-1)?.id
                  "
                  data-test-id="conversation-feedback-generating"
                  class="w-72 max-w-[calc(100vw-4rem)] shrink-0 snap-start rounded-xl border border-dashed border-violet-300 bg-violet-50/40 p-4"
                >
                  <div class="mb-4 flex items-center gap-2 text-xs font-semibold text-violet-700">
                    <icon-lucide-loader-circle class="size-4 animate-spin" />
                    Generating feedback…
                  </div>
                  <div class="space-y-2.5" aria-hidden="true">
                    <div class="h-4 w-11/12 animate-pulse rounded bg-violet-100" />
                    <div class="h-4 w-8/12 animate-pulse rounded bg-violet-100" />
                    <div
                      class="mt-4 h-12 animate-pulse rounded-lg bg-white ring-1 ring-violet-100"
                    />
                  </div>
                </div>
                <div class="w-2 shrink-0" aria-hidden="true" />
              </div>
            </section>
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
