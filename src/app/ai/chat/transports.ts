import { Chat } from '@ai-sdk/vue'
import { DirectChatTransport, ToolLoopAgent } from 'ai'
import type { ChatTransport, ImagePart, ModelMessage, UIMessage, UserContent } from 'ai'
import { shallowRef } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { ACP_AGENTS } from '@open-pencil/core/constants'
import type { ACPAgentID, AIProviderID } from '@open-pencil/core/constants'

import { showAgentCursor } from '@/app/ai/chat/agent-cursor'
import {
  logIntervention,
  logAskUserLifecycle,
  logFeedbackReplay,
  logModelRouting,
  logPlan,
  logRunContinue,
  logRunEnd,
  logRunStart,
  logStudyRuntime,
  logStep,
  logTurnAbandoned,
  logUsage,
  logUserModelPropositions,
  logUserMessage
} from '@/app/ai/chat/agent-log'
import { awaitTurnResume, currentTurnGeneration, resumeTurn } from '@/app/ai/chat/agent-turn'
import { createCanvasVision } from '@/app/ai/chat/canvas-vision'
import { createInterventionTracker } from '@/app/ai/chat/intervention'
import { createLanguageModel, resolveLanguageModelID } from '@/app/ai/chat/model'
import { anthropicThinkingOptions, googleThinkingOptions } from '@/app/ai/chat/model-trace'
import { runPlan, runPlanUpdate } from '@/app/ai/chat/plan'
import ELEMENTS_SYSTEM_PROMPT from '@/app/ai/chat/system-prompt-elements.md?raw'
import RENDER_SYSTEM_PROMPT from '@/app/ai/chat/system-prompt.md?raw'
import {
  buildUserMessageText,
  clearUserMessages,
  drainUserMessages
} from '@/app/ai/chat/user-messages'
import { renderUserModelPropositions } from '@/app/ai/chat/user-model-propositions'
import { describeModelRouting, modelConfigForSlot } from '@/app/ai/model-routing'
import {
  MAX_AGENT_STEPS,
  createAITools,
  currentRunStepNumber,
  currentRunSteps,
  isMutatingAITool,
  isContinuingRun,
  recordAuxUsage,
  recordStepUsage,
  resetRunSteps
} from '@/app/ai/tools'
import type { getActiveEditorStore } from '@/app/editor/active-store'
import { noteAgentPlan } from '@/app/meta-agent/hosts/lencanvas/events'
import {
  completeFeedbackReplay,
  currentFeedbackReplayStep
} from '@/app/meta-agent/hosts/lencanvas/feedback-note/session'
import { runUserModel, startMetaAgentTurn } from '@/app/meta-agent/hosts/lencanvas/use'
import {
  ASK_USER_AGENT_INSTRUCTIONS,
  AskUserSession,
  LENCANVAS_ASK_USER_INSTRUCTIONS,
  createAskUserTool,
  formatAskUserLifecycleEvent
} from '@/app/study/ask-user'
import type { StudyRuntimeConfig } from '@/app/study/runtime'
import { observeAskUserAnswers } from '@/app/user-model/use'

type EditorStore = ReturnType<typeof getActiveEditorStore>

// Mirrors the RENDER flag in packages/core/src/tools/registry-core.ts — keep in sync.
const SYSTEM_PROMPT =
  import.meta.env.VITE_RENDER !== 'false' ? RENDER_SYSTEM_PROMPT : ELEMENTS_SYSTEM_PROMPT

type ChatSessionOptions = {
  isConfigured: ComputedRef<boolean>
  isACPProvider: ComputedRef<boolean>
  /** For the ACP branch only. Which model the agent calls is a slot — see `model-routing.ts`. */
  providerID: Ref<AIProviderID>
  maxOutputTokens: Ref<number>
  getActiveEditorStore: () => EditorStore
  getStudyRuntime: () => StudyRuntimeConfig
}

type ToolLoopTransportOptions = {
  store: EditorStore
  maxOutputTokens: number
  takeRequest: () => string
  studyRuntime: StudyRuntimeConfig
  askUserSession: AskUserSession
}

