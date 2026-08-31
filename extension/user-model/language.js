/**
 * Study language switch, the extension's counterpart to the app's
 * src/app/study/language.ts. The app reads VITE_STUDY_LANGUAGE at build time;
 * this extension has no build step, so the choice lives in
 * chrome.storage.local under `__study_language` and is set from the popup's
 * Settings view. Keep it in sync with the app's env for a given participant —
 * a Korean base model updated by English-era prompts (or the reverse) mixes
 * languages inside one model and breaks embedding retrieval.
 */

const STUDY_LANGUAGE_STORAGE_KEY = '__study_language'
const DEFAULT_STUDY_LANGUAGE = 'english'

export function getStudyLanguage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STUDY_LANGUAGE_STORAGE_KEY, (items) => {
      resolve(items[STUDY_LANGUAGE_STORAGE_KEY] || DEFAULT_STUDY_LANGUAGE)
    })
  })
}

export function setStudyLanguage(language) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STUDY_LANGUAGE_STORAGE_KEY]: language }, resolve)
  })
}

/**
 * Unconditional, unlike the app's "If the input is in Korean…" sentence. The
 * app's condition works because its inputs are the user's own words; here the
 * input is screenshots, so "the input is in Korean" never clearly holds, and
 * the toggle is already an explicit choice by the researcher.
 */
export function koreanOutputInstruction(language) {
  if (language !== 'korean') return ''
  return '\n\nWrite your output in Korean.'
}

/** Mirrors frameRationaleLanguageSentence in src/app/study/language.ts. */
export function rationaleLanguageSentence(language) {
  if (language === 'korean') {
    return 'Write the rationale and the grounds in Korean. The propositions are in Korean and the rationale is read next to them.'
  }
  return 'Write the rationale and the grounds in English, even when the person answered in another language. The propositions are in English and the rationale is read next to them.'
}
