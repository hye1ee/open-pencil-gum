import { Chat } from '@ai-sdk/vue'
import { DirectChatTransport, stepCountIs, ToolLoopAgent } from 'ai'
import type { ChatTransport, ModelMessage, UIMessage, UserContent } from 'ai'
import type { ComputedRef, Ref } from 'vue'

import { ACP_AGENTS } from '@open-pencil/core/constants'
import type { ACPAgentID, AIProviderID } from '@open-pencil/core/constants'

import { showAgentCursor } from '@/app/ai/chat/agent-cursor'
import { createCanvasVision } from '@/app/ai/chat/canvas-vision'
import { createInterventionTracker } from '@/app/ai/chat/intervention'
import { buildUserMessageText, clearUserMessages, drainUserMessages } from '@/app/ai/chat/user-messages'
import { createLanguageModel, resolveLanguageModelID } from '@/app/ai/chat/model'
import RENDER_SYSTEM_PROMPT from '@/app/ai/chat/system-prompt.md?raw'
import ELEMENTS_SYSTEM_PROMPT from '@/app/ai/chat/system-prompt-elements.md?raw'
import { MAX_AGENT_STEPS, createAITools, recordStepUsage, resetRunSteps } from '@/app/ai/tools'
import type { getActiveEditorStore } from '@/app/editor/active-store'

type EditorStore = ReturnType<typeof getActiveEditorStore>

// Mirrors the RENDER flag in packages/core/src/tools/registry-core.ts — keep in sync.
const SYSTEM_PROMPT = import.meta.env.VITE_RENDER !== 'false' ? RENDER_SYSTEM_PROMPT : ELEMENTS_SYSTEM_PROMPT

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

  const agent = new ToolLoopAgent({
    model: createLanguageModel({
      providerID,
      apiKey,
      modelID,
      customModelID,
      customBaseURL,
      customAPIType
    }),
    instructions: SYSTEM_PROMPT,
    tools,
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    maxOutputTokens,
    providerOptions: cacheProviderOptions,
    prepareCall: (options) => {
      resetRunSteps(store)
      intervention.reset()
      vision.reset()
      clearUserMessages(store)
      showAgentCursor(store)
      return {
        ...options,
        maxOutputTokens,
        providerOptions: cacheProviderOptions
      }
    },
    prepareStep: async ({ messages }) => {
      // Drain any user edits made since the last step (also paces the build).
      const diff = await intervention.prepareStep()
      // Messages the user sent mid-run, and the canvas PNG for overall layout.
      const userMessages = drainUserMessages(store)
      const image = await vision.imagePart()
      if (!diff && !image && userMessages.length === 0) return undefined

      const content: UserContent = []
      if (image) {
        content.push({
          type: 'text',
          text: 'Current canvas (overview only — read exact values/ids with the tools):'
        })
        content.push(image)
      }
      if (diff) content.push({ type: 'text', text: diff })
      if (userMessages.length > 0) {
        content.push({ type: 'text', text: buildUserMessageText(userMessages) })
      }

      const injected: ModelMessage = { role: 'user', content }
      return { messages: [...messages, injected] }
    },
    onStepFinish: (step) => {
      intervention.onStepFinish()
      const { usage } = step
      recordStepUsage(
        {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
          cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
          timestamp: Date.now()
        },
        store
      )
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