const ANTHROPIC_CACHE_CONTROL = {
  anthropic: { cacheControl: { type: 'ephemeral' } }
} as const

function supportsAnthropicCaching(providerID: AIProviderID, modelID: string): boolean {
  return (
    providerID === 'anthropic' ||
    providerID === 'anthropic-compatible' ||
    (providerID === 'openrouter' && modelID.startsWith('anthropic/'))
  )
}

/**
 * Call-level options. Thinking belongs here rather than on a message — it
 * configures the request, not a block within it — and every provider spells it
 * differently, so this is the one place that has to know which one it is.
 * Downstream is spared: the SDK turns both into the same `reasoning-*` chunks.
 *
 * Only the first-party providers are known to accept these forms; anyone else
 * gets caching alone, and the thinking bubble stays quiet.
 */
function thinkingCallOptions(
  providerID: AIProviderID,
  caching: typeof ANTHROPIC_CACHE_CONTROL | undefined
) {
  if (providerID === 'anthropic' && anthropicThinkingOptions) {
    return { anthropic: { ...ANTHROPIC_CACHE_CONTROL.anthropic, ...anthropicThinkingOptions } }
  }
  if (providerID === 'google' && googleThinkingOptions) {
    return { google: googleThinkingOptions }
  }
  return caching
}

/** The newest user turn — what the planning call is asked to plan for. */
function lastUserText(messages: readonly ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'user') continue
    if (typeof message.content === 'string') return message.content
    const text = message.content
      .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
    if (text) return text
  }
  return ''
}

/**
 * The user message injected before each step: the run's directive, the canvas
 * image, and anything the user changed or said since the last step. Assembled
 * here so all of it shares one message rather than accumulating separately.
 */
function buildStepContent(args: {
  plan: string | null
  image: ImagePart | null
  diff: string | null
  userMessages: string[]
}): UserContent {
  const content: UserContent = []
  // First, so it is never buried under the image or a long intervention block.
  if (args.plan) content.push({ type: 'text', text: `[Plan] ${args.plan}` })
  if (args.image) {
    content.push({
      type: 'text',
      text: 'Whole canvas (composition only — too small to read text or judge exact colour):'
    })
    content.push(args.image)
  }
  if (args.diff) content.push({ type: 'text', text: args.diff })
  if (args.userMessages.length > 0) {
    content.push({ type: 'text', text: buildUserMessageText(args.userMessages) })
  }
  return content
}

/**
 * Put Anthropic's cache breakpoint at the end of the stable transcript, just
 * before the block we inject for this step.
 *
 * The provider only reads `cacheControl` off a message or a message part
 * (`@ai-sdk/anthropic` `convertToAnthropicMessages`) — a call-level
 * `providerOptions` never reaches it. And everything before a breakpoint is what
 * gets cached, so one mark here covers the system prompt, the tool schemas and
 * the whole conversation so far.
 *
 * It has to go *before* the injected message: that block carries a fresh canvas
 * image and the latest user edits, so it differs every step and is dropped from
 * the next step's list entirely. Marking the end of the list instead cached a
 * prefix that could never recur — a measured run spent 924,613 input tokens with
 * a 0% hit rate. The mark moves forward each step, writing a longer entry and
 * reading the previous one.
 */
function withCacheBreakpoint(
  messages: readonly ModelMessage[],
  cacheOptions: ModelMessage['providerOptions']
): ModelMessage[] {
  const history = [...messages]
  const last = history.at(-1)
  if (!last || !cacheOptions) return history
  history[history.length - 1] = { ...last, providerOptions: cacheOptions }
  return history
}

export async function createACPTransport(providerID: AIProviderID) {
  const agentId = providerID.replace('acp:', '') as ACPAgentID
  const agentDef = ACP_AGENTS.find((a) => a.id === agentId)
  if (!agentDef) throw new Error(`Unknown ACP agent: ${agentId}`)

  const { ACPChatTransport } = await import('@/app/ai/acp/transport')
  const { homeDir } = await import('@tauri-apps/api/path')
  return new ACPChatTransport({ agentDef, cwd: await homeDir() })
}

