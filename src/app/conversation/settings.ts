import { useLocalStorage } from '@vueuse/core'

import { AI_PROVIDERS } from '@open-pencil/core/constants'

import { keyStorageKey } from '@/app/ai/chat/storage'

const googleProvider = AI_PROVIDERS.find((provider) => provider.id === 'google')
const DEFAULT_CONVERSATION_MODEL = 'gemini-3.5-flash'
const environmentApiKey =
  typeof import.meta.env.VITE_API_KEY_GOOGLE === 'string'
    ? import.meta.env.VITE_API_KEY_GOOGLE.trim()
    : ''
const environmentModelSpec =
  (typeof import.meta.env.VITE_MODEL_TASK === 'string'
    ? import.meta.env.VITE_MODEL_TASK.trim()
    : '') ||
  (typeof import.meta.env.VITE_MODEL_DEFAULT === 'string'
    ? import.meta.env.VITE_MODEL_DEFAULT.trim()
    : '')
const environmentModelId = environmentModelSpec.startsWith('google:')
  ? environmentModelSpec.slice('google:'.length).trim()
  : ''

export const conversationApiKey = useLocalStorage(keyStorageKey('google'), '')
export const conversationUsesEnvironmentKey = environmentApiKey !== ''
export function conversationApiKeyValue(): string {
  return environmentApiKey || conversationApiKey.value.trim()
}
export const conversationModelId = useLocalStorage(
  'open-pencil:conversation:model',
  DEFAULT_CONVERSATION_MODEL
)
export const conversationUsesEnvironmentModel = environmentModelId !== ''
export function conversationModelIdValue(): string {
  return environmentModelId || conversationModelId.value.trim() || DEFAULT_CONVERSATION_MODEL
}
export const conversationModels = googleProvider?.models ?? []

export const CONVERSATION_TOOL_OPTIONS = [
  {
    id: 'google_search',
    name: 'Google Search',
    description: 'Search for current information on the web.'
  },
  {
    id: 'code_execution',
    name: 'Code execution',
    description: 'Run code for calculations and data processing.'
  },
  {
    id: 'url_context',
    name: 'URL context',
    description: 'Read content from links included in the conversation.'
  }
] as const

export type ConversationToolId = (typeof CONVERSATION_TOOL_OPTIONS)[number]['id']
type ConversationToolSelection = Record<ConversationToolId, boolean>

const DEFAULT_CONVERSATION_TOOL_SELECTION: ConversationToolSelection = {
  google_search: true,
  code_execution: true,
  url_context: true
}

export const conversationToolsEnabled = useLocalStorage<ConversationToolSelection>(
  'open-pencil:conversation:tools',
  DEFAULT_CONVERSATION_TOOL_SELECTION,
  { mergeDefaults: true }
)

export function conversationEnabledToolIds(): ConversationToolId[] {
  const selected = CONVERSATION_TOOL_OPTIONS.filter(
    (tool) => conversationToolsEnabled.value[tool.id]
  ).map((tool) => tool.id)
  if (selected.length > 0) return selected

  // LenChat's conditions share the same Gemini provider capabilities. Recover
  // an empty persisted selection so Ask User adds its function tool to the
  // normal provider tools instead of accidentally replacing them.
  conversationToolsEnabled.value = { ...DEFAULT_CONVERSATION_TOOL_SELECTION }
  return CONVERSATION_TOOL_OPTIONS.map((tool) => tool.id)
}
