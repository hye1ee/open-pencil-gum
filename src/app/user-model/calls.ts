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
import type { UserModelDeps } from '@/app/user-model/pipeline'

/**
 * Which models the user model calls, and with what budget. Everything here is
 * about cost and provider quirks; nothing here knows what a proposition is.
 */

/**
 * Every stage runs on the cheapest capable model rather than whatever the user
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
 * measured Revise spent 898 tokens thinking to write 88 of answer. Every stage
 * here produces a short structured list against an explicit rubric, which is
 * not what that overhead buys — and it fires every thirty seconds. Providers
 * that only think when asked need nothing, since nothing here asks.
 */
function noThinkingOptions() {
  return providerID.value === 'google'
    ? { google: { thinkingConfig: { thinkingBudget: 0 } } }
    : undefined
}

export function modelCalls(): UserModelDeps {
  return {
    propose: async ({ system, images, instruction, context }) => {
      const frames = await Promise.all(images.map((image) => image.arrayBuffer()))
      // Each image is labelled with its position. Unlabelled, the model tends
      // to describe the last frame; numbered, it talks about what changed.
      const content: UserContent = [{ type: 'text', text: instruction }]
      // Before the frames, so it colours how they are read rather than
      // arriving as an afterthought once conclusions are formed.
      if (context.length > 0) content.push({ type: 'text', text: context.join('\n') })
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
  }
}
