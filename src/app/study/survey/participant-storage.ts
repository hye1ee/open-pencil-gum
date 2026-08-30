import { normalizeParticipantId } from '@/app/study/survey/participant'

const STORAGE_KEY = 'study-participant-id'

export function loadStoredParticipantId(): string {
  if (!('window' in globalThis)) return ''
  try {
    return normalizeParticipantId(window.localStorage.getItem(STORAGE_KEY) ?? '')
  } catch (error) {
    console.warn('[study-survey] participant id load failed:', error)
    return ''
  }
}

export function storeParticipantId(value: string): void {
  if (!('window' in globalThis)) return
  try {
    window.localStorage.setItem(STORAGE_KEY, normalizeParticipantId(value))
  } catch (error) {
    // Storage may be unavailable (private mode); the in-memory value still works.
    console.warn('[study-survey] participant id save failed:', error)
  }
}
