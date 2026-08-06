import { Chat } from '@ai-sdk/vue'
import { DirectChatTransport, stepCountIs, ToolLoopAgent } from 'ai'
import type { ChatTransport, ImagePart, ModelMessage, UIMessage, UserContent } from 'ai'
import type { ComputedRef, Ref } from 'vue'

import { ACP_AGENTS } from '@open-pencil/core/constants'
import type { ACPAgentID, AIProviderID } from '@open-pencil/core/constants'

import { agentAttention, buildAttentionText, clearAttention } from '@/app/ai/chat/agent-attention'
import { showAgentCursor } from '@/app/ai/chat/agent-cursor'
import {
  logAttention,
  logIntervention,
  logPlan,
  logRunEnd,
  logRunStart,
  logStep,
  logUsage,
  logUserMessage
} from '@/app/ai/chat/agent-log'
import { clearAgentSpeech } from '@/app/ai/chat/agent-speech'
import { awaitTurnResume, resumeTurn } from '@/app/ai/chat/agent-turn'
import { createCanvasVision } from '@/app/ai/chat/canvas-vision'
import { createInterventionTracker } from '@/app/ai/chat/intervention'
import { createLanguageModel, resolveLanguageModelID } from '@/app/ai/chat/model'
import { anthropicThinkingOptions } from '@/app/ai/chat/model-trace'
import { runPlan, runPlanUpdate } from '@/app/ai/chat/plan'
import ELEMENTS_SYSTEM_PROMPT from '@/app/ai/chat/system-prompt-elements.md?raw'
import RENDER_SYSTEM_PROMPT from '@/app/ai/chat/system-prompt.md?raw'
import {
  buildUserMessageText,
  clearUserMessages,
  drainUserMessages
} from '@/app/ai/chat/user-messages'
import { MAX_AGENT_STEPS, createAITools, recordStepUsage, resetRunSteps } from '@/app/ai/tools'
import type { getActiveEditorStore } from '@/app/editor/active-store'

type EditorStore = ReturnType<typeof getActiveEditorStore>

// Mirrors the RENDER flag in packages/core/src/tools/registry-core.ts — keep in sync.
const SYSTEM_PROMPT =
  import.meta.env.VITE_RENDER !== 'false' ? RENDER_SYSTEM_PROMPT : ELEMENTS_SYSTEM_PROMPT

type ChatSessionOptions = {
  isConfigured: ComputedRef<boolean>
  isACPProvider: ComputedRef<boolean>
  providerID: Ref<AIProviderID>
  apiKey: Ref<string>
  modelID: Ref<string>
  customModelID: Ref<string>
  customBaseURL: Ref<string>
  customAPIType: Ref<'completions' | 'responses'>
  maxOutputTokens: Ref<number>
  getActiveEditorStore: () => EditorStore
}

