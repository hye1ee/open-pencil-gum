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

function showGeneratingCard(message: UIMessage): boolean {
  if (
    !feedbackGenerating ||
    message.role !== 'assistant' ||
    message.id !== messages.at(-1)?.id
  ) {
    return false
  }
  const notes = notesAfter(message)
  if (notes.length === 0) return true
  const activeIndex = notes.findIndex((note) => note.id === activeNoteId.value)
  return activeIndex === -1 || activeIndex === notes.length - 1
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

function centerActiveNote(): void {
  const id = activeNoteId.value
  if (!id) return
  void nextTick(() => {
    const card = scroller.value?.querySelector<HTMLElement>(`[data-note-id="${id}"]`)
    const carousel = card?.closest<HTMLElement>('[data-feedback-carousel]')
    if (!card || !carousel) return
    const carouselRect = carousel.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const cardLeftInsideCarousel = carousel.scrollLeft + cardRect.left - carouselRect.left
    const centeredLeft =
      cardLeftInsideCarousel - (carousel.clientWidth - card.offsetWidth) / 2
    const maximumLeft = Math.max(0, carousel.scrollWidth - carousel.clientWidth)
    carousel.scrollTo({
      left: Math.min(maximumLeft, Math.max(0, centeredLeft)),
      behavior: 'smooth'
    })
  })
}

watch(
  () => messages.length,
  (count, previousCount) => {
    if (count > previousCount && messages.at(-1)?.role === 'user') followOutput.value = true
  }
)

// Registered before the note watcher below so its immediate run, which can pick
// the first active note, still reaches this.
watch(activeNoteId, (id, previousId) => {
  // The first note replaces the already-centered loading card, so scrolling it
  // would fight the enter/move transition. Later changes are explicit carousel
  // navigation and need one horizontal-only centering operation.
  if (id && previousId) centerActiveNote()
})

watch(
  () => feedbackNotes,
  (notes) => {
    const activeStillPending = notes.some(
      (note) => note.id === activeNoteId.value && note.status === 'pending'
    )
    if (!activeStillPending) {
      activeNoteId.value = notes.find((note) => note.status === 'pending')?.id ?? null
    }
    // Centering belongs to the activeNoteId watcher alone. Scrolling on every
    // note change would run while TransitionGroup animates an inserted card,
    // and the FLIP offsets would then carry the scroll shift.
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
      <div class="flex items-center gap-4">
        <img src="/lenchat.svg" alt="" class="size-8" />
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">LenChat</h1>
      </div>
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
              <TransitionGroup
                tag="div"
                data-feedback-carousel
                class="flex snap-x snap-proximity items-start gap-8 overflow-x-auto pt-7 pb-9 [overflow-anchor:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                enter-active-class="transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                enter-from-class="translate-x-6 opacity-0"
                leave-active-class="transition-[transform,opacity] duration-300 ease-in"
                leave-to-class="-translate-x-6 opacity-0"
              >
                <div
                  :key="`feedback-start-${message.id}`"
                  class="w-[max(1rem,calc(50%_-_13rem))] shrink-0"
                  aria-hidden="true"
                />
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
                  v-if="showGeneratingCard(message)"
                  :key="`feedback-generating-${message.id}`"
                  data-test-id="conversation-feedback-generating"
                  class="w-88 max-w-[calc(100vw-6rem)] shrink-0 snap-center rounded-xl border border-dashed border-violet-300 bg-violet-50/40 p-4"
                  aria-live="polite"
                >
                  <div class="mb-4 flex items-center gap-2 text-xs font-semibold text-violet-700">
                    <icon-lucide-loader-circle class="size-4 animate-spin" />
                    Generating feedback note…
                  </div>
                  <div class="space-y-2.5" aria-hidden="true">
                    <div class="h-4 w-11/12 animate-pulse rounded bg-violet-100" />
                    <div class="h-4 w-8/12 animate-pulse rounded bg-violet-100" />
                    <div
                      class="mt-4 h-12 animate-pulse rounded-lg bg-white ring-1 ring-violet-100"
                    />
                  </div>
                </div>
                <div
                  :key="`feedback-end-${message.id}`"
                  class="w-[max(1rem,calc(50%_-_13rem))] shrink-0"
                  aria-hidden="true"
                />
              </TransitionGroup>
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
