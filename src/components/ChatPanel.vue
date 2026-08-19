<script setup lang="ts">
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui'
import { refAutoReset } from '@vueuse/core'
import { computed, markRaw, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { getAcpDebugText, clearAcpDebugLog, hasAcpDebugEntries } from '@/app/ai/acp/transport'
import { hideAgentCursor, showAgentCursor } from '@/app/ai/chat/agent-cursor'
import { logMarkAnswer, logUserMessage } from '@/app/ai/chat/agent-log'
import { abandonTurn, forgetAbandonedTurn, setTurnRunning } from '@/app/ai/chat/agent-turn'
import {
  clearMarks,
  releaseAnswerHold,
  setMarkResumeHandler,
  takeAnswers
} from '@/app/ai/chat/mismatch'
import { enqueueUserMessage } from '@/app/ai/chat/user-messages'
import { copyChatLog } from '@/app/ai/debug'
import {
  MAX_AGENT_STEPS,
  clearToolLogEntries,
  continueRunSteps,
  currentRunSteps,
  didHitStepLimit
} from '@/app/ai/tools'
import {
  currentMetaInput,
  currentMetaRequest,
  marksAwaitingAnswer,
  noteSettledMarks
} from '@/app/meta-agent/use'
import {
  buildMarkReport,
  feedbackNotes,
  hasContent,
  pendingActionsFromParts,
  renderReportForAgent,
  takeUnreportedMarks,
  withoutDanglingToolCalls
} from '@/app/meta-agent/report'
import { observeMarkNotes } from '@/app/user-model/use'
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
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

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
const status = computed(() => chat.value?.status ?? 'ready')
const isRunning = computed(() => status.value === 'streaming' || status.value === 'submitted')

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
const isThinking = computed(() => {
  const s = status.value
  if (s !== 'submitted' && s !== 'streaming') return false
  if (messages.value.length === 0) return true
  const last = messages.value[messages.value.length - 1]
  if (last.role !== 'assistant') return true
  const parts = last.parts
  if (parts.length === 0) return true
  const lastPart = parts[parts.length - 1] as JsonObject
  if (lastPart.type === 'step-start') return true
  if ('toolCallId' in lastPart && lastPart.state === 'output-available') return true
  if ('toolCallId' in lastPart && lastPart.state === 'output-error') return true
  return s === 'submitted'
})

// Counted off the run rather than off the last assistant message. A build
// restarted after marker feedback writes a second assistant message, so
// counting `step-start` parts there would send the bar back to zero half way
// through — the restart is an implementation detail and must not show.
const currentStep = computed(() => currentRunSteps())

const showStepBar = computed(() => isRunning.value)

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
    setTurnRunning(running)
    if (running) return
    reportPassedMarks()
    // A mark says the agent is about to do something. Once it has stopped that
    // is no longer true, and a warning left standing over a finished canvas
    // reads as a defect in the result rather than a chance to catch one.
    clearMarks(getActiveEditorStore())
  },
  { immediate: true }
)

onMounted(() => showAgentCursor(getActiveEditorStore()))
onUnmounted(() => hideAgentCursor(getActiveEditorStore()))

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
  // A turn abandoned and never replaced would otherwise still be marked as
  // thrown away, and this one would die on its first chunk.
  forgetAbandonedTurn()
  chat.value?.sendMessage({ text }).catch((e: unknown) => {
    console.error('Chat error:', e)
    toast.error(e instanceof Error ? e.message : String(e))
  })
}

// Abandon first so a tool call parked at a hold point cannot resume after stop.
function handleStop() {
  abandonTurn()
  void chat.value?.stop()
  releaseAnswerHold()
}

// Study participants review every mark; untouched marks are deliberate agreement.
function reportPassedMarks() {
  const report = buildMarkReport(takeUnreportedMarks(marksAwaitingAnswer()), [])
  if (!hasContent(report)) return
  logMarkAnswer('passed', `${report.agreed.length} left alone`)
  void observeMarkNotes(feedbackNotes(report))
}

// Restart the interrupted step with its reasoning, pending actions, and feedback.
async function handleMarkResume() {
  const store = getActiveEditorStore()
  const wasRunning = isRunning.value
  const request = currentMetaRequest()
  const step = currentRunSteps(store)
  const report = buildMarkReport(takeUnreportedMarks(marksAwaitingAnswer()), takeAnswers(store))
  const metaInput = currentMetaInput()
  const interrupted = {
    reasoning: metaInput?.reasoning ?? '',
    pendingActions: pendingActionsFromParts(messages.value.at(-1)?.parts ?? [])
  }

  // A held tool call must be abandoned before the hold is released.
  if (wasRunning && hasContent(report)) {
    abandonTurn()
    await chat.value?.stop()
  }
  releaseAnswerHold()

  if (!hasContent(report)) return
  logMarkAnswer('resumed', `${report.answered.length} answered, ${report.agreed.length} passed`)

  // User-model revision is durable but should not delay the canvas.
  void observeMarkNotes(feedbackNotes(report))

  if (!wasRunning) return

  // Prevent the replacement turn from raising the answered note again.
  noteSettledMarks(report.answered.map((a) => ({ note: a.note, reply: a.text })))

  await chat.value?.stop()
  // Providers reject transcripts containing an unfinished tool call.
  if (chat.value) chat.value.messages = withoutDanglingToolCalls(chat.value.messages)
  continueRunSteps(store)
  noteUserRequest(request)
  forgetAbandonedTurn()
  const text = renderReportForAgent(report, step, request, interrupted)
  logUserMessage(text)
  chat.value?.sendMessage({ text }).catch((e: unknown) => {
    console.error('Chat error:', e)
    toast.error(e instanceof Error ? e.message : String(e))
  })
}

setMarkResumeHandler(() => {
  void handleMarkResume()
})

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
      <!-- Agent loop progress — pinned above the scrollable messages -->
      <div
        v-if="showStepBar"
        data-test-id="chat-step-bar"
        class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5"
      >
        <span class="shrink-0 text-[10px] tabular-nums text-muted">
          Step {{ currentStep }} / {{ MAX_AGENT_STEPS }}
        </span>
        <div class="h-1 flex-1 overflow-hidden rounded-full bg-hover">
          <div
            class="h-full rounded-full bg-accent transition-[width] duration-300"
            :style="{ width: `${Math.min(100, (currentStep / MAX_AGENT_STEPS) * 100)}%` }"
          />
        </div>
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
            <ChatMessage v-for="msg in messages" :key="msg.id" :message="msg" />

            <!-- Mid-run messages the user queued while the agent is working -->
            <ChatMessage v-for="msg in queuedMessages" :key="msg.id" :message="msg" />

            <!-- Thinking indicator: shown when AI is working but no visible activity -->
            <div v-if="isThinking" data-test-id="chat-typing-indicator" class="flex gap-2">
              <div
                class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted/20 text-[10px] font-bold text-muted"
              >
                AI
              </div>
              <div class="flex items-center gap-1 py-2">
                <span
                  class="size-1.5 animate-bounce rounded-full bg-muted"
                  style="animation-delay: 0ms"
                />
                <span
                  class="size-1.5 animate-bounce rounded-full bg-muted"
                  style="animation-delay: 150ms"
                />
                <span
                  class="size-1.5 animate-bounce rounded-full bg-muted"
                  style="animation-delay: 300ms"
                />
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
