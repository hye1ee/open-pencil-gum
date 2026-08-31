/**
 * Adapted from src/app/user-model/storage.ts. The app's version POSTs to a
 * Vite dev-server endpoint; there is no dev server here, so this persists to
 * `chrome.storage.local` under the `user_model` key instead, using the same
 * shape as the app's file (`{ updatedAt, propositions }`). Not scoped by
 * participant id — the id is only carried in the export filename (see
 * popup.js), not in the stored structure, matching the app's file exactly.
 * There is no per-session audit JSONL either, for the same reason as the dev
 * server: nowhere to append it to.
 */

const PID_KEY = '__pid'
/** Matches the popup's frozen "P" + digits field until that's unlocked. */
const DEFAULT_PID = 'P0'
const USER_MODEL_KEY = 'user_model'

export function getPid() {
  return new Promise((resolve) => {
    chrome.storage.local.get(PID_KEY, (items) => {
      resolve(items[PID_KEY] || DEFAULT_PID)
    })
  })
}

export function setPid(pid) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [PID_KEY]: pid }, resolve)
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
