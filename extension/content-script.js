// The only thing the page and the extension actually share: a page can never
// reach chrome.runtime directly, so this relays window postMessage <-> the
// background worker that owns storage.

const SITE_ORIGIN = 'http://localhost:1420'
const FROM_SITE = 'open-pencil-site'
const FROM_EXTENSION = 'open-pencil-extension'

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
  }
})
