/**
 * Adapted from src/app/user-model/calls.ts. The app's version wraps the `ai`
 * npm package and its own model-routing config; this extension has no build
 * step, so there is no bundler to pull that package in. Same roles
 * (`canBuildUserModel`, `modelCalls`), reimplemented as plain `fetch` calls.
 *
 * Provider split matches what this repo's app actually runs, not a
 * simplification: `user-model-propose`/`user-model-revise` are unset in
 * `.env` and fall back to `VITE_MODEL_DEFAULT=google:gemini-3.5-flash`, so
 * propose/revise really are Gemini calls today. Embeddings are hardcoded to
 * OpenAI on the app's side too (`embeddingApiKey()` in `model-routing.ts` —
 * "the provider is fixed"). Two separate keys here, one per provider,
 * entered in the popup's Settings view.
 */

const GOOGLE_API_KEY_STORAGE_KEY = '__google_api_key'
const OPENAI_API_KEY_STORAGE_KEY = '__openai_api_key'

/** Matches this repo's `VITE_MODEL_DEFAULT`. */
const CHAT_MODEL = 'gemini-3.5-flash'
const EMBEDDING_MODEL = 'text-embedding-3-small'
/** Enough to separate paraphrases at this scale, at a fraction of the storage.
 * Matches the app's constant so a captured file would be shaped the same. */
const EMBEDDING_DIMENSIONS = 512

const PROPOSE_MAX_TOKENS = 4096
const REVISE_MAX_TOKENS = 4096

function stored(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (items) => resolve(items[key] || ''))
  })
}

function store(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve)
  })
}

export const getGoogleApiKey = () => stored(GOOGLE_API_KEY_STORAGE_KEY)
export const setGoogleApiKey = (key) => store(GOOGLE_API_KEY_STORAGE_KEY, key)
export const getOpenaiApiKey = () => stored(OPENAI_API_KEY_STORAGE_KEY)
export const setOpenaiApiKey = (key) => store(OPENAI_API_KEY_STORAGE_KEY, key)

/** Both are needed — Gemini drives propose/revise, OpenAI drives embed, and
 * every batch calls all three. */
export async function canBuildUserModel() {
  const [google, openai] = await Promise.all([getGoogleApiKey(), getOpenaiApiKey()])
  return google !== '' && openai !== ''
}

/** No FileReader in a service worker — this is the standard workaround. */
async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer()
  let binary = ''
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function geminiGenerate(apiKey, { system, parts, maxTokens }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: { maxOutputTokens: maxTokens }
    })
  })
  if (!response.ok) {
    throw new Error(`Gemini request failed: ${response.status} ${await response.text()}`)
  }
  const data = await response.json()
  const responseParts = data.candidates?.[0]?.content?.parts ?? []
  return responseParts.map((part) => part.text ?? '').join('')
}

export function modelCalls() {
  return {
    propose: async ({ system, images, instruction, context }) => {
      const apiKey = await getGoogleApiKey()
      // Text before the frames, so it colours how they are read — same order
      // as the app's version.
      const parts = [{ text: instruction }]
      if (context.length > 0) parts.push({ text: context.join('\n') })
      for (const [i, image] of images.entries()) {
        const base64 = await blobToBase64(image)
        parts.push({ text: `Frame ${i + 1} of ${images.length}:` })
        parts.push({ inline_data: { mime_type: 'image/jpeg', data: base64 } })
      }
      return geminiGenerate(apiKey, { system, parts, maxTokens: PROPOSE_MAX_TOKENS })
    },

    revise: async ({ system, prompt }) => {
      const apiKey = await getGoogleApiKey()
      return geminiGenerate(apiKey, {
        system,
        parts: [{ text: prompt }],
        maxTokens: REVISE_MAX_TOKENS
      })
    },

    embed: async (texts) => {
      const apiKey = await getOpenaiApiKey()
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: texts,
          dimensions: EMBEDDING_DIMENSIONS
        })
      })
      if (!response.ok) {
        throw new Error(`OpenAI embeddings failed: ${response.status} ${await response.text()}`)
      }
      const data = await response.json()
      return data.data.map((item) => item.embedding)
    }
  }
}
