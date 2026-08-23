<script setup lang="ts">
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui'
import { refAutoReset } from '@vueuse/core'
import { computed, markRaw, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { getAcpDebugText, clearAcpDebugLog, hasAcpDebugEntries } from '@/app/ai/acp/transport'
import { hideAgentCursor, showAgentCursor } from '@/app/ai/chat/agent-cursor'
import { agentActivity } from '@/app/ai/chat/agent-activity'
import { logMarkAnswer, logUserMessage } from '@/app/ai/chat/agent-log'
import {
  abandonTurn,
  agentTurn,
  forgetAbandonedTurn,
  setTurnRunning
} from '@/app/ai/chat/agent-turn'
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
import { currentMetaRequest, marksAwaitingAnswer, noteSettledMarks } from '@/app/meta-agent/use'
import {
  buildMarkReport,
  feedbackNotes,
  hasContent,
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
// Counted off the run rather than off the last assistant message. A build
// restarted after marker feedback writes a second assistant message, so
// counting `step-start` parts there would send the bar back to zero half way
// through — the restart is an implementation detail and must not show.
const currentStep = computed(() => currentRunSteps())

const activityText = computed(() => {
  if (agentActivity.metaAgentTasks > 0) return 'Reviewing the current decision…'
  if (!isRunning.value) return null
  if (agentTurn.paused) return 'Waiting for your feedback…'
  if (currentStep.value === 0) return 'Starting the task…'
  return `Working on step ${currentStep.value}…`
})

const activityIsProcessing = computed(
  () => agentActivity.metaAgentTasks > 0 || (isRunning.value && !agentTurn.paused)
)

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

/**
 * Stop, from the button.
 *
 * `abandonTurn` first, for the same reason the marker resume needs it: aborting
 * the request does not reach a step parked at a hold point, and marks now hold
 * the run on their own, so pressing stop while one is up did nothing visible —
 * the held tool call went through as soon as the hold lifted. Also lets go of
 * every hold, so a run stopped mid-hold cannot leave the app paused forever.
 */
function handleStop() {
  abandonTurn('stop button')
  void chat.value?.stop()
  releaseAnswerHold()
}

/**
 * The run is over and nobody said anything about the marks still on screen.
 *
 * Leaving a mark alone is agreement, and agreement is evidence about this person
 * — the cheapest evidence there is, since it costs them no gesture. But until
 * the run stops there is no telling "they let it stand" apart from "they have
 * not got to it yet", so the silence is only final here. Answered marks have
 * already gone with the resume and do not come again.
 */
function reportPassedMarks() {
  const report = buildMarkReport(takeUnreportedMarks(marksAwaitingAnswer()), [])
  if (!hasContent(report)) return
  logMarkAnswer('passed', `${report.agreed.length} left alone`)
  void observeMarkNotes(feedbackNotes(report))
}

/**
 * They answered some markers, went quiet, and pressed continue.
 *
 * The step they interrupted is abandoned and done again. There is no way to
 * rewind one step inside a run — the steps live inside a single streaming call
 * — so this stops the turn and starts a new one whose first message says what
 * happened. To the person it is the same build carrying on, which is why the
 * step budget carries over and the original request is kept.
 */
async function handleMarkResume() {
  const store = getActiveEditorStore()
  const wasRunning = isRunning.value
  const request = currentMetaRequest()
  const step = currentRunSteps(store)
  const report = buildMarkReport(takeUnreportedMarks(marksAwaitingAnswer()), takeAnswers(store))

  // `abandonTurn` before the stop, not after. Aborting the request does not
  // reach the held tool call — that is sitting in the stream transform waiting
  // for the hold to lift, and lifting it is what sends it through. This says the
  // turn is being thrown away, so the transform drops it instead.
  if (wasRunning && hasContent(report)) {
    abandonTurn('marker feedback restart')
    await chat.value?.stop()
  }
  releaseAnswerHold()

  if (!hasContent(report)) return
  logMarkAnswer('resumed', `${report.answered.length} answered, ${report.agreed.length} passed`)

  // First, and not awaited. This is the durable half — what they said is worth
  // keeping whatever happens to the run — and the revision is two model calls,
  // which is far too long to make them watch before the canvas moves again.
  void observeMarkNotes(feedbackNotes(report))

  // Answered after the run had already finished: the user model still wants it,
  // but there is no step to redo and nothing to restart.
  if (!wasRunning) return

  // So the redone step is not marked all over again for the thing they just
  // answered. Outlives the turn boundary the restart crosses.
  noteSettledMarks(report.answered.map((a) => ({ note: a.note, reply: a.text })))

  await chat.value?.stop()
  // Before anything is sent. The abort above cut a tool call in half, and the
  // provider refuses a transcript that carries one.
  if (chat.value) chat.value.messages = withoutDanglingToolCalls(chat.value.messages)
  continueRunSteps(store)
  // Kept, so the meta-agent judges the next steps against what they actually
  // asked for rather than against the note about being interrupted.
  noteUserRequest(request)
  // The replacement turn is about to go out, so the abandoned one is over.
  // Explicitly, not via the running-state watch: `stop()` above returned on the
  // abort signal, not on the run winding down, so `status` can still say
  // 'streaming' here and the watch never fires between the two turns.
  forgetAbandonedTurn()
  const text = renderReportForAgent(report, step, request)
  // `prepareStep` only logs messages sent mid-run, and this one arrives as the
  // opening message of the restarted turn — so without this the one thing the
  // agent is told about the interruption never appears on the timeline.
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
