// Owns the actual storage. The content script only relays; nothing here trusts
// a page directly, since it only ever hears from its own content script.
//
// `__status` lives in the same storage.local as the data, under a reserved
// key, so the popup can watch both with one `storage.onChanged` listener.

const DEFAULT_KEY = 'default'
const STATUS_KEY = '__status'

function setStatus(status) {
  chrome.storage.local.set({ [STATUS_KEY]: status })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false

  if (message.type === 'GET_DATA') {
    // Set the moment the request arrives, not after it's read, so the popup
    // can show the request landing rather than only its outcome.
    setStatus('received-data-request')
    const key = message.key || DEFAULT_KEY
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message })
        return
      }
      setStatus('proceed-data-request')
      sendResponse({ ok: true, payload: result[key] ?? null })
    })
    return true // keep the message channel open for the async response
  }

  if (message.type === 'SET_DATA') {
    const key = message.key || DEFAULT_KEY
    chrome.storage.local.set({ [key]: message.payload }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message })
        return
      }
      setStatus('received-data')
      sendResponse({ ok: true })
    })
    return true
  }

  if (message.type === 'RESET') {
    chrome.storage.local.clear(() => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message })
        return
      }
      setStatus('idle')
      sendResponse({ ok: true })
    })
    return true
  }

  if (message.type === 'GENERATE_INITIAL') {
    // Cleared first, so the current data ends up as exactly this shape rather
    // than this key alongside whatever was already stored.
    chrome.storage.local.clear(() => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message })
        return
      }
      chrome.storage.local.set({ user_model: null }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message })
          return
        }
        sendResponse({ ok: true })
      })
    })
    return true
  }

  return false
})
