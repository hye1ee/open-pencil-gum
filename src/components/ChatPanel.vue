<script setup lang="ts">
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui'
import { refAutoReset } from '@vueuse/core'
import { computed, markRaw, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { getAcpDebugText, clearAcpDebugLog, hasAcpDebugEntries } from '@/app/ai/acp/transport'
import { hideAgentCursor, showAgentCursor } from '@/app/ai/chat/agent-cursor'
import { agentActivity } from '@/app/ai/chat/agent-activity'
import { logFeedbackAnswer, logFeedbackStep, logUserMessage } from '@/app/ai/chat/agent-log'
import { abandonTurn, agentTurn, resumeTurn, setTurnRunning } from '@/app/ai/chat/agent-turn'
import { enqueueUserMessage } from '@/app/ai/chat/user-messages'
import { withoutDanglingToolCalls } from '@/app/ai/chat/transcript'
import { copyChatLog } from '@/app/ai/debug'
import { renderStepFeedbackReport } from '@/app/feedback-note/report'
import { userModelFeedbackBatch } from '@/app/feedback-note/user-model'
import {
  beginFeedbackReplay,
  hasExplicitStepFeedback,
  setStepFeedbackHandler,
  type StepFeedbackResult
} from '@/app/feedback-note/session'
import {
  clearToolLogEntries,
  continueRunSteps,
  currentRunStepNumber,
  didHitStepLimit
} from '@/app/ai/tools'
import { currentMetaRequest } from '@/app/meta-agent/use'
import { observeFeedbackNotes } from '@/app/user-model/use'
import { getActiveEditorStore } from '@/app/editor/active-store'
import { activeTab } from '@/app/tabs'
import AcpPermissionDialog from '@/components/chat/AcpPermissionDialog.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import ChatMessage from '@/components/chat/ChatMessage.vue'
import AppTextButton from '@/components/ui/AppTextButton.vue'
import ProviderSetup from '@/components/chat/ProviderSetup.vue'
import { useAIChat } from '@/app/ai/chat/use'
import { toast } from '@/app/shell/ui'
import { useI18n } from '@open-pencil/vue'

import type { Chat } from '@ai-sdk/vue'
import type { UIMessage } from 'ai'

const IS_DEV = import.meta.env.DEV

const { isConfigured, ensureChat, noteUserRequest, resetChat } = useAIChat()
const { dialogs } = useI18n()

const chat = ref<Chat<UIMessage> | null>(null)

ensureChat().then((c) => {
  if (c) chat.value = markRaw(c)
})
const messagesEnd = ref<HTMLDivElement>()
const debugCopied = refAutoReset(false, 1500)
const acpLogCopied = refAutoReset(false, 1500)

const messages = computed(() => chat.value?.messages ?? [])
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
const logicallyRunning = computed(
  () => isRunning.value || retryHandoffToken.value !== null || agentTurn.paused
)

// Messages the user typed while a run was in progress. They're injected into the
// running loop (not the persisted history), so we echo them here optimistically.
const queuedBubbles = ref<string[]>([])
const queuedMessages = computed<UIMessage[]>(() =>
  queuedBubbles.value.map((text, i) => ({
    id: `queued-${i}`,
    role: 'user',
    parts: [{ type: 'text', text }]
  }))
)
// Counted off the run rather than off the last assistant message. A build
// restarted after Feedback Note input writes a second assistant message, so
// the retry remains an implementation detail and does not reset the visible step.
const currentStep = computed(() => currentRunStepNumber())

const activityText = computed(() => {
  if (agentActivity.metaAgentTasks > 0) return "Reviewing the current agent's reasoning…"
  if (!logicallyRunning.value) return null
  if (agentTurn.paused) return 'Waiting for your feedback…'
  if (currentStep.value === 0) return 'Starting the task…'
  return `Working on step ${currentStep.value}…`
})

const activityIsProcessing = computed(
  () => agentActivity.metaAgentTasks > 0 || (logicallyRunning.value && !agentTurn.paused)
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
})

async function handleSubmit(text: string) {
  // Mid-run: route to the intervention queue instead of a new chat turn, and
  // echo the bubble so the user sees what they sent. The agent picks it up at
  // its next step boundary and adapts its remaining tool calls.
  if (isRunning.value) {
    enqueueUserMessage(getActiveEditorStore(), text)
    queuedBubbles.value = [...queuedBubbles.value, text]
    return
  }

  queuedBubbles.value = []
  try {
    const c = await ensureChat()
    if (c) chat.value = markRaw(c)
  } catch (e) {
    console.error('Failed to initialize chat:', e)
    toast.error(e instanceof Error ? e.message : String(e))
    return
  }
  noteUserRequest(text)
  chat.value?.sendMessage({ text }).catch((e: unknown) => {
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
  abandonTurn('stop button')
  void chat.value?.stop()
}

async function handleStepFeedback(result: StepFeedbackResult): Promise<void> {
  // Durable and independent from the task-agent branch below: implicit notes
  // proceed, explicit notes retry, but both are evidence for the user model.
  void observeFeedbackNotes(userModelFeedbackBatch(result))

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
            <ChatMessage v-for="msg in visibleMessages" :key="msg.id" :message="msg" />

            <!-- Mid-run messages the user queued while the agent is working -->
            <ChatMessage v-for="msg in queuedMessages" :key="msg.id" :message="msg" />

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

      <ChatInput :status="status" @submit="handleSubmit" @stop="handleStop" />

      <AcpPermissionDialog />
    </template>
  </div>
</template>
