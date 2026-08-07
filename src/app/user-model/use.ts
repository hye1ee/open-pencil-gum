import { createOpenAI } from '@ai-sdk/openai'
import { embedMany, generateText } from 'ai'
import type { LanguageModel, UserContent } from 'ai'

import { createUntracedLanguageModel } from '@/app/ai/chat/model'
import {
  apiKey,
  customAPIType,
  customBaseURL,
  customModelID,
  isConfigured,
  modelID,
  providerID
} from '@/app/ai/chat/storage'
import {
  createUserModel,
  type Proposition,
  type SavedProposition,
  type UserModel
} from '@/app/user-model/pipeline'
import { noteError, noteIdleBatch, noteStage, setPropositions } from '@/app/user-model/store'

/**
 * The app-specific half of the user model: which models it calls and where the
 * propositions are kept. `pipeline.ts` knows none of this.
 */

const ENDPOINT = '/__user-model'
const AUDIT_ENDPOINT = '/__propositions'

/**
 * Both stages run on the cheapest capable model rather than whatever the user
 * picked for the agent. Propose sends six images every thirty seconds, so the
 * choice is the difference between a few dollars an hour and one.
 */
const SMALL_MODEL = 'claude-haiku-4-5-20251001'

const EMBEDDING_MODEL = 'text-embedding-3-small'
/** Enough to separate paraphrases at this scale, at a fraction of the storage. */
const EMBEDDING_DIMENSIONS = 512

/**
 * Generous because on a reasoning model the thinking is drawn from this same
 * budget: a measured Revise call spent 898 tokens thinking and 88 answering,
 * so a 1024 cap left the JSON one thought away from being cut off mid-object.
 * It is a ceiling, not a reservation — nothing is charged for headroom.
 */
const PROPOSE_MAX_TOKENS = 4096
const REVISE_MAX_TOKENS = 4096

const openaiKey = import.meta.env.VITE_OPENAI_API_KEY ?? ''

/** Whether there is a model to call and something to embed with. */
export function canBuildUserModel(): boolean {
  return isConfigured.value && openaiKey !== ''
}

function smallModel(): LanguageModel {
  const config = {
    providerID: providerID.value,
    apiKey: apiKey.value,
    // Anthropic is the only provider we know a cheap vision model ID for; any
    // other one keeps whatever the user configured.
    modelID: providerID.value === 'anthropic' ? SMALL_MODEL : modelID.value,
    customModelID: customModelID.value,
    customBaseURL: customBaseURL.value,
    customAPIType: customAPIType.value
  }
  return createUntracedLanguageModel(config)
}

/**
 * Gemini thinks unless told not to, and charges it to the output budget: a
 * measured Revise spent 898 tokens thinking to write 88 of answer. Both stages
 * here produce a short structured list against an explicit rubric, which is not
 * what that overhead buys — and it fires every thirty seconds. Providers that
 * only think when asked need nothing, since nothing here asks.
 */
function noThinkingOptions() {
  return providerID.value === 'google'
    ? { google: { thinkingConfig: { thinkingBudget: 0 } } }
    : undefined
}

export function createPropositionSink(sessionId: string): UserModel {
  const model = createUserModel({
    deps: {
      propose: async ({ system, images, instruction }) => {
        const frames = await Promise.all(images.map((image) => image.arrayBuffer()))
        // Each image is labelled with its position. Unlabelled, the model tends
        // to describe the last frame; numbered, it talks about what changed.
        const content: UserContent = [{ type: 'text', text: instruction }]
        for (const [i, data] of frames.entries()) {
          content.push({ type: 'text', text: `Frame ${i + 1} of ${frames.length}:` })
          content.push({ type: 'image', image: new Uint8Array(data) })
        }
        const { text } = await generateText({
          model: smallModel(),
          system,
          maxOutputTokens: PROPOSE_MAX_TOKENS,
          providerOptions: noThinkingOptions(),
          messages: [{ role: 'user', content }]
        })
        return text
      },

      revise: async ({ system, prompt }) => {
        const { text } = await generateText({
          model: smallModel(),
          system,
          maxOutputTokens: REVISE_MAX_TOKENS,
          providerOptions: noThinkingOptions(),
          prompt
        })
        return text
      },

      embed: async (texts) => {
        const openai = createOpenAI({ apiKey: openaiKey })
        const { embeddings } = await embedMany({
          model: openai.embedding(EMBEDDING_MODEL),
          values: texts,
          providerOptions: { openai: { dimensions: EMBEDDING_DIMENSIONS } }
        })
        return embeddings
      }
    },

    onStage: noteStage,

    onIdle: (movement) => {
      console.debug(`[user-model] screen still (${movement.toFixed(2)}), batch skipped`)
      noteIdleBatch()
    },

    onChange: (propositions) => {
      for (const proposition of propositions) {
        console.debug(`[user-model] ${proposition.text}`)
      }
      setPropositions(propositions)
      void save(propositions)
      void appendAudit(sessionId, propositions)
    },

    onError: (error: unknown) => {
      console.warn('[user-model] pipeline failed:', error)
      noteError(error)
    }
  })

  void load().then((saved) => {
    if (saved.length === 0) return
    model.load(saved)
    // Read back rather than reusing `saved`: `load` fills in the drift fields
    // an older file is missing, and the panel should show the filled-in set.
    setPropositions(model.propositions)
  })

  return model
}

/** The whole model, rewritten each time. It is small and this is a dev tool. */
function save(propositions: Proposition[]): Promise<void> {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updatedAt: new Date().toISOString(), propositions }, null, 2)
  })
    .then(() => undefined)
    .catch((error: unknown) => {
      console.warn('[user-model] could not save:', error)
    })
}

interface SavedModel {
  propositions?: unknown
}

function isSaved(value: unknown): value is SavedModel {
  return typeof value === 'object' && value !== null
}

export function load(): Promise<SavedProposition[]> {
  return fetch(ENDPOINT)
    .then((response) => (response.ok ? response.json() : null))
    .then((data: unknown) =>
      isSaved(data) && Array.isArray(data.propositions)
        ? (data.propositions as SavedProposition[])
        : []
    )
    .catch((error: unknown) => {
      console.warn('[user-model] could not load:', error)
      return []
    })
}

export function clearSaved(): Promise<void> {
  return save([])
}

/**
 * A per-session record of what the model looked like after each batch, kept
 * alongside the frames it was inferred from. The snapshot above is the state;
 * this is the history, and it is the only way to see how a proposition got its
 * current wording.
 */
function appendAudit(sessionId: string, propositions: Proposition[]): Promise<void> {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    propositions: propositions.map((p) => ({
      id: p.id,
      text: p.text,
      confidence: p.confidence,
      decay: p.decay,
      observations: p.observations,
      revisions: p.revisions
    }))
  })
  return fetch(`${AUDIT_ENDPOINT}?session=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: line + '\n'
  })
    .then(() => undefined)
    .catch(() => undefined)
}
