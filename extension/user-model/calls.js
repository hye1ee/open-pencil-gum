/**
 * Adapted from src/app/user-model/calls.ts. The app's version wraps the `ai`
 * npm package and its own model-routing config; this extension has no build
 * step, so there is no bundler to pull that package in. Same roles
 * (`canBuildUserModel`, `modelCalls`), reimplemented as plain `fetch` calls
 * against the OpenAI REST API, with a single API key entered in the popup.
 */

const API_KEY_STORAGE_KEY = '__openai_api_key'

/** Vision-capable for propose, text-only would do for revise — one model for
 * both keeps this file to one constant to change. */
const CHAT_MODEL = 'gpt-4o-mini'
const EMBEDDING_MODEL = 'text-embedding-3-small'
/** Enough to separate paraphrases at this scale, at a fraction of the storage.
 * Matches the app's constant so a captured file would be shaped the same. */
const EMBEDDING_DIMENSIONS = 512

const PROPOSE_MAX_TOKENS = 4096
const REVISE_MAX_TOKENS = 4096

export function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(API_KEY_STORAGE_KEY, (items) => {
      resolve(items[API_KEY_STORAGE_KEY] || '')
    })
  })
}

export function setApiKey(key) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [API_KEY_STORAGE_KEY]: key }, resolve)
  })
}

export async function canBuildUserModel() {
  return (await getApiKey()) !== ''
}

/** No FileReader in a service worker — this is the standard workaround. */
async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer()
  let binary = ''
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function chatCompletion(apiKey, { system, content, maxTokens }) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content }
      ]
    })
  })
  if (!response.ok) {
    throw new Error(`OpenAI chat completion failed: ${response.status} ${await response.text()}`)
  }
  const data = await response.json()
  return data.choices?.[0]?.message?.content ?? ''
}

export function modelCalls() {
  return {
    propose: async ({ system, images, instruction, context }) => {
      const apiKey = await getApiKey()
      // Text before the frames, so it colours how they are read — same order
      // as the app's version.
      const content = [{ type: 'text', text: instruction }]
      if (context.length > 0) content.push({ type: 'text', text: context.join('\n') })
      for (const [i, image] of images.entries()) {
        const base64 = await blobToBase64(image)
        content.push({ type: 'text', text: `Frame ${i + 1} of ${images.length}:` })
        content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } })
      }
      return chatCompletion(apiKey, { system, content, maxTokens: PROPOSE_MAX_TOKENS })
    },

    revise: async ({ system, prompt }) => {
      const apiKey = await getApiKey()
      return chatCompletion(apiKey, { system, content: prompt, maxTokens: REVISE_MAX_TOKENS })
    },

    embed: async (texts) => {
      const apiKey = await getApiKey()
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
