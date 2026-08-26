const STATUS_KEY = '__status'
const STATUS_LABELS = {
  idle: 'idle',
  'received-data': 'received data',
  'received-data-request': 'received data request',
  'proceed-data-request': 'proceed data request'
}

const statusEl = document.getElementById('status')
const dataEl = document.getElementById('data')
const generateInitialButton = document.getElementById('generate-initial')
const exportButton = document.getElementById('export')
const restartButton = document.getElementById('restart')

function render(items) {
  const status = items[STATUS_KEY] || 'idle'
  statusEl.dataset.status = status
  statusEl.textContent = STATUS_LABELS[status] || status

  // Everything but the reserved key is the actual data the site has stored.
  const data = { ...items }
  delete data[STATUS_KEY]
  dataEl.textContent = JSON.stringify(data, null, 2)
}

chrome.storage.local.get(null, render)

// The popup only exists while open, so live updates matter here in a way they
// wouldn't for a persistent page.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area !== 'local') return
  chrome.storage.local.get(null, render)
})

// Colon-free, so the filename is valid on every OS, not just the ones that
// allow it in a name.
function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function exportData(items) {
  const data = { ...items }
  delete data[STATUS_KEY]
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `usermodel-${timestamp()}.json`
  link.click()
  URL.revokeObjectURL(url)
}

generateInitialButton.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'GENERATE_INITIAL' })
})

exportButton.addEventListener('click', () => {
  chrome.storage.local.get(null, exportData)
})

// Export first: a restart clears the data being exported, so the order can't
// flip without losing what was there.
restartButton.addEventListener('click', () => {
  chrome.storage.local.get(null, (items) => {
    exportData(items)
    chrome.runtime.sendMessage({ type: 'RESET' })
  })
})
