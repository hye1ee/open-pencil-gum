import type { Proposition } from '@/app/user-model/pipeline'
import { replaceUserModel } from '@/app/user-model/use'

/** One pasted proposition before validation; every field still untrusted. */
interface RawInjectedProposition {
  id?: unknown
  text?: unknown
  confidence?: unknown
  decay?: unknown
  reasoning?: unknown
  rationale?: unknown
  rationaleGrounds?: unknown
  rationaleFrom?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  observations?: unknown
  embedding?: unknown
  originalText?: unknown
  originalEmbedding?: unknown
  revisions?: unknown
}

/** The persisted user-model file shape, before validation. */
interface RawUserModelReplacementFile {
  propositions?: unknown
}

function isRawInjectedProposition(value: unknown): value is RawInjectedProposition {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is number => typeof item === 'number')
}

function normalizeProposition(item: unknown, index: number): Proposition {
  if (!isRawInjectedProposition(item)) {
    throw new Error(`Proposition ${index + 1} must be an object with a "text" field.`)
  }
  const text = stringOr(item.text, '').trim()
  if (text === '') {
    throw new Error(`Proposition ${index + 1} is missing a non-empty "text" field.`)
  }
  const at = new Date().toISOString()
  return {
    id: stringOr(item.id, `hands-off-injected-${index + 1}`),
    text,
    confidence: numberOr(item.confidence, 0.78),
    decay: numberOr(item.decay, 0),
    reasoning: stringOr(item.reasoning, 'Injected for the hands-off delegation session.'),
    rationale: nullableString(item.rationale),
    rationaleGrounds: nullableString(item.rationaleGrounds),
    rationaleFrom: stringArray(item.rationaleFrom),
    createdAt: stringOr(item.createdAt, at),
    updatedAt: stringOr(item.updatedAt, at),
    observations: numberOr(item.observations, 1),
    embedding: numberArray(item.embedding),
    originalText: stringOr(item.originalText, text),
    originalEmbedding: numberArray(item.originalEmbedding),
    revisions: numberOr(item.revisions, 0)
  }
}

/**
 * Accepts either the persisted user-model file shape ({ propositions: [...] })
 * or a bare array of propositions. Each entry needs at least a non-empty
 * "text"; every other field falls back to the same defaults the study
 * scenario fixtures use. Missing embeddings are fine — replaceUserModel
 * hydrates them.
 */
export function parseUserModelReplacementJson(rawJson: string): Proposition[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    throw new Error('Not valid JSON.')
  }
  let entries: unknown[] | null = null
  if (Array.isArray(parsed)) {
    entries = parsed
  } else if (typeof parsed === 'object' && parsed !== null) {
    const file: RawUserModelReplacementFile = parsed
    if (Array.isArray(file.propositions)) entries = file.propositions
  }
  if (entries === null) {
    throw new Error('Expected an array of propositions or { "propositions": [...] }.')
  }
  if (entries.length === 0) {
    throw new Error('The proposition list is empty.')
  }
  return entries.map(normalizeProposition)
}

export async function replaceUserModelFromJson(rawJson: string): Promise<number> {
  const propositions = parseUserModelReplacementJson(rawJson)
  await replaceUserModel(propositions)
  return propositions.length
}