export function createToolLoopTransport({
  store,
  maxOutputTokens,
  takeRequest,
  studyRuntime,
  askUserSession
}: ToolLoopTransportOptions) {
  const tools = {
    ...createAITools(store),
    ...(studyRuntime.askUserEnabled ? { ask_user: createAskUserTool(askUserSession) } : {})
  }
  const intervention = createInterventionTracker(store)
  const vision = createCanvasVision(store)
  const taskConfig = modelConfigForSlot('task')
  const effectiveModelID = resolveLanguageModelID(taskConfig)
  const cacheProviderOptions = supportsAnthropicCaching(taskConfig.providerID, effectiveModelID)
    ? ANTHROPIC_CACHE_CONTROL
    : undefined
  const callProviderOptions = thinkingCallOptions(taskConfig.providerID, cacheProviderOptions)

  const model = createLanguageModel(taskConfig)

  /**
   * The planning calls get their own slot. They summarise a request into a
   * directive rather than building anything, so they are the one place inside
   * the design agent worth pointing at a smaller model. Left unset in `.env` the
   * slot resolves the same way `task` does, which is what this used to be.
   */
  const planningModel = createLanguageModel(modelConfigForSlot('task-planning'))

  // This run's design directive. Owned here rather than written by the agent
  // into its own transcript, so it can be re-injected every step.
  let plan: string | null = null
  let askUserRequestId = ''
  let askUserRequest = ''

  const conditionInstructions = studyRuntime.askUserEnabled
    ? `${SYSTEM_PROMPT}\n\n${ASK_USER_AGENT_INSTRUCTIONS}\n\n${LENCANVAS_ASK_USER_INSTRUCTIONS}`
    : SYSTEM_PROMPT

  const agent = new ToolLoopAgent({
    model,
    instructions: conditionInstructions,
    tools,
    // Our own counter, not the SDK's: `stepCountIs` counts steps inside one
    // streaming call, and a build restarted after Feedback Note input is a second
    // call. Counting there would hand out a fresh limit every time someone
    // answered a Feedback Note, which makes the ceiling mean nothing.
    stopWhen: () => currentRunSteps(store) >= MAX_AGENT_STEPS,
    maxOutputTokens,
    providerOptions: callProviderOptions,
    prepareCall: async (options) => {
      // First, so the log reset it performs can't wipe lines written below it.
      const sent = (options as { messages?: readonly ModelMessage[] }).messages ?? []
      const submittedRequest = takeRequest() || lastUserText(sent)
      if (studyRuntime.askUserEnabled) {
        askUserRequestId = crypto.randomUUID()
        askUserRequest = submittedRequest
        askUserSession.beginRequest(askUserRequestId)
      } else askUserSession.endRequest('condition-disabled')
      // Read before `resetRunSteps`, which consumes the flag. A restart appends
      // to the log rather than truncating it: the half of the build that led to
      // the feedback is the part worth having.
      if (isContinuingRun(store)) logRunContinue(submittedRequest)
      else {
        logRunStart(submittedRequest)
        // After the start, which wipes the file. Not on a continue: the routing
        // is fixed for the transport's lifetime, and a changed setting rebuilds
        // the transport rather than changing mid-run.
        logModelRouting(describeModelRouting())
      }
      logStudyRuntime(studyRuntime.host, studyRuntime.condition)
      resetRunSteps(store)
      intervention.reset()
      vision.reset()
      clearUserMessages(store)
      plan = null
      resumeTurn()
      await startMetaAgentTurn(store, submittedRequest, studyRuntime.metaAgentEnabled)
      const userModelPropositions = renderUserModelPropositions(runUserModel())
      if (userModelPropositions) logUserModelPropositions(userModelPropositions)
      showAgentCursor(store)
      const instructions =
        studyRuntime.taskAgentUsesUserModel && userModelPropositions
          ? `${conditionInstructions}\n\n${userModelPropositions}`
          : conditionInstructions
      return {
        ...options,
        instructions,
        maxOutputTokens,
        providerOptions: callProviderOptions
      }
    },
    prepareStep: async ({ messages, stepNumber }) => {
      const turnGeneration = currentTurnGeneration()
      // Block here while the user is reviewing a Feedback Note. If the turn was thrown
      // away while held, everything below is work for a step that will never
      // run — including a planning call, which is billed.
      if (!(await awaitTurnResume('step-boundary', turnGeneration))) {
        logTurnAbandoned('step skipped at step-boundary')
        return {}
      }
      // Drain any user edits made since the last step (also paces the build).
      const diff = await intervention.prepareStep()
      // Messages the user sent mid-run, and the canvas PNG for overall layout.
      const userMessages = drainUserMessages(store)
      const image = await vision.imagePart()

      if (diff) logIntervention(diff)
      for (const text of userMessages) logUserMessage(text)

      if (stepNumber === 0) {
        plan = await runPlan(planningModel, store, lastUserText(messages), image, null)
        // The meta-agent needs it to tell a decision the agent made from one the
        // planning call made for it.
        noteAgentPlan(plan)
        logPlan(plan)
      } else if (plan && (diff || userMessages.length > 0)) {
        // Only on an intervention. The agent runs for twenty-odd steps, so
        // reconciling the directive every step would cost more than the build.
        plan = await runPlanUpdate(
          planningModel,
          store,
          plan,
          { edits: diff, messages: userMessages },
          null
        )
        noteAgentPlan(plan)
        logPlan(plan, true)
      }

      logStep(
        // Ours, not the SDK's, which counts from zero again in the second call
        // of a restarted build and would report step 8 as step 0.
        currentRunStepNumber(store),
        [
          image ? '[image]' : '',
          diff ? '[user-edit]' : '',
          userMessages.length > 0 ? `[user-msg ×${userMessages.length}]` : '',
          plan ? '[plan]' : ''
        ].filter(Boolean)
      )

      const history = withCacheBreakpoint(messages, cacheProviderOptions)
      const content = buildStepContent({
        plan,
        image,
        diff,
        userMessages
      })
      if (content.length === 0) return { messages: history }

      const injected: ModelMessage = { role: 'user', content }
      return { messages: [...history, injected] }
    },
    onStepFinish: (step) => {
      intervention.onStepFinish()
      const replayedStep = currentFeedbackReplayStep()
      const completedToolCalls = step.toolCalls.filter((call) => call !== undefined)
      const mutatingCalls = completedToolCalls.filter((call) => isMutatingAITool(call.toolName))
      if (mutatingCalls.length > 0 && step.toolResults.length > 0) {
        const completedReplayStep = completeFeedbackReplay()
        if (completedReplayStep !== null) {
          logFeedbackReplay(
            completedReplayStep,
            'completed',
            `mutation-tools=${mutatingCalls.map((call) => call.toolName).join(',')} tool-results=${step.toolResults.length}; interactive notes re-enabled for following steps`
          )
        }
      } else if (completedToolCalls.length > 0 && replayedStep !== null) {
        logFeedbackReplay(
          replayedStep,
          'waiting',
          `read-only-tools=${completedToolCalls.map((call) => call.toolName).join(',')}; same retry step and suppression remain active`
        )
      }
      // The log line and the canvas bubble are both driven from the stream tap
      // in `model-trace.ts` — doing it here would put them after the tool calls
      // they came before.
      const { usage } = step
      const recorded = {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
        timestamp: Date.now()
      }
      logUsage(recorded)
      const wasAbortedBeforeCompletion =
        step.finishReason === 'other' &&
        step.toolResults.length === 0 &&
        recorded.inputTokens === 0 &&
        recorded.outputTokens === 0 &&
        recorded.cacheReadTokens === 0 &&
        recorded.cacheWriteTokens === 0
      if (wasAbortedBeforeCompletion) {
        logTurnAbandoned('aborted zero-usage step excluded from progress count')
        return
      }
      if (replayedStep !== null && mutatingCalls.length === 0) {
        recordAuxUsage(recorded, store)
        return
      }
      recordStepUsage(recorded, store)
    },
    onFinish: ({ finishReason, steps }) => {
      const answers = askUserSession.takeAnswers()
      askUserSession.endRequest('request-finished')
      if (studyRuntime.updateUserModel && answers.length > 0) {
        void observeAskUserAnswers({
          requestId: askUserRequestId,
          request: askUserRequest,
          answers
        })
      }
      // Also flushes the buffer, so the file is complete the moment a run ends.
      logRunEnd(`${finishReason}  ${steps.length} steps`)
    }
  })

  return new DirectChatTransport({ agent }) as ChatTransport<UIMessage>
}

