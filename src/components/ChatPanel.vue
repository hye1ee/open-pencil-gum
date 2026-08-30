<script setup lang="ts">
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui'
import { refAutoReset } from '@vueuse/core'
import { computed, markRaw, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'

import { getAcpDebugText, clearAcpDebugLog, hasAcpDebugEntries } from '@/app/ai/acp/transport'
import { hideAgentCursor, showAgentCursor } from '@/app/ai/chat/agent-cursor'
import { agentActivity } from '@/app/ai/chat/agent-activity'
import { logFeedbackAnswer, logFeedbackStep, logUserMessage } from '@/app/ai/chat/agent-log'
import {
  abandonTurn,
  abandonTurnAtCommit,
  agentTurn,
  resumeTurn,
  setTurnRunning
} from '@/app/ai/chat/agent-turn'
import { enqueueUserMessage } from '@/app/ai/chat/user-messages'
import { withoutDanglingToolCalls } from '@/app/ai/chat/transcript'
import {
  composeChatTimeline,
  type ChatTimelineInsertion,
  type MidRunUserMessage
} from '@/app/ai/chat/timeline'
import { copyChatLog } from '@/app/ai/debug'
import { renderStepFeedbackReport } from '@/app/meta-agent/hosts/lencanvas/feedback-note/report'
import { userModelFeedbackBatch } from '@/app/meta-agent/hosts/lencanvas/feedback-note/user-model'
import {
  beginFeedbackReplay,
  hasExplicitStepFeedback,
  setStepFeedbackHandler,
  type StepFeedbackResult
} from '@/app/meta-agent/hosts/lencanvas/feedback-note/session'
import {
  clearToolLogEntries,
  continueRunSteps,
  currentRunStepNumber,
  didHitStepLimit
} from '@/app/ai/tools'
import { currentMetaRequest } from '@/app/meta-agent/hosts/lencanvas/use'
import { reasoningFeedbackBatch } from '@/app/user-model/user-initiated/batch'
import { observeFeedbackNotes, observeUserInitiatedFeedback } from '@/app/user-model/use'
import { getActiveEditorStore } from '@/app/editor/active-store'
import { getStudyRuntime, isHandsOffDelegationCondition, studyRuntime } from '@/app/study/runtime'
import { renderReasoningFeedbackReport } from '@/app/study/user-initiated/report'
import { activeTab } from '@/app/tabs'
import AcpPermissionDialog from '@/components/chat/AcpPermissionDialog.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import ChatMessage from '@/components/chat/ChatMessage.vue'
import HandsOffReasoningAnnotationCard from '@/components/chat/HandsOffReasoningAnnotationCard.vue'
import HandsOffStepActionAnnotationCard from '@/components/chat/HandsOffStepActionAnnotationCard.vue'
import AskUserCard from '@/components/Conversation/AskUserCard.vue'
import ReasoningReviewCard from '@/components/Conversation/ReasoningReviewCard.vue'
import AppTextButton from '@/components/ui/AppTextButton.vue'
import ProviderSetup from '@/components/chat/ProviderSetup.vue'
import { useAIChat } from '@/app/ai/chat/use'
import { toast } from '@/app/shell/ui'
import { lencanvasHandsOffAnnotations } from '@/app/meta-agent/hosts/lencanvas/hands-off'
import { lencanvasReasoningReviews } from '@/app/meta-agent/hosts/lencanvas/user-initiated'
import { useI18n } from '@open-pencil/vue'

import type { Chat } from '@ai-sdk/vue'
import type { UIMessage } from 'ai'
import type { HandsOffAnnotationPolarity } from '@/app/study/hands-off/annotation'
import type { HandsOffReasoningAnnotationCard as HandsOffReasoningCard } from '@/app/study/hands-off/canvas-session'
import type {
  ReasoningFeedbackOutcome,
  ReasoningReview
} from '@/app/study/user-initiated/reasoning-review'

const IS_DEV = import.meta.env.DEV

const {
  isConfigured,
  ensureChat,
  noteUserRequest,
  resetChat,
  askUserQuestion,
  answerAskUser,
  stopAskUser
} = useAIChat()
const { dialogs } = useI18n()

const chat = shallowRef<Chat<UIMessage> | null>(null)

ensureChat().then((c) => {
  if (c) chat.value = markRaw(c)
})
const messagesEnd = ref<HTMLDivElement>()
const debugCopied = refAutoReset(false, 1500)
const acpLogCopied = refAutoReset(false, 1500)

const messages = computed(() => chat.value?.messages ?? [])
const reasoningReviews = lencanvasReasoningReviews.reviews
const handsOffActive = computed(() => isHandsOffDelegationCondition(studyRuntime.value.condition))
const handsOffCards = lencanvasHandsOffAnnotations.cards
const handsOffAnnotations = lencanvasHandsOffAnnotations.annotations
const handsOffStepActionAnnotations = lencanvasHandsOffAnnotations.stepActionAnnotations
const pendingHandsOffStepAction = lencanvasHandsOffAnnotations.pendingStepAction

// Collapse a step's reasoning cards once its executed action has been judged;
// the annotations stay recorded, the cards just stop taking vertical space.
const handsOffEvaluatedSteps = computed(
  () =>
    new Set(
      handsOffStepActionAnnotations.value
        .filter((annotation) => annotation.stepNumber > 0)
        .map((annotation) => annotation.stepNumber)
    )
)

function isHandsOffCardCollapsed(card: HandsOffReasoningCard): boolean {
  return card.status === 'done' && handsOffEvaluatedSteps.value.has(card.stepNumber)
}

function handsOffAnnotationsForCard(card: HandsOffReasoningCard) {
  return handsOffAnnotations.value.filter(
    (annotation) =>
      annotation.streamId === card.streamId && annotation.chunkIndex === card.chunkIndex
  )
}

function handleHandsOffAnnotate(
  cardId: string,
  selectedText: string,
  startOffset: number,
  endOffset: number,
  polarity: HandsOffAnnotationPolarity
): void {
  lencanvasHandsOffAnnotations.addReasoningAnnotation(
    cardId,
    selectedText,
    startOffset,
    endOffset,
    polarity
  )
}
const visibleMessages = computed(() =>
  messages.value.filter((message) => {
    const metadata = message.metadata
    return !(typeof metadata === 'object' && metadata !== null && 'internal' in metadata)
  })
)
const status = computed(() => chat.value?.status ?? 'ready')
const isRunning = computed(() => status.value === 'streaming' || status.value === 'submitted')
const retryHandoffToken = ref<number | null>(null)
let nextRetryHandoffToken = 1
let activeChatRequest: Promise<void> | null = null
let reasoningRevisionScheduled = false
let reasoningFeedbackOutcomes: ReasoningFeedbackOutcome[] = []
let reasoningCommitBoundary: Promise<void> | null = null
const logicallyRunning = computed(
  () => isRunning.value || retryHandoffToken.value !== null || agentTurn.paused
)

// Messages the user typed while a run was in progress. They're injected into the
// running loop (not the persisted history), so we echo them here optimistically.
const queuedBubbles = ref<MidRunUserMessage[]>([])
type ChatPanelInsertionValue =
  | { type: 'reasoning-review'; review: ReasoningReview }
  | { type: 'hands-off-reasoning'; card: HandsOffReasoningCard }
type ReasoningReviewAnchor = {
  reviewId: string
  anchorMessageId: string
  afterPartCount: number | null
}
const reasoningReviewAnchors = ref<ReasoningReviewAnchor[]>([])
watch(
  reasoningReviews,
  (reviews) => {
    if (reviews.length === 0) {
      reasoningReviewAnchors.value = []
      return
    }
    const anchored = new Set(reasoningReviewAnchors.value.map((item) => item.reviewId))
    const additions: ReasoningReviewAnchor[] = []
    for (const review of reviews) {
      if (anchored.has(review.id)) continue
      const anchor = visibleMessages.value.at(-1)
      if (!anchor) continue
      additions.push({
        reviewId: review.id,
        anchorMessageId: anchor.id,
        afterPartCount: anchor.role === 'assistant' ? anchor.parts.length : null
      })
    }
    if (additions.length > 0) {
      reasoningReviewAnchors.value = [...reasoningReviewAnchors.value, ...additions]
    }
  },
  { flush: 'sync', immediate: true }
)
const reasoningReviewInsertions = computed<ChatTimelineInsertion<ChatPanelInsertionValue>[]>(
  () => {
    const reviews = new Map(reasoningReviews.value.map((review) => [review.id, review]))
    return reasoningReviewAnchors.value.flatMap((anchor) => {
      const review = reviews.get(anchor.reviewId)
      if (!review) return []
      return [
        {
          key: `review-${review.id}`,
          anchorMessageId: anchor.anchorMessageId,
          afterPartCount: anchor.afterPartCount,
          value: { type: 'reasoning-review' as const, review }
        }
      ]
    })
  }
)

// Hands-off reasoning cards use the same anchoring as reasoning reviews, so a
// step's cards appear between that step's tool actions instead of pooling at
// the bottom of the timeline.
type HandsOffCardAnchor = {
  cardId: string
  anchorMessageId: string
  afterPartCount: number | null
}
const handsOffCardAnchors = ref<HandsOffCardAnchor[]>([])
watch(
  handsOffCards,
  (cards) => {
    if (cards.length === 0) {
      handsOffCardAnchors.value = []
      return
    }
    const anchored = new Set(handsOffCardAnchors.value.map((item) => item.cardId))
    const additions: HandsOffCardAnchor[] = []
    for (const card of cards) {
      if (anchored.has(card.id)) continue
      const anchor = visibleMessages.value.at(-1)
      if (!anchor) continue
      additions.push({
        cardId: card.id,
        anchorMessageId: anchor.id,
        afterPartCount: anchor.role === 'assistant' ? anchor.parts.length : null
      })
    }
    if (additions.length > 0) {
      handsOffCardAnchors.value = [...handsOffCardAnchors.value, ...additions]
    }
  },
  { flush: 'sync', immediate: true }
)
const handsOffCardInsertions = computed<ChatTimelineInsertion<ChatPanelInsertionValue>[]>(() => {
  const cards = new Map(handsOffCards.value.map((card) => [card.id, card]))
  return handsOffCardAnchors.value.flatMap((anchor) => {
    const card = cards.get(anchor.cardId)
    if (!card) return []
    return [
      {
        key: `hands-off-${card.id}`,
        anchorMessageId: anchor.anchorMessageId,
        afterPartCount: anchor.afterPartCount,
        value: { type: 'hands-off-reasoning' as const, card }
      }
    ]
  })
})

const timelineMessages = computed(() =>
  composeChatTimeline(visibleMessages.value, queuedBubbles.value, [
    ...reasoningReviewInsertions.value,
    ...handsOffCardInsertions.value
  ])
)
const anchoredReasoningReviewIds = computed(
  () => new Set(reasoningReviewAnchors.value.map((item) => item.reviewId))
)
const unanchoredReasoningReviews = computed(() =>
  reasoningReviews.value.filter((review) => !anchoredReasoningReviewIds.value.has(review.id))
)
const anchoredHandsOffCardIds = computed(
  () => new Set(handsOffCardAnchors.value.map((item) => item.cardId))
)
const unanchoredHandsOffCards = computed(() =>
  handsOffCards.value.filter((card) => !anchoredHandsOffCardIds.value.has(card.id))
)
let nextQueuedBubbleId = 1
// Counted off the run rather than off the last assistant message. A build
// restarted after Feedback Note input writes a second assistant message, so
// the retry remains an implementation detail and does not reset the visible step.
const currentStep = computed(() => currentRunStepNumber())

const activityText = computed(() => {
  if (askUserQuestion.value) return 'Waiting for your answer…'
  if (agentActivity.metaAgentTasks > 0) return "Reviewing the current agent's reasoning…"
  if (!logicallyRunning.value) return null
  if (agentTurn.paused) return 'Waiting for your feedback…'
  if (currentStep.value === 0) return 'Starting the task…'
  return `Working on step ${currentStep.value}…`
})

const activityIsProcessing = computed(
  () =>
    !askUserQuestion.value &&
    (agentActivity.metaAgentTasks > 0 || (logicallyRunning.value && !agentTurn.paused))
)

const showStepBar = computed(() => logicallyRunning.value)

function beginRetryHandoff(): number {
  const token = nextRetryHandoffToken++
  retryHandoffToken.value = token
  setTurnRunning(true)
  return token
}

function finishRetryHandoff(token: number): void {
  if (retryHandoffToken.value !== token) return
  retryHandoffToken.value = null
  setTurnRunning(isRunning.value)
}

function trackChatRequest(request: Promise<void>): Promise<void> {
  const tracked = request.finally(() => {
    if (activeChatRequest === tracked) activeChatRequest = null
  })
  activeChatRequest = tracked
  return tracked
}

const showContinue = computed(() => {
  if (status.value !== 'ready') return false
  if (messages.value.length === 0) return false
  const last = messages.value[messages.value.length - 1]
  return last.role === 'assistant' && didHitStepLimit()
})

function scrollToBottom() {
  nextTick(() => {
    messagesEnd.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  })
}

watch(messages, scrollToBottom, { deep: true })
watch(activityText, scrollToBottom)
watch(reasoningReviews, scrollToBottom, { deep: true })
watch(handsOffCards, scrollToBottom, { deep: true })
watch(pendingHandsOffStepAction, scrollToBottom)
watch(
  () => chat.value?.error,
  (error) => {
    if (error) toast.error(error.message)
  }
)
watch(
  () => activeTab.value?.id,
  async () => {
    const nextChat = await ensureChat()
    chat.value = nextChat ? markRaw(nextChat) : null
    showAgentCursor(getActiveEditorStore())
  }
)

watch(
  isRunning,
  (running) => {
    if (!running && retryHandoffToken.value !== null) return
    setTurnRunning(running)
  },
  { immediate: true }
)

onMounted(() => showAgentCursor(getActiveEditorStore()))
onUnmounted(() => {
  hideAgentCursor(getActiveEditorStore())
  setStepFeedbackHandler(null)
  lencanvasReasoningReviews.reset()
  lencanvasHandsOffAnnotations.reset()
})

async function handleSubmit(text: string) {
  // Mid-run: route to the intervention queue instead of a new chat turn, and
  // echo the bubble so the user sees what they sent. The agent picks it up at
  // its next step boundary and adapts its remaining tool calls.
  if (isRunning.value) {
    enqueueUserMessage(getActiveEditorStore(), text)
    const anchor = visibleMessages.value.at(-1)
    if (anchor) {
      queuedBubbles.value = [
        ...queuedBubbles.value,
        {
          id: `queued-${nextQueuedBubbleId++}`,
          text,
          anchorMessageId: anchor.id,
          afterPartCount: anchor.role === 'assistant' ? anchor.parts.length : null
        }
      ]
    }
    return
  }

  queuedBubbles.value = []
  reasoningRevisionScheduled = false
  reasoningFeedbackOutcomes = []
  reasoningCommitBoundary = null
  lencanvasReasoningReviews.setObserving(true)
  lencanvasReasoningReviews.beginRequest(text)
  if (handsOffActive.value) lencanvasHandsOffAnnotations.beginRun(text)
  try {
    const c = await ensureChat()
    if (c) chat.value = markRaw(c)
  } catch (e) {
    console.error('Failed to initialize chat:', e)
    toast.error(e instanceof Error ? e.message : String(e))
    return
  }
  noteUserRequest(text)
  const activeChat = chat.value
  if (!activeChat) return
  void trackChatRequest(activeChat.sendMessage({ text })).catch((e: unknown) => {
    console.error('Chat error:', e)
    toast.error(e instanceof Error ? e.message : String(e))
  })
}

/**
 * Stop, from the button.
 *
 * `abandonTurn` first so a tool call already parked at a Feedback Note hold is
 * invalidated before the provider request is stopped.
 */
function handleStop() {
  stopAskUser()
  reasoningRevisionScheduled = false
  reasoningFeedbackOutcomes = []
  reasoningCommitBoundary = null
  abandonTurn('stop button')
  // After the abandonment so a held tool call is invalidated, not released.
  lencanvasHandsOffAnnotations.reset()
  void chat.value?.stop()
}

function handleAskUserAnswer(answer: string, selectedOption: string | null): void {
  answerAskUser(answer, selectedOption)
}

function handleReasoningFeedback(
  reviewId: string,
  feedback: string,
  selectedReasoning: string | null
): void {
  const outcome = lencanvasReasoningReviews.submitFeedback(reviewId, feedback, selectedReasoning)
  if (!outcome) return
  reasoningFeedbackOutcomes.push(outcome)
  if (!reasoningCommitBoundary) {
    const activeChat = chat.value
    reasoningCommitBoundary = abandonTurnAtCommit('reasoning feedback retry')
    // The model stream has now exposed every reviewable reasoning chunk and
    // reached this step's action/final boundary. Stop the discarded request so
    // the SDK request promise settles, then the single step-level retry below
    // can start with every explicit response collected for this step.
    void reasoningCommitBoundary.then(async () => {
      if (chat.value !== activeChat) return
      await activeChat?.stop()
    })
  }
  scheduleReasoningFeedbackRetry()
}

function scheduleReasoningFeedbackRetry(): void {
  if (reasoningRevisionScheduled || reasoningFeedbackOutcomes.length === 0) return
  reasoningRevisionScheduled = true
  void retryFromReasoningFeedback(chat.value, activeChatRequest)
}

async function retryFromReasoningFeedback(
  activeChat: Chat<UIMessage> | null,
  firstRequest: Promise<void> | null
): Promise<void> {
  if (!activeChat) {
    reasoningRevisionScheduled = false
    return
  }
  await firstRequest?.catch(() => undefined)
  if (chat.value !== activeChat || retryHandoffToken.value !== null) {
    reasoningRevisionScheduled = false
    return
  }
  const outcomes = [...reasoningFeedbackOutcomes]
  if (outcomes.length === 0) {
    reasoningRevisionScheduled = false
    return
  }
  const request = outcomes[0]?.review.request || currentMetaRequest()
  const handoffToken = beginRetryHandoff()
  reasoningCommitBoundary = null

  try {
    const store = getActiveEditorStore()
    const replayStep = currentRunStepNumber(store)
    if (getStudyRuntime().updateUserModel) {
      const streamId = outcomes[0]?.review.streamId ?? 0
      await observeUserInitiatedFeedback(
        reasoningFeedbackBatch(`lencanvas:${streamId}:step-${replayStep}`, replayStep, outcomes)
      )
    }
    activeChat.messages = withoutDanglingToolCalls(activeChat.messages)
    continueRunSteps(store)
    noteUserRequest(request)
    lencanvasReasoningReviews.reset()
    lencanvasReasoningReviews.beginRequest(request)
    beginFeedbackReplay(replayStep)

    reasoningFeedbackOutcomes = []
    const text = renderReasoningFeedbackReport(outcomes)
    logFeedbackAnswer(
      'resumed',
      `${outcomes.length} reasoning reviews corrected; replaying step ${replayStep} without reasoning checkpoints`
    )
    logUserMessage(text)
    await trackChatRequest(
      activeChat.sendMessage({
        text,
        metadata: { internal: 'reasoning-feedback-retry' }
      })
    )
  } catch (error) {
    console.error('Reasoning feedback retry error:', error)
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    finishRetryHandoff(handoffToken)
    reasoningRevisionScheduled = false

    // A later reasoning checkpoint can be answered while this retry request is
    // still running. Its outcome stays in the queue above; start the next retry
    // as soon as the current handoff has fully released instead of dropping it.
    scheduleReasoningFeedbackRetry()
  }
}

async function handleStepFeedback(result: StepFeedbackResult): Promise<void> {
  // Durable and independent from the task-agent branch below: implicit notes
  // proceed, explicit notes retry, but both are evidence for the user model.
  if (getStudyRuntime().updateUserModel) {
    void observeFeedbackNotes(userModelFeedbackBatch(result))
  }

  if (!hasExplicitStepFeedback(result)) {
    logFeedbackStep(
      result.step,
      'proceed',
      `notes=${result.outcomes.length} implicit=${result.outcomes.length} explicit=0; releasing held tool stream`
    )
    logFeedbackAnswer('passed', `${result.outcomes.length} feedback notes implicitly accepted`)
    resumeTurn('feedback-note')
    return
  }

  const store = getActiveEditorStore()
  const wasRunning = isRunning.value || agentTurn.paused
  const request = currentMetaRequest()
  if (!wasRunning) {
    logFeedbackStep(
      result.step,
      'retry',
      'explicit feedback arrived after the run ended; no held tool stream to replace'
    )
    resumeTurn('feedback-note')
    return
  }

  const explicitOutcomes = result.outcomes.filter(
    (outcome) => outcome.resolution === 'explicit-feedback'
  )
  const feedbackItems = explicitOutcomes.reduce(
    (count, outcome) => count + outcome.feedbackItems.length,
    0
  )
  logFeedbackStep(
    result.step,
    'retry',
    `notes=${result.outcomes.length} implicit=${result.outcomes.length - explicitOutcomes.length} explicit=${explicitOutcomes.length} feedback-items=${feedbackItems}; discarding held tool stream before action`
  )

  const handoffToken = beginRetryHandoff()
  abandonTurn('feedback note retry')
  await chat.value?.stop()
  if (chat.value) chat.value.messages = withoutDanglingToolCalls(chat.value.messages)
  continueRunSteps(store)
  noteUserRequest(request)
  beginFeedbackReplay(result.step)

  const text = renderStepFeedbackReport(result, request)
  logFeedbackStep(
    result.step,
    'report',
    `reasoning-chunks=${result.reasoningChunks.length} notes=${result.outcomes.length} feedback-items=${feedbackItems} chars=${text.length}; sending retry context`
  )
  logFeedbackAnswer(
    'resumed',
    `${explicitOutcomes.length} corrected, step ${result.step} retrying without notes`
  )
  logUserMessage(text)
  const activeChat = chat.value
  if (!activeChat) {
    finishRetryHandoff(handoffToken)
    return
  }
  const retry = activeChat.sendMessage({ text, metadata: { internal: 'feedback-step-retry' } })
  void retry.then(
    () => finishRetryHandoff(handoffToken),
    () => undefined
  )
  retry.catch((error: unknown) => {
    finishRetryHandoff(handoffToken)
    console.error('Feedback retry error:', error)
    toast.error(error instanceof Error ? error.message : String(error))
  })
}

setStepFeedbackHandler(handleStepFeedback)

async function handleCopyDebug() {
  await copyChatLog(messages.value)
  debugCopied.value = true
}

async function handleCopyAcpLog() {
  const text = getAcpDebugText()
  if (!text) return
  await navigator.clipboard.writeText(text)
  acpLogCopied.value = true
}

function handleClearChat() {
  stopAskUser()
  reasoningRevisionScheduled = false
  reasoningFeedbackOutcomes = []
  reasoningCommitBoundary = null
  lencanvasReasoningReviews.reset()
  lencanvasHandsOffAnnotations.reset()
  chat.value = null
  resetChat()
  clearToolLogEntries()
  clearAcpDebugLog()
  queuedBubbles.value = []
}
</script>

<template>
  <div data-test-id="chat-panel" class="flex min-w-0 flex-1 flex-col overflow-hidden select-text">
    <ProviderSetup v-if="!isConfigured" />

    <template v-else>
      <!-- Agent loop step — pinned above the scrollable messages -->
      <div
        v-if="showStepBar"
        data-test-id="chat-step-bar"
        class="flex shrink-0 items-center border-b border-border px-3 py-1.5"
      >
        <span class="shrink-0 text-[10px] tabular-nums text-muted"> Step {{ currentStep }} </span>
      </div>

      <ScrollAreaRoot class="min-h-0 flex-1">
        <ScrollAreaViewport class="h-full px-3 py-3 [&>div]:h-full">
          <!-- Empty state -->
          <div
            v-if="messages.length === 0"
            data-test-id="chat-empty-state"
            class="flex h-full flex-col items-center justify-center gap-3 text-muted"
          >
            <icon-lucide-message-circle class="size-8 opacity-50" />
            <p class="text-center text-xs">{{ dialogs.describeCreateOrChange }}</p>
          </div>

          <!-- Messages -->
          <div v-else data-test-id="chat-messages" class="flex flex-col gap-3">
            <template v-for="item in timelineMessages" :key="item.key">
              <template v-if="item.kind === 'insertion'">
                <ReasoningReviewCard
                  v-if="item.value.type === 'reasoning-review'"
                  compact
                  :review="item.value.review"
                  @continue="lencanvasReasoningReviews.continueReview($event)"
                  @feedback="handleReasoningFeedback"
                />
                <HandsOffReasoningAnnotationCard
                  v-else
                  :card="item.value.card"
                  :annotations="handsOffAnnotationsForCard(item.value.card)"
                  :collapsed="isHandsOffCardCollapsed(item.value.card)"
                  @annotate="handleHandsOffAnnotate"
                  @done="lencanvasHandsOffAnnotations.completeReasoningAnnotation($event)"
                />
              </template>
              <ChatMessage v-else :message="item.message" :variant="item.variant" />
            </template>

            <ReasoningReviewCard
              v-for="review in unanchoredReasoningReviews"
              :key="review.id"
              compact
              :review="review"
              @continue="lencanvasReasoningReviews.continueReview($event)"
              @feedback="handleReasoningFeedback"
            />

            <HandsOffReasoningAnnotationCard
              v-for="card in unanchoredHandsOffCards"
              :key="card.id"
              :card="card"
              :annotations="handsOffAnnotationsForCard(card)"
              :collapsed="isHandsOffCardCollapsed(card)"
              @annotate="handleHandsOffAnnotate"
              @done="lencanvasHandsOffAnnotations.completeReasoningAnnotation($event)"
            />

            <HandsOffStepActionAnnotationCard
              v-if="pendingHandsOffStepAction"
              :pending-step-action="pendingHandsOffStepAction"
              @submit="lencanvasHandsOffAnnotations.submitStepActionAnnotation($event)"
            />

            <!-- Persistent run activity, including background Meta Agent review. -->
            <div
              v-if="activityText"
              data-test-id="chat-activity-indicator"
              class="flex items-center gap-2 py-1"
            >
              <div
                class="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"
              >
                <icon-lucide-sparkles class="size-3.5" />
              </div>
              <div class="flex items-center gap-1.5 text-xs text-muted">
                <icon-lucide-loader-circle
                  v-if="activityIsProcessing"
                  class="size-3.5 animate-spin text-accent"
                />
                <icon-lucide-pause v-else class="size-3.5" />
                <span>{{ activityText }}</span>
              </div>
            </div>

            <!-- Continue button when step limit reached -->
            <div v-if="showContinue" class="flex justify-center py-2">
              <button
                class="flex items-center gap-1.5 rounded-full bg-accent/10 px-4 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
                @click="handleSubmit('Continue where you left off')"
              >
                <icon-lucide-play class="size-3" />
                Continue
              </button>
            </div>

            <div ref="messagesEnd" />
          </div>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar orientation="vertical" class="flex w-1.5 touch-none p-px select-none">
          <ScrollAreaThumb class="relative flex-1 rounded-full bg-muted/30" />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>

      <!-- Chat toolbar -->
      <div
        v-if="messages.length > 0"
        class="flex shrink-0 items-center gap-1 border-t border-border px-3 py-1"
      >
        <AppTextButton
          v-if="IS_DEV"
          :ui="{ base: 'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover' }"
          @click="handleCopyDebug"
        >
          <icon-lucide-clipboard-copy v-if="!debugCopied" class="size-3" />
          <icon-lucide-check v-else class="size-3 text-green-400" />
          {{ debugCopied ? 'Copied' : 'Copy log' }}
        </AppTextButton>
        <AppTextButton
          v-if="IS_DEV && hasAcpDebugEntries()"
          :ui="{ base: 'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover' }"
          @click="handleCopyAcpLog"
        >
          <icon-lucide-bug v-if="!acpLogCopied" class="size-3" />
          <icon-lucide-check v-else class="size-3 text-green-400" />
          {{ acpLogCopied ? 'Copied' : 'ACP log' }}
        </AppTextButton>
        <AppTextButton
          :ui="{ base: 'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover' }"
          @click="handleClearChat"
        >
          <icon-lucide-trash-2 class="size-3" />
          Clear
        </AppTextButton>
      </div>

      <AskUserCard
        v-if="askUserQuestion"
        compact
        :question="askUserQuestion"
        @answer="handleAskUserAnswer"
        @stop="handleStop"
      />
      <ChatInput v-else :status="status" @submit="handleSubmit" @stop="handleStop" />

      <AcpPermissionDialog />
    </template>
  </div>
</template>
