import {
  getGoogleApiKey,
  getOpenaiApiKey,
  setGoogleApiKey,
  setOpenaiApiKey
} from './user-model/calls.js'
import { getPid, setPid } from './user-model/storage.js'

/** Flip to false to let the digit suffix be edited; everything else already
 * treats the id as ordinary input. */
const PID_LOCKED = true

const STATUS_KEY = '__status'
const CALIBRATING_KEY = '__calibrating'
const STATUS_LABELS = {
  idle: 'idle',
  'received-data': 'received data',
  'received-data-request': 'received data request',
  'proceed-data-request': 'proceed data request'
}

const mainView = document.getElementById('main-view')
const settingsView = document.getElementById('settings-view')
const openSettingsButton = document.getElementById('open-settings')
const closeSettingsButton = document.getElementById('close-settings')

const statusEl = document.getElementById('status')
const dataLabelEl = document.getElementById('data-label')
const dataEl = document.getElementById('data')
const pidSuffixInput = document.getElementById('pid-suffix')
const googleApiKeyInput = document.getElementById('google-api-key')
const openaiApiKeyInput = document.getElementById('openai-api-key')
const calibrationHint = document.getElementById('calibration-hint')
const calibrationStateEl = document.getElementById('calibration-state')
const startButton = document.getElementById('start-calibration')
const stopButton = document.getElementById('stop-calibration')
const exportButton = document.getElementById('export')
const restartButton = document.getElementById('restart')

let calibrating = false

function openSettings() {
  mainView.hidden = true
  settingsView.hidden = false
}

function closeSettings() {
  settingsView.hidden = true
  mainView.hidden = false
}

openSettingsButton.addEventListener('click', openSettings)
closeSettingsButton.addEventListener('click', closeSettings)
calibrationHint.addEventListener('click', openSettings)

// Anything reserved (`__`-prefixed) is internal state, not site data.
function siteData(items) {
  return Object.fromEntries(Object.entries(items).filter(([key]) => !key.startsWith('__')))
}

/** A proposition's embeddings are 512 floats each — real ones would flood this
 * small preview. Display-only: the export and the stored data keep them. */
function withoutEmbeddings(proposition) {
  const { embedding: _embedding, originalEmbedding: _originalEmbedding, ...rest } = proposition
  return rest
}

function fullPid() {
  return `P${pidSuffixInput.value.trim() || '0'}`
}

function updateDataLabel() {
  dataLabelEl.textContent = `${fullPid()}'s user model`
}

/** All three fields have to be filled before calibration can start. Called on
 * every keystroke as well as on storage updates, since `render` alone would
 * only react after a field is committed. */
function updateButtons() {
  const ready =
    pidSuffixInput.value.trim() !== '' &&
    googleApiKeyInput.value.trim() !== '' &&
    openaiApiKeyInput.value.trim() !== ''
  calibrationHint.hidden = ready
  startButton.disabled = calibrating || !ready
  stopButton.disabled = !calibrating
}

function render(items) {
  const status = items[STATUS_KEY] || 'idle'
  statusEl.dataset.status = status
  statusEl.textContent = STATUS_LABELS[status] || status

  const data = siteData(items)
  if (Array.isArray(data.user_model?.propositions)) {
    data.user_model = {
      ...data.user_model,
      propositions: data.user_model.propositions.map(withoutEmbeddings)
    }
  }
  dataEl.textContent = JSON.stringify(data, null, 2)

  calibrating = items[CALIBRATING_KEY] === true
  calibrationStateEl.textContent = calibrating ? 'running' : 'off'
  calibrationStateEl.dataset.calibrating = String(calibrating)
  updateButtons()
}

chrome.storage.local.get(null, render)

void getPid().then((pid) => {
  pidSuffixInput.value = pid.replace(/^P/, '')
  pidSuffixInput.disabled = PID_LOCKED
  updateDataLabel()
  updateButtons()
})

void getGoogleApiKey().then((key) => {
  googleApiKeyInput.value = key
  updateButtons()
})

void getOpenaiApiKey().then((key) => {
  openaiApiKeyInput.value = key
  updateButtons()
})

// The popup only exists while open, so live updates matter here in a way they
// wouldn't for a persistent page.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area !== 'local') return
  chrome.storage.local.get(null, render)
})

pidSuffixInput.addEventListener('input', () => {
  // Digits only — the "P" prefix is fixed, this is just what follows it.
  pidSuffixInput.value = pidSuffixInput.value.replace(/\D/g, '')
  updateDataLabel()
  updateButtons()
})

pidSuffixInput.addEventListener('change', () => {
  void setPid(fullPid())
})

googleApiKeyInput.addEventListener('input', updateButtons)
googleApiKeyInput.addEventListener('change', () => {
  void setGoogleApiKey(googleApiKeyInput.value.trim())
})

openaiApiKeyInput.addEventListener('input', updateButtons)
openaiApiKeyInput.addEventListener('change', () => {
  void setOpenaiApiKey(openaiApiKeyInput.value.trim())
})

startButton.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'START_CALIBRATION' }, (result) => {
    if (result && result.ok === false) {
      calibrationStateEl.textContent = result.error ?? 'failed to start'
    }
  })
})

stopButton.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_CALIBRATION' })
})

// Colon-free, so the filename is valid on every OS, not just the ones that
// allow it in a name.
function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function exportData(items) {
  // Full fidelity here, embeddings included — unlike the in-popup preview,
  // this is meant to be a real backup of what was captured.
  const pid = await getPid()
  const blob = new Blob([JSON.stringify(siteData(items), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `usermodel-${pid}-${timestamp()}.json`
  link.click()
  URL.revokeObjectURL(url)
}

exportButton.addEventListener('click', () => {
  chrome.storage.local.get(null, (items) => {
    void exportData(items)
  })
})

// Export first: a restart clears the data being exported, so the order can't
// flip without losing what was there.
restartButton.addEventListener('click', () => {
  chrome.storage.local.get(null, (items) => {
    void exportData(items).then(() => {
      chrome.runtime.sendMessage({ type: 'RESET' })
    })
  })
})