type ToolLoopTransportOptions = {
  store: EditorStore
  providerID: AIProviderID
  apiKey: string
  modelID: string
  customModelID: string
  customBaseURL: string
  customAPIType: 'completions' | 'responses'
  maxOutputTokens: number
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
  attention: string | null
  image: ImagePart | null
  attentionImage: ImagePart | null
  diff: string | null
  userMessages: string[]
}): UserContent {
  const content: UserContent = []
  // First, so it is never buried under the image or a long intervention block.
  if (args.plan) content.push({ type: 'text', text: `[Plan] ${args.plan}` })
  // Directly under the directive: both are short standing context the agent has
  // to reconcile before it decides what to do this step.
  if (args.attention) content.push({ type: 'text', text: args.attention })
  if (args.image) {
    content.push({
      type: 'text',
      text: 'Whole canvas (composition only — too small to read text or judge exact colour):'
    })
    content.push(args.image)
  }
  // After the overview, so the pair reads as "here is everything, now here is
  // the part you said you were working on".
  //
  // The wording matters more than it looks. An earlier version called this "the
  // reliable one for spacing, alignment and colour"; the agent had put a card it
  // was copying from into its attention, so every step it received a big sharp
  // picture of someone else's work labelled "judge by this" — and spent nine
  // steps reviewing the reference instead of building.
  if (args.attentionImage) {
    content.push({
      type: 'text',
      text: 'Close-up of your current `working` set, with surrounding canvas for context. Use it for detail the overview above cannot carry — exact spacing, alignment, colour. It does not replace the overview: keep judging how this sits in the whole page from that. It shows whatever you last put in `working`, so if that is stale, move the attention. Node ids come from the tools, not from here:'
    })
    content.push(args.attentionImage)
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
  providerID,
  apiKey,
  modelID,
  customModelID,
  customBaseURL,
  customAPIType,
  maxOutputTokens
}: ToolLoopTransportOptions) {
  const tools = createAITools(store)
  const intervention = createInterventionTracker(store)
  const vision = createCanvasVision(store)
  const effectiveModelID = resolveLanguageModelID({ providerID, modelID, customModelID })
  const cacheProviderOptions = supportsAnthropicCaching(providerID, effectiveModelID)
    ? ANTHROPIC_CACHE_CONTROL
    : undefined
  // Call-level options. Thinking has to go here rather than on a message —
  // it configures the request, not a block within it — and only the first-party
  // provider is known to accept the adaptive form.
  const callProviderOptions =
    providerID === 'anthropic' && anthropicThinkingOptions
      ? { anthropic: { ...ANTHROPIC_CACHE_CONTROL.anthropic, ...anthropicThinkingOptions } }
      : cacheProviderOptions

  // Hoisted so the planning calls run against the same model as the agent.
  const model = createLanguageModel({
    providerID,
    apiKey,
    modelID,
    customModelID,
    customBaseURL,
    customAPIType
  })

  // This run's design directive. Owned here rather than written by the agent
  // into its own transcript, so it can be re-injected every step.
  let plan: string | null = null

  const agent = new ToolLoopAgent({
    model,
    instructions: SYSTEM_PROMPT,
    tools,
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    maxOutputTokens,
    providerOptions: callProviderOptions,
    prepareCall: (options) => {
      // First, so the log reset it performs can't wipe lines written below it.
      const sent = (options as { messages?: readonly ModelMessage[] }).messages ?? []
      logRunStart(lastUserText(sent))
      resetRunSteps(store)
      intervention.reset()
      vision.reset()
      clearUserMessages(store)
      plan = null
      resumeTurn()
      clearAgentSpeech()
      clearAttention(store)
      showAgentCursor(store)
      return {
        ...options,
        maxOutputTokens,
        providerOptions: callProviderOptions
      }
    },
    prepareStep: async ({ messages, stepNumber }) => {
      // Block here while the user has paused the turn (grabbed the agent cursor).
      await awaitTurnResume()
      // Drain any user edits made since the last step (also paces the build).
      const diff = await intervention.prepareStep()
      // Messages the user sent mid-run, and the canvas PNG for overall layout.
      const userMessages = drainUserMessages(store)
      const image = await vision.imagePart()

      // Drains the user's add/remove edits, so it must be built once per step.
      // Also prunes dead ids, so the capture below never chases a deleted node.
      const attention = buildAttentionText(store)
      const attentionImage = await vision.attentionPart(agentAttention.working)

      if (diff) logIntervention(diff)
      for (const text of userMessages) logUserMessage(text)
      if (attention) logAttention(attention)

      if (stepNumber === 0) {
        plan = await runPlan(model, store, lastUserText(messages), image)
        logPlan(plan)
      } else if (plan && (diff || userMessages.length > 0)) {
        // Only on an intervention. The agent runs for twenty-odd steps, so
        // reconciling the directive every step would cost more than the build.
        const change = [diff, ...userMessages].filter(Boolean).join('\n')
        plan = await runPlanUpdate(model, store, plan, change)
        logPlan(plan, true)
      }

      logStep(
        stepNumber,
        [
          image ? '[image]' : '',
          diff ? '[user-edit]' : '',
          userMessages.length > 0 ? `[user-msg ×${userMessages.length}]` : '',
          plan ? '[plan]' : '',
          attention ? '[attention]' : '',
          attentionImage ? '[attention-image]' : ''
        ].filter(Boolean)
      )

      const history = withCacheBreakpoint(messages, cacheProviderOptions)
      const content = buildStepContent({
        plan,
        attention,
        image,
        attentionImage,
        diff,
        userMessages
      })
      if (content.length === 0) return { messages: history }

      const injected: ModelMessage = { role: 'user', content }
      return { messages: [...history, injected] }
    },
    onStepFinish: (step) => {
      intervention.onStepFinish()
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
      recordStepUsage(recorded, store)
    },
    onFinish: ({ finishReason, steps }) => {
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
  apiKey,
  modelID,
  customModelID,
  customBaseURL,
  customAPIType,
  maxOutputTokens,
  getActiveEditorStore
}: ChatSessionOptions) {
  let transportDirty = false
  let currentChatStore: EditorStore | null = null
  let currentChatMessages = new WeakMap<EditorStore, UIMessage[]>()
  let chat: Chat<UIMessage> | null = null
  let acpTransportInstance: { destroy(): Promise<void> } | null = null
  let overrideTransport: (() => ChatTransport<UIMessage>) | null = null

  function markTransportDirty() {
    transportDirty = true
    currentChatStore = null
    currentChatMessages = new WeakMap()
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
      providerID: providerID.value,
      apiKey: apiKey.value,
      modelID: modelID.value,
      customModelID: customModelID.value,
      customBaseURL: customBaseURL.value,
      customAPIType: customAPIType.value,
      maxOutputTokens: maxOutputTokens.value
    })
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
    if (currentChatStore) currentChatMessages.delete(currentChatStore)
    chat = null
    currentChatStore = null
    transportDirty = false
  }

  function setOverrideTransport(factory: (() => ChatTransport<UIMessage>) | null) {
    overrideTransport = factory
    markTransportDirty()
  }

  return { ensureChat, resetChat, markTransportDirty, setOverrideTransport }
}
