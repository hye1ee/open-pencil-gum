import { USER_MODEL_FIXTURE, userModelFixtureEnabled } from '@/app/user-model/fixture'
import type { Proposition, SavedProposition } from '@/app/user-model/pipeline'

/** Two files: `captures/user-model.json` is the state, rewritten whole on every
 * change, and the per-session JSONL is the history of how it got there. */

const MODEL_ENDPOINT = '/__user-model'
const AUDIT_ENDPOINT = '/__propositions'

export function save(propositions: Proposition[]): Promise<void> {
  if (userModelFixtureEnabled) return Promise.resolve()
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
  if (userModelFixtureEnabled) return Promise.resolve(structuredClone(USER_MODEL_FIXTURE))
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
      revisions: p.revisions,
      // The state file holds only the current wording, so without these a
      // rationale rewritten five times looks like one written once.
      rationale: p.rationale,
      rationaleGrounds: p.rationaleGrounds,
      rationaleFrom: p.rationaleFrom
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
