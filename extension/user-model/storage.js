/**
 * Adapted from src/app/user-model/storage.ts. The app's version POSTs to a
 * Vite dev-server endpoint; there is no dev server here, so this persists to
 * `chrome.storage.local` under the `user_model` key instead, using the same
 * shape as the app's file (`{ updatedAt, propositions }`). Not scoped by
 * user name — the name is only carried in the export filenames (see
 * popup.js), not in the stored structure, matching the app's file exactly.
 * There is no per-session audit JSONL either, for the same reason as the dev
 * server: nowhere to append it to.
 */

const USER_NAME_KEY = '__user_name'
const USER_MODEL_KEY = 'user_model'

export function getUserName() {
  return new Promise((resolve) => {
    chrome.storage.local.get(USER_NAME_KEY, (items) => {
      resolve(items[USER_NAME_KEY] || '')
    })
  })
}

export function setUserName(name) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [USER_NAME_KEY]: name }, resolve)
  })
}

export function save(propositions) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { [USER_MODEL_KEY]: { updatedAt: new Date().toISOString(), propositions } },
      resolve
    )
  })
}

export function load() {
  return new Promise((resolve) => {
    chrome.storage.local.get(USER_MODEL_KEY, (items) => {
      const saved = items[USER_MODEL_KEY]
      resolve(saved && Array.isArray(saved.propositions) ? saved.propositions : [])
    })
  })
}

export function clearSaved() {
  return save([])
}
