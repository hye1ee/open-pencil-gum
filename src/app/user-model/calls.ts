import { createOpenAI } from '@ai-sdk/openai'
import { embedMany, generateText } from 'ai'
import type { UserContent } from 'ai'

import { createUntracedLanguageModel } from '@/app/ai/chat/model'
import {
  backgroundProviderOptions,
  embeddingApiKey,
  isSlotConfigured,
  modelConfigForSlot
} from '@/app/ai/model-routing'
import type { ModelSlot } from '@/app/ai/model-routing'
import type { RevisionPurpose, UserModelDeps } from '@/app/user-model/pipeline'

/** Which models the user model calls and with what budget. Three slots because
 * vision, revising on a timer and revising from an answer are worth different
 * money; nothing here knows what a proposition is. */

const EMBEDDING_MODEL = 'text-embedding-3-small'
/** Enough to separate paraphrases at this scale, at a fraction of the storage. */
const EMBEDDING_DIMENSIONS = 512

function reviseSlot(purpose: RevisionPurpose): ModelSlot {
  return purpose === 'revise-from-feedback' ? 'feedback' : 'user-model-revise'
}

/** Generous because thinking comes out of this budget: a measured call spent 898
 * tokens thinking and 88 answering. A ceiling, not a reservation. */
const PROPOSE_MAX_TOKENS = 4096
const REVISE_MAX_TOKENS = 4096

/** Only the propose slot is checked: without it there are no candidates for the
 * revise slots to place. */
export function canBuildUserModel(): boolean {
  return isSlotConfigured('user-model-propose') && embeddingApiKey() !== ''
}

export function modelCalls(): UserModelDeps {
  return {
    propose: async ({ system, images, instruction, context }) => {
      const frames = await Promise.all(images.map((image) => image.arrayBuffer()))
      // Unlabelled, the model describes the last frame; numbered, what changed.
      const content: UserContent = [{ type: 'text', text: instruction }]
      // Before the frames, so it colours how they are read.
      if (context.length > 0) content.push({ type: 'text', text: context.join('\n') })
      for (const [i, data] of frames.entries()) {
        content.push({ type: 'text', text: `Frame ${i + 1} of ${frames.length}:` })
        content.push({ type: 'image', image: new Uint8Array(data) })
      }
      const { text } = await generateText({
        model: createUntracedLanguageModel(modelConfigForSlot('user-model-propose')),
        system,
        maxOutputTokens: PROPOSE_MAX_TOKENS,
        providerOptions: backgroundProviderOptions('user-model-propose'),
        messages: [{ role: 'user', content }]
      })
      return text
    },

    revise: async ({ system, prompt, purpose }) => {
      const slot = reviseSlot(purpose)
      const { text } = await generateText({
        model: createUntracedLanguageModel(modelConfigForSlot(slot)),
        system,
        maxOutputTokens: REVISE_MAX_TOKENS,
        providerOptions: backgroundProviderOptions(slot),
        prompt
      })
      return text
    },

    embed: async (texts) => {
      const openai = createOpenAI({ apiKey: embeddingApiKey() })
      const { embeddings } = await embedMany({
        model: openai.embedding(EMBEDDING_MODEL),
        values: texts,
        providerOptions: { openai: { dimensions: EMBEDDING_DIMENSIONS } }
      })
      return embeddings
    }
  }
}
