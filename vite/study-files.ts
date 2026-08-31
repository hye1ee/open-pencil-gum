import { resolve, sep } from 'node:path'

/**
 * Shared pieces for the dev-only study persistence endpoints
 * (vite/study-survey.ts, vite/study-metrics.ts): request-body collection,
 * participant/host/condition segment validation, and the containment-checked
 * per-participant directory under `captures/study/`.
 */
const OUT_DIR = 'captures/study'

const SEGMENT_PATTERN = /^[a-z0-9-]{1,64}$/

export const STUDY_IDENTITY_ERROR_MESSAGE =
  'participantId, host, and condition must match [a-z0-9-]{1,64}'

export interface StudyFileIdentity {
  participantId?: unknown
  host?: unknown
  condition?: unknown
}

export interface StudyFileTargets {
  dir: string
  baseName: string
}

export function collectBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => res(Buffer.concat(chunks).toString()))
    req.on('error', rej)
  })
}

export function validSegment(value: unknown): value is string {
  return typeof value === 'string' && SEGMENT_PATTERN.test(value)
}

export function createStudyFileTargets(
  root: string
): (identity: StudyFileIdentity) => StudyFileTargets | null {
  const outDir = resolve(root, OUT_DIR)

  return (identity) => {
    if (
      !validSegment(identity.participantId) ||
      !validSegment(identity.host) ||
      !validSegment(identity.condition)
    ) {
      return null
    }
    const dir = resolve(outDir, identity.participantId)
    if (!dir.startsWith(outDir + sep)) return null
    return { dir, baseName: `${identity.host}-${identity.condition}` }
  }
}
