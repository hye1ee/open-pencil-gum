/**
 * Adapted from src/app/user-model/use.ts — the app-specific half: where frames
 * come from, and where the propositions are kept. `pipeline.js` knows none of
 * it.
 *
 * Two deliberate departures from the app's version, both platform-forced:
 *
 * 1. Frames come from `chrome.tabs.captureVisibleTab` on whatever tab is
 *    currently visible, not a shared-tab MediaStream pinned to one tab. This
 *    needs the `<all_urls>` host permission (see manifest.json) — without it,
 *    capture would only work on tabs the extension already has access to.
 * 2. The capture cadence is driven by `chrome.alarms` rather than a plain
 *    `setInterval` — a Manifest V3 service worker's own timers do not
 *    reliably survive being suspended, and alarms are the supported way to
 *    get a callback that does. `chrome.alarms` normally floors the period at
 *    30s (packed) or 1 minute (pre-Chrome 120), but Chrome lifts that floor
 *    entirely for an extension loaded unpacked in developer mode — which is
 *    the only way this one is loaded (see README) — so the period below can
 *    match the app's 5-second cadence. Load this from the Chrome Web Store
 *    instead and it would silently clamp to 30s.
 *
 * No `note` on captured frames yet — there is no agent/tool history to read
 * in this extension, and the field is optional in `pipeline.js` for exactly
 * this reason.
 */

import { canBuildUserModel, modelCalls } from './calls.js'
import { getStudyLanguage } from './language.js'
import { createUserModel } from './pipeline.js'
import { clearSaved, load, save } from './storage.js'
import { appendTrace } from './trace.js'

export { canBuildUserModel, clearSaved }

const CAPTURE_ALARM = 'user-model-capture'
/** Matches the app's cadence — only possible because this extension is
 * always loaded unpacked; see the file header. */
const CAPTURE_PERIOD_SECONDS = 5
export const CALIBRATING_KEY = '__calibrating'

let model = null
/** The language the current `model` was created with. A service worker can
 * outlive one session, so a later session with the other toggle must not
 * reuse a model whose prompts are baked to the old language. */
let modelLanguage = null
let calibrating = false

function setCalibrating(value) {
  calibrating = value
  chrome.storage.local.set({ [CALIBRATING_KEY]: value })
}

function ensureModel(language) {
  if (model && modelLanguage === language) return model
  model = createUserModel({
    deps: modelCalls(),
    language,
    onChange: (propositions) => {
      void save(propositions)
    },
    // The trace (see trace.js) records how propositions come to be, mainly so
    // SIMILARITY_FLOOR can be judged against real Korean similarities.
    onCandidates: (candidates) => {
      void appendTrace({ type: 'propose', candidates })
    },
    onRetrieval: (retrieval) => {
      void appendTrace({ type: 'retrieval', ...retrieval })
    },
    onRevision: (revision) => {
      void appendTrace({ type: 'revision', ...revision })
    },
    onIdle: (pixelChange) => {
      void appendTrace({ type: 'idle-skip', pixelChange })
    },
    onError: (error) => {
      console.warn('[user-model] pipeline failed:', error)
      void appendTrace({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  })
  modelLanguage = language
  void appendTrace({ type: 'model-created', language })
  void load().then((saved) => {
    if (saved.length > 0) model.load(saved)
  })
  return model
}

/** Whatever tab is on screen right now, in whichever window last had focus —
 * not scoped to the site tab, so this needs `<all_urls>` to actually see it. */
async function captureActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab || tab.windowId === undefined) return null
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 80
    })
    const response = await fetch(dataUrl)
    return await response.blob()
  } catch (error) {
    console.warn('[user-model] capture failed:', error)
    return null
  }
}

async function captureTick() {
  const blob = await captureActiveTab()
  // Re-read the language every tick: the service worker (and its module
  // state) can be evicted between alarms, and this is what rebuilds the
  // model correctly afterwards.
  if (blob) ensureModel(await getStudyLanguage()).addFrame(blob)
}

export async function startCalibration() {
  if (calibrating) return { ok: true }
  if (!(await canBuildUserModel())) {
    return { ok: false, error: 'Missing Google/OpenAI API key — set both in Settings' }
  }
  ensureModel(await getStudyLanguage())
  setCalibrating(true)
  chrome.alarms.create(CAPTURE_ALARM, { periodInMinutes: CAPTURE_PERIOD_SECONDS / 60 })
  // The alarm's first firing is a full period away; capture once now so
  // starting calibration doesn't feel like it did nothing at first.
  void captureTick()
  return { ok: true }
}

export function stopCalibration() {
  setCalibrating(false)
  chrome.alarms.clear(CAPTURE_ALARM)
  return { ok: true }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CAPTURE_ALARM) void captureTick()
})
