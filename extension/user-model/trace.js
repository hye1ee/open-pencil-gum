/**
 * Pipeline trace: what PROPOSE read off the frames, every retrieval score a
 * candidate got against the existing model (floor pass or not), and what
 * REVISE did about it. Exists to tune SIMILARITY_FLOOR for Korean — the 0.3
 * floor was chosen on English text, and whether Korean cosine similarities
 * clear it is an empirical question this log answers.
 *
 * Stored under a non-`__` key on purpose: Restart wipes it along with the
 * captured model, which is right — a new participant starts a new trace.
 */

const TRACE_KEY = 'pipeline_trace'
/** Oldest entries fall off first. One 30s batch writes a handful of entries,
 * so this covers hours of calibration well inside the storage quota. */
const TRACE_LIMIT = 2000

/** Appends are read-modify-write; chained so two batches can't lose entries. */
let writing = Promise.resolve()

export function appendTrace(entry) {
  writing = writing.then(
    () =>
      new Promise((resolve) => {
        chrome.storage.local.get(TRACE_KEY, (items) => {
          const held = Array.isArray(items[TRACE_KEY]) ? items[TRACE_KEY] : []
          held.push({ at: new Date().toISOString(), ...entry })
          chrome.storage.local.set({ [TRACE_KEY]: held.slice(-TRACE_LIMIT) }, resolve)
        })
      })
  )
  return writing
}

export function loadTrace() {
  return new Promise((resolve) => {
    chrome.storage.local.get(TRACE_KEY, (items) => {
      resolve(Array.isArray(items[TRACE_KEY]) ? items[TRACE_KEY] : [])
    })
  })
}
