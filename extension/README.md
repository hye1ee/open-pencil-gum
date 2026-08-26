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
  `GET_DATA`/`SET_DATA` message from the site; there's no auto-return to
  `idle`. Calibration (below) doesn't touch this — it's a separate concern.
- **Current data** — everything in `chrome.storage.local` except internal
  (`__`-prefixed) keys, as JSON. This includes the `user_model_<pid>` key that
  calibration writes to.
- **Participant ID** — a fixed `P` prefix plus a digit suffix (`P0`, `P1`, …).
  Currently frozen to `0` — the digit input is `disabled` in `popup.html` and
  `PID_LOCKED` in `popup.js` is what's gating it; flip that to `false` to let
  it be edited. Stored under `__pid`, and used to scope where the captured
  model lives (`user_model_<pid>`) so different participants' data doesn't
  mix, and in the export filename.
- **OpenAI API key** — required before calibration can start, alongside the
  Participant ID. Stored under the reserved `__openai_api_key` key, so it's
  excluded from "Current data" and survives a Restart.
- **Start calibration / Stop calibration** — disabled until both the
  Participant ID and API key are filled in. See below for what calibration
  does.
- **Export** — downloads the current data as `usermodel-<pid>-<timestamp>.json`.
- **Restart** — exports the current data, stops calibration if running, then
  clears all data (the API key, Participant ID, and calibration state are
  preserved) and resets status to `idle`.

The popup only exists while open, so it re-reads storage on open and then
listens for `chrome.storage.onChanged` to stay live.

## Calibration (user model capture)

`user-model/` is a port of `src/app/user-model/` from the main app — the
PROPOSE → EMBED → RETRIEVE → REVISE pipeline that turns screenshots into a set
of propositions about the person using the app (see `pipeline.js`, algorithm
unchanged). Two pieces are reimplemented rather than copied, because the
platform doesn't offer what the app's versions rely on:

- **`calls.js`** — the app calls a model through the `ai` npm package; this
  extension has no build step, so there's no bundler to pull that package in.
  This is plain `fetch` against the OpenAI REST API instead, using the API key
  entered in the popup. `CHAT_MODEL`/`EMBEDDING_MODEL` are constants at the
  top of the file if you want to point it elsewhere.
- **`storage.js`** — the app POSTs to a Vite dev-server endpoint; there is no
  server here, so this reads/writes `chrome.storage.local` under a
  `user_model_<pid>` key instead (see Participant ID above). There's no
  per-session audit log for the same reason (nowhere to append it to) — only
  the current state persists.

**What "Start calibration" actually does**, and why it differs from the app:

- Frames come from `chrome.tabs.captureVisibleTab` on whatever tab is
  currently on screen, not a shared-tab `MediaStream` pinned to one tab. This
  is why the extension asks for the `<all_urls>` host permission — without
  it, capture would only work while a `localhost:1420` tab happened to be the
  visible one.
- The capture cadence is one frame per minute (`chrome.alarms`' documented
  minimum for a repeating alarm), not every 5 seconds. A Manifest V3 service
  worker's own `setInterval` doesn't reliably survive being suspended between
  ticks; alarms do. A batch is still 6 frames (unchanged), so it now takes
  about 6 minutes instead of 30 seconds.
- No `note` on captured frames (what an agent/the user were doing at that
  moment) — there's no agent or tool history in this extension to read that
  from. The field is optional in `pipeline.js` for exactly this reason, so
  this is a straightforward omission rather than a workaround.
- `observe`/`observeFeedback` (the Interactive Feedback Notes half of the
  pipeline) are carried over for fidelity but never called — there's no
  meta-agent here producing that feedback yet.

Click **Start calibration**: it checks for an API key, then captures once
immediately and every minute after via a `chrome.alarms` alarm, feeding
`pipeline.js` until you click **Stop calibration**. Calibration state
(`__calibrating`) is in `chrome.storage.local` so it's correct on reopening
the popup even if calibration kept running while it was closed.
