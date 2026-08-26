/**
 * Adapted from src/app/user-model/storage.ts. The app's version POSTs to a
 * Vite dev-server endpoint; there is no dev server here, so this persists to
 * `chrome.storage.local` instead — under a `user_model_<pid>` key, scoped by
 * participant id so switching participants doesn't mix their captured models.
 * There is no per-session audit JSONL either, for the same reason as the dev
 * server: nowhere to append it to.
 */

const PID_KEY = '__pid'
/** Matches the popup's frozen "P" + digits field until that's unlocked. */
const DEFAULT_PID = 'P0'

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

function userModelKey(pid) {
  return `user_model_${pid}`
}

export async function save(propositions) {
  const key = userModelKey(await getPid())
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: propositions }, resolve)
  })
}

export async function load() {
  const key = userModelKey(await getPid())
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (items) => {
      const saved = items[key]
      resolve(Array.isArray(saved) ? saved : [])
    })
  })
}

export function clearSaved() {
  return save([])
}