export function createChatSessionManager({
  isConfigured,
  isACPProvider,
  providerID,
  maxOutputTokens,
  getActiveEditorStore,
  getStudyRuntime
}: ChatSessionOptions) {
  let transportDirty = false
  let currentChatStore: EditorStore | null = null
  let currentChatMessages = new WeakMap<EditorStore, UIMessage[]>()
  let pendingRequests = new WeakMap<EditorStore, string>()
  let chat: Chat<UIMessage> | null = null
  let acpTransportInstance: { destroy(): Promise<void> } | null = null
  let overrideTransport: (() => ChatTransport<UIMessage>) | null = null
  const askUserQuestion =
    shallowRef<ReturnType<AskUserSession['snapshot']>['pendingQuestion']>(null)
  const askUserSession = new AskUserSession({
    onEvent: (event) => logAskUserLifecycle(formatAskUserLifecycleEvent(event))
  })
  askUserSession.subscribe((snapshot) => {
    askUserQuestion.value = snapshot.pendingQuestion
  })

  function markTransportDirty() {
    askUserSession.endRequest('transport-reconfigured')
    transportDirty = true
    currentChatStore = null
    currentChatMessages = new WeakMap()
    pendingRequests = new WeakMap()
  }

  async function createActiveACPTransport() {
    await acpTransportInstance?.destroy()
    const transport = await createACPTransport(providerID.value)
    acpTransportInstance = transport
    return transport as ChatTransport<UIMessage>
  }

  function createTransport(store: EditorStore) {
    if (overrideTransport) return overrideTransport()

    void acpTransportInstance?.destroy()
    acpTransportInstance = null

    return createToolLoopTransport({
      store,
      maxOutputTokens: maxOutputTokens.value,
      studyRuntime: getStudyRuntime(),
      askUserSession,
      takeRequest: () => {
        const value = pendingRequests.get(store) ?? ''
        pendingRequests.delete(store)
        return value
      }
    })
  }

  function noteUserRequest(text: string): void {
    pendingRequests.set(getActiveEditorStore(), text)
  }

  async function ensureChat(): Promise<Chat<UIMessage> | null> {
    if (!isConfigured.value) return null

    const store = getActiveEditorStore()
    if (currentChatStore && chat) {
      currentChatMessages.set(currentChatStore, chat.messages)
    }

    if (!chat || transportDirty || currentChatStore !== store) {
      const messages = currentChatMessages.get(store)
      const transport: ChatTransport<UIMessage> = isACPProvider.value
        ? await createActiveACPTransport()
        : createTransport(store)
      chat = new Chat<UIMessage>({ transport, messages })
      currentChatStore = store
      transportDirty = false
    }
    return chat
  }

  function resetChat() {
    askUserSession.endRequest('chat-reset')
    if (currentChatStore) currentChatMessages.delete(currentChatStore)
    chat = null
    currentChatStore = null
    transportDirty = false
    pendingRequests = new WeakMap()
  }

  function setOverrideTransport(factory: (() => ChatTransport<UIMessage>) | null) {
    overrideTransport = factory
    markTransportDirty()
  }

  function answerAskUser(answer: string, selectedOption: string | null = null): boolean {
    return askUserSession.answer(answer, selectedOption)
  }

  function stopAskUser(): void {
    askUserSession.endRequest('request-stopped')
  }

  return {
    ensureChat,
    resetChat,
    markTransportDirty,
    noteUserRequest,
    setOverrideTransport,
    askUserQuestion,
    answerAskUser,
    stopAskUser
  }
}
