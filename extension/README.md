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

Click the toolbar icon. The main view has three header icons plus the
calibration controls; Settings is a separate view within the same popup, not
a new page.

**Header icons:**

- **Download** — exports the current data as `usermodel-<pid>-<timestamp>.json`.
- **Restart** (red) — exports the current data, stops calibration if running,
  then clears all data (the API keys, Participant ID, and calibration state
  are preserved) and resets status to `idle`.
- **Settings (gear)** — opens the Settings view; the back arrow there returns
  to the main view.

**Main view:**

- **status** — `idle`, `received data`, `received data request`, or
  `proceed data request`. Set by the background worker as it handles each
  `GET_DATA`/`SET_DATA` message from the site; there's no auto-return to
  `idle`. Calibration doesn't touch this — it's a separate concern.
- **`<pid>'s user model`** (label above the data box) — everything in
  `chrome.storage.local` except internal (`__`-prefixed) keys, as JSON. This
  includes the `user_model` key that calibration writes to, in the same
  `{ updatedAt, propositions }` shape as `captures/user-model.json` in the
  main app. The participant id is not part of the stored structure — only the
  label above it and the export filename carry it.
- A "Go to settings and fill these in first." link, shown until both API keys
  and the Participant ID are set — clicking it opens Settings directly.
- **Start calibration / Stop calibration** — Start stays disabled until the
  Participant ID and both API keys are filled in. See below for what
  calibration does.

**Settings view:**

- **Participant ID** — a fixed `P` prefix plus a digit suffix (`P0`, `P1`, …).
  Currently frozen to `0` — the digit input is `disabled` in `popup.html` and
  `PID_LOCKED` in `popup.js` is what's gating it; flip that to `false` to let
  it be edited. Stored under `__pid`; shown in the "Current data" label above
  and in the export filename, but not inside the stored `user_model` value
  itself (see Calibration below).
- **Google API key** / **OpenAI API key** — both required before calibration
  can start (see Calibration below for why there are two). Stored under
  `__google_api_key`/`__openai_api_key`, so excluded from "Current data" and
  preserved across a Restart.

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
  This is plain `fetch` against provider REST APIs instead, using the two keys
  entered in Settings. The split matches what the app actually runs, not a
  simplification: `user-model-propose`/`user-model-revise` are
  provider-configurable (`.env`), and in this repo's actual `.env` they're
  unset and fall back to `VITE_MODEL_DEFAULT=google:gemini-3.5-flash` — so
  propose/revise really are Gemini calls (`CHAT_MODEL` constant). Embeddings
  are hardcoded to OpenAI on the app's side too (`embeddingApiKey()` in
  `model-routing.ts` — "the provider is fixed"), so this does the same
  (`EMBEDDING_MODEL` constant, `text-embedding-3-small`).
- **`storage.js`** — the app POSTs to a Vite dev-server endpoint; there is no
  server here, so this reads/writes `chrome.storage.local` under a
  `user_model` key instead, holding the same `{ updatedAt, propositions }`
  shape as `captures/user-model.json`. Not scoped by participant id — that's
  carried in the popup label and the export filename only (see Participant ID
  above), not in this structure. There's no per-session audit log for the
  same reason as the dev server: nowhere to append it to — only the current
  state persists.

**What "Start calibration" actually does**, and why it differs from the app:

- Frames come from `chrome.tabs.captureVisibleTab` on whatever tab is
  currently on screen, not a shared-tab `MediaStream` pinned to one tab. This
  is why the extension asks for the `<all_urls>` host permission — without
  it, capture would only work while a `localhost:1420` tab happened to be the
  visible one.
- The capture cadence is driven by `chrome.alarms` instead of a plain
  `setInterval`, since a Manifest V3 service worker's own timers don't
  reliably survive being suspended between ticks. `chrome.alarms` normally
  floors the period at 30s (or 1 minute pre-Chrome 120), but that floor is
  lifted entirely for an extension loaded unpacked in developer mode — the
  only way this one is loaded — so it's set to match the app's 5-second
  cadence. Load this from the Chrome Web Store and it would silently clamp
  to 30s instead.
- No `note` on captured frames (what an agent/the user were doing at that
  moment) — there's no agent or tool history in this extension to read that
  from. The field is optional in `pipeline.js` for exactly this reason, so
  this is a straightforward omission rather than a workaround.
- `observe`/`observeFeedback` (the Interactive Feedback Notes half of the
  pipeline) are carried over for fidelity but never called — there's no
  meta-agent here producing that feedback yet.

Click **Start calibration**: it checks for both API keys, then captures once
immediately and every 5 seconds after via a `chrome.alarms` alarm, feeding
`pipeline.js` until you click **Stop calibration**. Calibration state
(`__calibrating`) is in `chrome.storage.local` so it's correct on reopening
the popup even if calibration kept running while it was closed.
