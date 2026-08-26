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
 * 2. The capture cadence is driven by `chrome.alarms` at its documented
 *    one-minute minimum, not a 5-second interval. A Manifest V3 service
 *    worker's own timers do not survive being suspended, and alarms are the
 *    supported way to get a callback that does — at the cost of a batch
 *    (6 frames, unchanged from the app) taking about 6 minutes instead of 30
 *    seconds.
 *
 * No `note` on captured frames yet — there is no agent/tool history to read
 * in this extension, and the field is optional in `pipeline.js` for exactly
 * this reason.
 */

import { canBuildUserModel, modelCalls } from './calls.js'
import { createUserModel } from './pipeline.js'
import { clearSaved, load, save } from './storage.js'

export { canBuildUserModel, clearSaved }

const CAPTURE_ALARM = 'user-model-capture'
const CAPTURE_PERIOD_MINUTES = 1
export const CALIBRATING_KEY = '__calibrating'

let model = null
let calibrating = false

function setCalibrating(value) {
  calibrating = value
  chrome.storage.local.set({ [CALIBRATING_KEY]: value })
}

function ensureModel() {
  if (model) return model
  model = createUserModel({
    deps: modelCalls(),
    onChange: (propositions) => {
      void save(propositions)
    },
    onError: (error) => {
      console.warn('[user-model] pipeline failed:', error)
    }
  })
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
  if (blob) ensureModel().addFrame(blob)
}

export async function startCalibration() {
  if (calibrating) return { ok: true }
  if (!(await canBuildUserModel())) {
    return { ok: false, error: 'No OpenAI API key set' }
  }
  ensureModel()
  setCalibrating(true)
  chrome.alarms.create(CAPTURE_ALARM, { periodInMinutes: CAPTURE_PERIOD_MINUTES })
  // The alarm's first firing is a full period away; capture once now so
  // starting calibration doesn't feel like it did nothing for a minute.
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
