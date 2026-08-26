// The only thing the page and the extension actually share: a page can never
// reach chrome.runtime directly, so this relays window postMessage <-> the
// background worker that owns storage.

const SITE_ORIGIN = 'http://localhost:1420'
const FROM_SITE = 'open-pencil-site'
const FROM_EXTENSION = 'open-pencil-extension'

// Content scripts only re-inject on page (re)load, not on an extension
// reload — this line is the fastest way to tell "not injected yet" from
// "injected, but something else is wrong" in the tab's own console.
console.debug('[user-model-manager] content script active on', window.location.href)

function reply(type, requestId, key, extra) {
  window.postMessage({ source: FROM_EXTENSION, type, requestId, key, ...extra }, SITE_ORIGIN)
}

window.addEventListener('message', (event) => {
  // Same tab, same origin only — never a frame, and never another site even if
  // one somehow ended up embedded here.
  if (event.source !== window || event.origin !== SITE_ORIGIN) return
  const data = event.data
  if (!data || data.source !== FROM_SITE) return

  if (data.type === 'REQUEST_DATA') {
    chrome.runtime.sendMessage({ type: 'GET_DATA', key: data.key }, (response) => {
      reply('DATA_RESPONSE', data.requestId, data.key, {
        payload: response?.payload ?? null,
        error: response?.ok === false ? response.error : null
      })
    })
    return
  }

  if (data.type === 'SEND_DATA') {
    chrome.runtime.sendMessage({ type: 'SET_DATA', key: data.key, payload: data.payload }, (response) => {
      reply('ACK', data.requestId, data.key, {
        error: response?.ok === false ? response.error : null
      })
    })
    return
  }

  // A person has to say yes before their captured model leaves the extension —
  // the page can ask, but never just take it. `confirm` runs here because this
  // is the one place in the extension with a window to show it in.
  if (data.type === 'REQUEST_USER_MODEL') {
    const confirmed = window.confirm(
      'This page wants to load the user model captured by this extension. Send it?'
    )
    if (!confirmed) {
      reply('USER_MODEL_RESPONSE', data.requestId, null, { declined: true, payload: null })
      return
    }
    chrome.runtime.sendMessage({ type: 'GET_USER_MODEL' }, (response) => {
      reply('USER_MODEL_RESPONSE', data.requestId, null, {
        declined: false,
        payload: response?.payload ?? null,
        error: response?.ok === false ? response.error : null
      })
    })
  }
})
