import { createOpenAI } from '@ai-sdk/openai'
import { embedMany, generateText } from 'ai'
import type { LanguageModel, UserContent } from 'ai'

import { agentTurn } from '@/app/ai/chat/agent-turn'
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
import { userEditsSince } from '@/app/ai/chat/user-edits'
import { getToolLogEntries } from '@/app/ai/tools'
import { createUserModel, type UserModel } from '@/app/user-model/pipeline'
import { appendAudit, clearSaved, load, save } from '@/app/user-model/storage'
import { noteError, noteIdleBatch, noteStage, setPropositions } from '@/app/user-model/store'

/**
 * The app-specific half of the user model: which models it calls and where the
 * propositions are kept. `pipeline.ts` knows none of this.
 */

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

/** A frame's worth of tool history; the capture cadence is five seconds. */
const NOTE_WINDOW_MS = 6000

/**
 * What this moment looks like from inside the app, for the frames to be read
 * against — the thing screenshots can never show, which is who was acting.
 *
 * Both can be true at once: the agent builds over many steps and the user is
 * free to edit the canvas the whole time, which is what `intervention.ts`
 * exists to untangle. So the note reports both sides rather than declaring the
 * canvas to be one party's work.
 */
export function frameNote(): string | undefined {
  const since = Date.now() - NOTE_WINDOW_MS
  const edits = userEditsSince(since)
  if (!agentTurn.running && edits.length === 0) return undefined

  const parts: string[] = []
  if (agentTurn.running) {
    const tools = [
      ...new Set(
        getToolLogEntries()
          .filter((entry) => entry.mutates && entry.timestamp >= since)
          .map((entry) => entry.tool)
      )
    ]
    parts.push(
      tools.length === 0
        ? "An AI agent is carrying out the user's request."
        : `An AI agent is carrying out the user's request, changing the canvas with: ${tools.join(', ')}.`
    )
  }
  if (edits.length > 0) {
    parts.push(`Meanwhile the user edited the canvas by hand:\n${edits.join('\n')}`)
  }
  return parts.join('\n')
}

export function createPropositionSink(sessionId: string): UserModel {
  const model = createUserModel({
    deps: {
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
    },

    onStage: noteStage,

    onIdle: (pixelChange) => {
      console.debug(`[user-model] screen still (${pixelChange.toFixed(2)}), batch skipped`)
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

export { clearSaved }
