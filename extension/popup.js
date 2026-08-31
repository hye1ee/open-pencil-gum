import {
  getGoogleApiKey,
  getOpenaiApiKey,
  setGoogleApiKey,
  setOpenaiApiKey
} from './user-model/calls.js'
import { getStudyLanguage, setStudyLanguage } from './user-model/language.js'
import { getUserName, setUserName } from './user-model/storage.js'
import { loadTrace } from './user-model/trace.js'

const STATUS_KEY = '__status'
const CALIBRATING_KEY = '__calibrating'
const LANGUAGE_KEY = '__study_language'
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
const userNameInput = document.getElementById('user-name')
const languageField = document.getElementById('language-field')
const languageButtons = [...languageField.querySelectorAll('button')]
const googleApiKeyInput = document.getElementById('google-api-key')
const openaiApiKeyInput = document.getElementById('openai-api-key')
const calibrationHint = document.getElementById('calibration-hint')
const calibrationStateEl = document.getElementById('calibration-state')
const startButton = document.getElementById('start-session')
const endButton = document.getElementById('end-session')
const exportButton = document.getElementById('export')
const restartButton = document.getElementById('restart')
const downloadTraceButton = document.getElementById('download-trace')

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

/** Flat `{ updatedAt, propositions }`, same shape as `captures/user-model.json`
 * in the main app — never wrapped under a `user_model` key. */
function userModel(items) {
  const value = items.user_model
  return value && Array.isArray(value.propositions) ? value : { updatedAt: null, propositions: [] }
}

/** A proposition's embeddings are 512 floats each — real ones would flood this
 * small preview. Display-only: the export and the stored data keep them. */
function withoutEmbeddings(proposition) {
  const { embedding: _embedding, originalEmbedding: _originalEmbedding, ...rest } = proposition
  return rest
}

function userName() {
  return userNameInput.value.trim()
}

/** The name goes into download filenames; only path-hostile characters go. */
function filenameSafeUserName() {
  return userName().replaceAll(/[/\\:*?"<>|]/g, '-') || 'unnamed'
}

function updateDataLabel() {
  dataLabelEl.textContent = userName() === '' ? 'User model' : `${userName()}'s user model`
}

/** All three fields have to be filled before a session can start (the language
 * always has a value — English is the default). Called on every keystroke as
 * well as on storage updates, since `render` alone would only react after a
 * field is committed. */
function updateButtons() {
  const ready =
    userName() !== '' && googleApiKeyInput.value.trim() !== '' && openaiApiKeyInput.value.trim() !== ''
  calibrationHint.hidden = ready
  startButton.disabled = calibrating || !ready
  endButton.disabled = !calibrating
  // Locked while a session runs: a language flip mid-session would mix two
  // languages inside one model and break its embedding retrieval.
  for (const button of languageButtons) button.disabled = calibrating
}

function renderLanguage(language) {
  for (const button of languageButtons) {
    button.dataset.selected = String(button.dataset.language === language)
  }
}

function render(items) {
  const status = items[STATUS_KEY] || 'idle'
  statusEl.dataset.status = status
  statusEl.textContent = STATUS_LABELS[status] || status

  const model = userModel(items)
  dataEl.textContent = JSON.stringify(
    { ...model, propositions: model.propositions.map(withoutEmbeddings) },
    null,
    2
  )

  renderLanguage(items[LANGUAGE_KEY] || 'english')
  calibrating = items[CALIBRATING_KEY] === true
  calibrationStateEl.textContent = calibrating ? 'running' : 'off'
  calibrationStateEl.dataset.calibrating = String(calibrating)
  updateButtons()
}

chrome.storage.local.get(null, render)

void getUserName().then((name) => {
  userNameInput.value = name
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

userNameInput.addEventListener('input', () => {
  updateDataLabel()
  updateButtons()
})

userNameInput.addEventListener('change', () => {
  void setUserName(userName())
})

for (const button of languageButtons) {
  button.addEventListener('click', () => {
    if (calibrating) return
    renderLanguage(button.dataset.language)
    void setStudyLanguage(button.dataset.language)
  })
}

googleApiKeyInput.addEventListener('input', updateButtons)
googleApiKeyInput.addEventListener('change', () => {
  void setGoogleApiKey(googleApiKeyInput.value.trim())
})

openaiApiKeyInput.addEventListener('input', updateButtons)
openaiApiKeyInput.addEventListener('change', () => {
  void setOpenaiApiKey(openaiApiKeyInput.value.trim())
})

// Colon-free, so the filename is valid on every OS, not just the ones that
// allow it in a name.
function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/** Full fidelity, embeddings included — unlike the in-popup preview, this is a
 * real backup of what was captured. Flat like `captures/user-model.json`, plus
 * a `language` field so the file says which study language produced it. */
async function exportedUserModel(items) {
  const language = await getStudyLanguage()
  const model = userModel(items)
  return { updatedAt: model.updatedAt, language, propositions: model.propositions }
}

async function exportData(items) {
  downloadJson(await exportedUserModel(items), `usermodel-${filenameSafeUserName()}-${timestamp()}.json`)
}

exportButton.addEventListener('click', () => {
  chrome.storage.local.get(null, (items) => {
    void exportData(items)
  })
})

downloadTraceButton.addEventListener('click', () => {
  void loadTrace().then((entries) => {
    downloadJson(entries, `trace-${filenameSafeUserName()}-${timestamp()}.json`)
  })
})

startButton.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'START_CALIBRATION' }, (result) => {
    if (result && result.ok === false) {
      calibrationStateEl.textContent = result.error ?? 'failed to start'
    }
  })
})

// Stop first, then download: the file should be the model as it stood when the
// session ended, not race one last in-flight revision.
endButton.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_CALIBRATION' }, () => {
    chrome.storage.local.get(null, (items) => {
      void exportedUserModel(items).then((file) => {
        downloadJson(file, `${filenameSafeUserName()}-base-model.json`)
      })
    })
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
