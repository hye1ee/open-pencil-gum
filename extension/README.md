# User model manager

A minimal Chrome extension (Manifest V3) that talks to the site at
`http://localhost:1420/` and stores what it's sent in `chrome.storage.local`.
No build step — load the files in this folder directly.

## Load it

1. `chrome://extensions`
2. Enable "Developer mode" (top right)
3. "Load unpacked" → select this `extension/` folder

## Protocol

The page and the extension talk over `window.postMessage`, restricted to
`http://localhost:1420` on both ends. The content script relays to the
background worker, which owns `chrome.storage.local`.

**Site asks for stored data:**

```js
window.postMessage(
  { source: 'open-pencil-site', type: 'REQUEST_DATA', requestId: 'r1', key: 'my-key' },
  'http://localhost:1420'
)

window.addEventListener('message', (event) => {
  if (event.data?.source !== 'open-pencil-extension') return
  if (event.data.type === 'DATA_RESPONSE' && event.data.requestId === 'r1') {
    console.log(event.data.payload)
  }
})
```

**Site sends data to store:**

```js
window.postMessage(
  { source: 'open-pencil-site', type: 'SEND_DATA', requestId: 'r2', key: 'my-key', payload: { hello: 'world' } },
  'http://localhost:1420'
)

window.addEventListener('message', (event) => {
  if (event.data?.source !== 'open-pencil-extension') return
  if (event.data.type === 'ACK' && event.data.requestId === 'r2') {
    console.log('stored')
  }
})
```

`key` is optional on both — omitted, it falls back to `'default'`.

## Popup

Click the toolbar icon for a status view:

- **status** — `idle`, `received data`, `received data request`, or
  `proceed data request`. Set by the background worker as it handles each
  message; there's no auto-return to `idle`.
- **Current data** — everything in `chrome.storage.local` except the internal
  status key, as JSON.
- **Generate initial user model** — replaces the current data with
  `{ "user_model": null }`.
- **Export** — downloads the current data as `usermodel-<timestamp>.json`.
- **Restart** — exports the current data, then clears all stored data and
  resets status to `idle`.

The popup only exists while open, so it re-reads storage on open and then
listens for `chrome.storage.onChanged` to stay live.
