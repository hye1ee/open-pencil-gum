// Owns the actual storage. The content script only relays; nothing here trusts
// a page directly, since it only ever hears from its own content script.
//
// `__status` lives in the same storage.local as the data, under a reserved
// key, so the popup can watch both with one `storage.onChanged` listener. Any
// key starting with `__` is internal state, not site data — see popup.js.

import { CALIBRATING_KEY, startCalibration, stopCalibration } from './user-model/use.js'

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
    // Internal (`__`-prefixed) keys — the API key, calibration state — survive
    // a restart of the data; only what the site/calibration produced is wiped.
    stopCalibration()
    chrome.storage.local.get(null, (all) => {
      const preserved = Object.fromEntries(
        Object.entries(all).filter(([key]) => key.startsWith('__'))
      )
      chrome.storage.local.clear(() => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message })
          return
        }
        chrome.storage.local.set({ ...preserved, [STATUS_KEY]: 'idle', [CALIBRATING_KEY]: false }, () => {
          sendResponse({ ok: true })
        })
      })
    })
    return true
  }

  if (message.type === 'GET_USER_MODEL') {
    // Flat `{ updatedAt, propositions }`, same shape the site's own
    // `captures/user-model.json` uses — see user-model/storage.js.
    chrome.storage.local.get('user_model', (result) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message })
        return
      }
      const value = result.user_model
      const payload = value && Array.isArray(value.propositions) ? value : null
      sendResponse({ ok: true, payload })
    })
    return true
  }

  if (message.type === 'START_CALIBRATION') {
    startCalibration().then(sendResponse)
    return true
  }

  if (message.type === 'STOP_CALIBRATION') {
    sendResponse(stopCalibration())
    return false
  }

  return false
})
