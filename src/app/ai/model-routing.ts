import { AI_PROVIDERS } from '@open-pencil/core/constants'
import type { AIProviderID } from '@open-pencil/core/constants'

import type { ModelConfig } from '@/app/ai/chat/model'
import {
  apiKey,
  customAPIType,
  customBaseURL,
  customModelID,
  modelID,
  providerID,
  storedApiKeyFor
} from '@/app/ai/chat/storage'

/**
 * Which model each of this app's AIs calls.
 *
 * There are four of them and they want different things. The design agent wants
 * the strongest model available; the meta-agent that judges its reasoning wants
 * to be a different model entirely, since a judge sharing the subject's biases
 * agrees with it for the wrong reasons; the user model reads six screenshots
 * every thirty seconds and wants the cheapest thing that can see. Before this
 * file they all read one global provider setting, so they were always the same
 * model — the "cheapest capable model" both background callers named only ever
 * applied when the provider happened to be Anthropic.
 *
 * A slot is one of those call sites. `.env` assigns a model to each; anything
 * left unset falls back to the settings panel, so an empty `.env` behaves
 * exactly as the app did before.
 */

export type ModelSlot =
  | 'task'
  | 'task-planning'
  | 'user-model-propose'
  | 'user-model-revise'
  | 'feedback'
  | 'meta-agent'

/** Where a slot's model came from. Reported in the log — see `describeModelRouting`. */
type ModelSource = 'slot' | 'default' | 'settings'

export interface ResolvedModelSlot {
  config: ModelConfig
  source: ModelSource
}

/**
 * Vite replaces `import.meta.env.VITE_NAME` with a literal at build time, which
 * is why every name below is written out rather than looked up. Indexing the
 * object with a computed key survives `bun run dev` and then silently returns
 * undefined in a production build.
 */
