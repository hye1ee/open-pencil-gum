<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { templateRef, unrefElement } from '@vueuse/core'

import InlineFeedbackNote from '@/components/Conversation/InlineFeedbackNote.vue'
import type { ConversationFeedbackItem, ConversationFeedbackNote } from '@/app/conversation/types'
import type { Proposition } from '@/app/user-model/pipeline'

const { notes, generating, disabled, propositions } = defineProps<{
  notes: ConversationFeedbackNote[]
  generating: boolean
  disabled: boolean
  propositions: Proposition[]
}>()
const emit = defineEmits<{
  continue: [id: string]
  feedback: [id: string, items: ConversationFeedbackItem[]]
}>()

const carousel = templateRef<HTMLElement>('carousel')
const activeNoteId = ref<string | null>(null)

function notePhase(note: ConversationFeedbackNote): 'reviewed' | 'current' | 'waiting' {
  if (note.status !== 'pending') return 'reviewed'
  return note.id === activeNoteId.value ? 'current' : 'waiting'
}

function activateNote(id: string): void {
  if (!notes.some((note) => note.id === id && note.status === 'pending')) return
  activeNoteId.value = id
}

function relayFeedback(id: string, items: ConversationFeedbackItem[]): void {
  emit('feedback', id, items)
}

function showGeneratingCard(): boolean {
  if (!generating) return false
  if (notes.length === 0) return true
  const activeIndex = notes.findIndex((note) => note.id === activeNoteId.value)
  return activeIndex === -1 || activeIndex === notes.length - 1
}

function centerActiveNote(): void {
  const id = activeNoteId.value
  if (!id) return
  void nextTick(() => {
    const element = unrefElement(carousel)
    if (!(element instanceof HTMLElement)) return
    const card = element.querySelector<HTMLElement>(`[data-note-id="${id}"]`)
    if (!card) return
    const carouselRect = element.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const cardLeftInsideCarousel = element.scrollLeft + cardRect.left - carouselRect.left
    const centeredLeft = cardLeftInsideCarousel - (element.clientWidth - card.offsetWidth) / 2
    const maximumLeft = Math.max(0, element.scrollWidth - element.clientWidth)
    element.scrollTo({
      left: Math.min(maximumLeft, Math.max(0, centeredLeft)),
      behavior: 'smooth'
    })
  })
}

watch(activeNoteId, (id, previousId) => {
  if (id && previousId) centerActiveNote()
})

watch(
  () => notes,
  (nextNotes) => {
    const activeStillPending = nextNotes.some(
      (note) => note.id === activeNoteId.value && note.status === 'pending'
    )
    if (!activeStillPending) {
      activeNoteId.value = nextNotes.find((note) => note.status === 'pending')?.id ?? null
    }
  },
  { deep: true, immediate: true }
)
</script>

<template>
  <section class="my-6" aria-label="Feedback notes">
    <div class="mx-auto mb-1 flex w-full max-w-3xl items-center justify-between gap-3 px-5">
      <p class="text-xs font-semibold tracking-wide text-slate-500">Feedback notes</p>
      <p class="text-[11px] text-slate-400">
        {{ notes.filter((note) => note.status !== 'pending').length }} of
        {{ notes.length }} reviewed
      </p>
    </div>
    <TransitionGroup
      ref="carousel"
      tag="div"
      data-feedback-carousel
      class="flex snap-x snap-proximity items-start gap-8 overflow-x-auto pt-7 pb-9 [overflow-anchor:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      enter-active-class="transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
      enter-from-class="translate-x-6 opacity-0"
      leave-active-class="transition-[transform,opacity] duration-300 ease-in"
      leave-to-class="-translate-x-6 opacity-0"
    >
      <div
        key="feedback-start"
        class="w-[max(1rem,calc(50%_-_13rem))] shrink-0"
        aria-hidden="true"
      />
      <InlineFeedbackNote
        v-for="note in notes"
        :key="note.id"
        :note="note"
        :phase="notePhase(note)"
        :disabled="disabled"
        :propositions="propositions"
        @activate="activateNote"
        @continue="emit('continue', $event)"
        @feedback="relayFeedback"
      />
      <div
        v-if="showGeneratingCard()"
        key="feedback-generating"
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
          <div class="mt-4 h-12 animate-pulse rounded-lg bg-white ring-1 ring-violet-100" />
        </div>
      </div>
      <div key="feedback-end" class="w-[max(1rem,calc(50%_-_13rem))] shrink-0" aria-hidden="true" />
    </TransitionGroup>
  </section>
</template>
