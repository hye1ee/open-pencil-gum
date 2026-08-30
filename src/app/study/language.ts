/**
 * Study language switch. With VITE_STUDY_LANGUAGE=korean every participant-
 * facing LLM output (propositions, rationales, feedback notes, drafts) gets a
 * one-line instruction to answer in Korean when the input is Korean. Unset or
 * any other value leaves every prompt byte-identical to its English-era form.
 * Keep this in sync with the language the browser extension writes its
 * propositions in.
 */
export function koreanOutputInstruction(): string {
  if (import.meta.env?.VITE_STUDY_LANGUAGE !== 'korean') return ''
  return '\n\nIf the input is in Korean, write your output in Korean.'
}

/** The frames rationale prompt hardcodes an English-only sentence; in the
 * Korean study that directive must flip with the rest of the model. */
export function frameRationaleLanguageSentence(): string {
  if (import.meta.env?.VITE_STUDY_LANGUAGE === 'korean') {
    return 'Write the rationale and the grounds in Korean. The propositions are in Korean and the rationale is read next to them.'
  }
  return 'Write the rationale and the grounds in English, even when the person answered in another language. The propositions are in English and the rationale is read next to them.'
}