function readEnv(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

const SLOT_SPEC: Record<ModelSlot, string> = {
  task: readEnv(import.meta.env.VITE_MODEL_TASK),
  'task-planning': readEnv(import.meta.env.VITE_MODEL_TASK_PLANNING),
  'user-model-propose': readEnv(import.meta.env.VITE_MODEL_USER_MODEL_PROPOSE),
  'user-model-revise': readEnv(import.meta.env.VITE_MODEL_USER_MODEL_REVISE),
  feedback: readEnv(import.meta.env.VITE_MODEL_FEEDBACK),
  'meta-agent': readEnv(import.meta.env.VITE_MODEL_META_AGENT)
}

const DEFAULT_SPEC = readEnv(import.meta.env.VITE_MODEL_DEFAULT)

const API_KEY_BY_PROVIDER: Partial<Record<AIProviderID, string>> = {
  openrouter: readEnv(import.meta.env.VITE_API_KEY_OPENROUTER),
  anthropic: readEnv(import.meta.env.VITE_API_KEY_ANTHROPIC),
  openai: readEnv(import.meta.env.VITE_API_KEY_OPENAI),
  google: readEnv(import.meta.env.VITE_API_KEY_GOOGLE),
  deepseek: readEnv(import.meta.env.VITE_API_KEY_DEEPSEEK),
  zai: readEnv(import.meta.env.VITE_API_KEY_ZAI),
  minimax: readEnv(import.meta.env.VITE_API_KEY_MINIMAX),
  'openai-compatible': readEnv(import.meta.env.VITE_API_KEY_OPENAI_COMPATIBLE),
  'anthropic-compatible': readEnv(import.meta.env.VITE_API_KEY_ANTHROPIC_COMPATIBLE)
}

const BASE_URL_BY_PROVIDER: Partial<Record<AIProviderID, string>> = {
  'openai-compatible': readEnv(import.meta.env.VITE_BASE_URL_OPENAI_COMPATIBLE),
  'anthropic-compatible': readEnv(import.meta.env.VITE_BASE_URL_ANTHROPIC_COMPATIBLE)
}

/** Embeddings are not a slot: the provider is fixed and only the key varies. */
export function embeddingApiKey(): string {
  return readEnv(import.meta.env.VITE_OPENAI_API_KEY)
}

export function feedbackImageApiKey(): string {
  return API_KEY_BY_PROVIDER.openai || settingsKeyFor('openai') || embeddingApiKey()
}

const KNOWN_PROVIDERS = new Set<string>(AI_PROVIDERS.map((provider) => provider.id))

/** Providers whose model ID travels in `customModelID` — see `resolveLanguageModelID`. */
function usesCustomModelID(provider: AIProviderID): boolean {
  return provider === 'openai-compatible' || provider === 'anthropic-compatible'
}

interface ModelSpec {
  providerID: AIProviderID
  modelID: string
}

/**
 * `provider:model`, split at the FIRST colon only — an OpenRouter model ID can
 * contain one of its own (`qwen/qwen3-coder:free`), and splitting on all of them
 * would silently truncate it to `qwen/qwen3-coder`.
 */
function parseModelSpec(spec: string, where: string): ModelSpec | null {
  if (spec === '') return null
  const at = spec.indexOf(':')
  if (at <= 0) {
    console.warn(`[model-routing] ${where}: expected "provider:model", got "${spec}" — ignored`)
    return null
  }
  const provider = spec.slice(0, at)
  const model = spec.slice(at + 1).trim()
  if (model === '') {
    console.warn(`[model-routing] ${where}: no model after "${provider}:" — ignored`)
    return null
  }
  // ACP agents are excluded by construction: they live in ACP_AGENTS, not
  // AI_PROVIDERS, because they are subprocesses rather than models to call.
  if (!KNOWN_PROVIDERS.has(provider)) {
    console.warn(`[model-routing] ${where}: unknown provider "${provider}" — ignored`)
    return null
  }
  return { providerID: provider as AIProviderID, modelID: model }
}

/**
 * The key for a provider that may not be the one selected in the panel.
 *
 * Read straight out of storage rather than through the `apiKey` ref, which
 * tracks the *active* provider only. Going around it is what lets the meta-agent
 * route to Anthropic on the key already typed into the panel while the design
 * agent stays on Google.
 */
function settingsKeyFor(provider: AIProviderID): string {
  return provider === providerID.value ? apiKey.value : storedApiKeyFor(provider)
}

function configFromSpec(spec: ModelSpec): ModelConfig {
  const custom = usesCustomModelID(spec.providerID)
  return {
    providerID: spec.providerID,
    apiKey: API_KEY_BY_PROVIDER[spec.providerID] || settingsKeyFor(spec.providerID),
    modelID: spec.modelID,
    // Set on both so `resolveLanguageModelID` reads the right one whichever
    // branch the provider takes.
    customModelID: custom ? spec.modelID : '',
    customBaseURL: BASE_URL_BY_PROVIDER[spec.providerID] || customBaseURL.value,
    customAPIType: customAPIType.value
  }
}

/** Exactly what the app used before this file existed. */
function configFromSettings(): ModelConfig {
  return {
    providerID: providerID.value,
    apiKey: apiKey.value,
    modelID: modelID.value,
    customModelID: customModelID.value,
    customBaseURL: customBaseURL.value,
    customAPIType: customAPIType.value
  }
}

export function resolveModelSlot(slot: ModelSlot): ResolvedModelSlot {
  const own = parseModelSpec(SLOT_SPEC[slot], slot)
  if (own) return { config: configFromSpec(own), source: 'slot' }

  const shared = parseModelSpec(DEFAULT_SPEC, 'VITE_MODEL_DEFAULT')
  if (shared) return { config: configFromSpec(shared), source: 'default' }

  return { config: configFromSettings(), source: 'settings' }
}

/** The `ModelConfig` alone, for the call sites that only need to build a model. */
export function modelConfigForSlot(slot: ModelSlot): ModelConfig {
  return resolveModelSlot(slot).config
}

/** Whether this slot has enough to make a call. */
export function isSlotConfigured(slot: ModelSlot): boolean {
  const { config } = resolveModelSlot(slot)
  if (config.apiKey === '') return false
  if (usesCustomModelID(config.providerID)) {
    return config.customModelID !== '' && config.customBaseURL !== ''
  }
  return config.modelID !== ''
}

/**
 * Options for the background slots, which are the ones that must not think.
 *
 * Gemini thinks unless told not to and charges it to the output budget: a
 * measured revise call spent 898 tokens thinking to write 88 of answer. Every
 * background slot returns a short structured list against an explicit rubric,
 * which is not what that overhead buys, and they fire on a timer. Providers that
 * only think when asked need nothing, since nothing here asks.
 *
 * Keyed on the SLOT's provider rather than the global one. That distinction did
 * not exist before slots — and the moment two slots differ, reading the global
 * setting means attaching Google's options to an Anthropic call.
 */
export function backgroundProviderOptions(slot: ModelSlot) {
  return modelConfigForSlot(slot).providerID === 'google'
    ? { google: { thinkingConfig: { thinkingBudget: 0 } } }
    : undefined
}

const SLOTS: ModelSlot[] = [
  'task',
  'task-planning',
  'user-model-propose',
  'user-model-revise',
  'feedback',
  'meta-agent'
]

/**
 * One line per slot for the run log.
 *
 * The source is on the line for a reason: a value alone cannot distinguish
 * "routed where I asked" from "fell back to a default that happens to match",
 * and telling those apart is the whole point of reading this.
 */
export function describeModelRouting(): string[] {
  const lines = SLOTS.map((slot) => {
    const { config, source } = resolveModelSlot(slot)
    const model = usesCustomModelID(config.providerID) ? config.customModelID : config.modelID
    const missing = isSlotConfigured(slot) ? '' : '  ⚠ no key'
    return `${slot.padEnd(19)}${config.providerID}:${model || '(unset)'}  (${source})${missing}`
  })
  const embeddings = embeddingApiKey() === '' ? '(no key — user model off)' : 'openai'
  lines.push(`${'embedding'.padEnd(19)}${embeddings}`)
  return lines
}
