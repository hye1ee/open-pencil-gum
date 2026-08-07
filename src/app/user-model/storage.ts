import type { Proposition, SavedProposition } from '@/app/user-model/pipeline'

/**
 * Where the user model is kept.
 *
 * Two files, for two questions. `captures/user-model.json` is the state — what
 * we believe about this person right now — and it is rewritten whole on every
 * change, because it is small and this is a dev tool. The per-session JSONL is
 * the history, appended beside the frames it came from, and it is the only way
 * to see how a proposition arrived at its current wording.
 */

const MODEL_ENDPOINT = '/__user-model'
const AUDIT_ENDPOINT = '/__propositions'

export function save(propositions: Proposition[]): Promise<void> {
  return fetch(MODEL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updatedAt: new Date().toISOString(), propositions }, null, 2)
  })
    .then(() => undefined)
    .catch((error: unknown) => {
      console.warn('[user-model] could not save:', error)
    })
}

interface SavedModel {
  propositions?: unknown
}

function isSaved(value: unknown): value is SavedModel {
  return typeof value === 'object' && value !== null
}

export function load(): Promise<SavedProposition[]> {
  return fetch(MODEL_ENDPOINT)
    .then((response) => (response.ok ? response.json() : null))
    .then((data: unknown) =>
      isSaved(data) && Array.isArray(data.propositions)
        ? (data.propositions as SavedProposition[])
        : []
    )
    .catch((error: unknown) => {
      console.warn('[user-model] could not load:', error)
      return []
    })
}

export function clearSaved(): Promise<void> {
  return save([])
}

/** One line per batch: what the model looked like once that batch was applied. */
export function appendAudit(sessionId: string, propositions: Proposition[]): Promise<void> {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    propositions: propositions.map((p) => ({
      id: p.id,
      text: p.text,
      confidence: p.confidence,
      decay: p.decay,
      observations: p.observations,
      revisions: p.revisions
    }))
  })
  return fetch(`${AUDIT_ENDPOINT}?session=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: line + '\n'
  })
    .then(() => undefined)
    .catch(() => undefined)
}
