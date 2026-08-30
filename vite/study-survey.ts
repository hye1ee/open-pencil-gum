import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

import type { Plugin } from 'vite'

/**
 * Dev-only persistence for the study: the user-model baseline captured at
 * injection time, and the end-of-session survey submissions. Files live under
 * `captures/study/<participantId>/` so one participant's four condition runs
 * sit side by side.
 */
const BASELINE_ENDPOINT = '/__study-baseline'
const SURVEY_ENDPOINT = '/__study-survey'
const OUT_DIR = 'captures/study'

const SEGMENT_PATTERN = /^[a-z0-9-]{1,64}$/

interface StudyFileIdentity {
  participantId?: unknown
  host?: unknown
  condition?: unknown
}

function collectBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => res(Buffer.concat(chunks).toString()))
    req.on('error', rej)
  })
}

function validSegment(value: unknown): value is string {
  return typeof value === 'string' && SEGMENT_PATTERN.test(value)
}

export function studySurveyPlugin(root: string): Plugin {
  const outDir = resolve(root, OUT_DIR)

  function participantDirFor(participantId: string): string | null {
    const dir = resolve(outDir, participantId)
    return dir.startsWith(outDir + sep) ? dir : null
  }

  function fileTargets(identity: StudyFileIdentity): { dir: string; baseName: string } | null {
    if (
      !validSegment(identity.participantId) ||
      !validSegment(identity.host) ||
      !validSegment(identity.condition)
    ) {
      return null
    }
    const dir = participantDirFor(identity.participantId)
    if (!dir) return null
    return { dir, baseName: `${identity.host}-${identity.condition}` }
  }

  return {
    name: 'open-pencil-study-survey',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(BASELINE_ENDPOINT, (req, res) => {
        if (req.method === 'GET') {
          const query = new URL(req.url ?? '', 'http://localhost').searchParams
          const targets = fileTargets({
            participantId: query.get('participant') ?? undefined,
            host: query.get('host') ?? undefined,
            condition: query.get('condition') ?? undefined
          })
          if (!targets) {
            res.statusCode = 400
            res.end()
            return
          }
          const file = resolve(targets.dir, `${targets.baseName}-baseline.json`)
          if (!existsSync(file)) {
            res.statusCode = 404
            res.end()
            return
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(readFileSync(file, 'utf8'))
          return
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        void collectBody(req)
          .then((body) => {
            const identity = JSON.parse(body) as StudyFileIdentity
            const targets = fileTargets(identity)
            if (!targets) {
              res.statusCode = 400
              res.end('participantId, host, and condition must match [a-z0-9-]{1,64}')
              return
            }
            mkdirSync(targets.dir, { recursive: true })
            writeFileSync(resolve(targets.dir, `${targets.baseName}-baseline.json`), body)
            res.statusCode = 204
            res.end()
          })
          .catch((e: unknown) => {
            res.statusCode = 500
            res.end(String(e))
          })
      })

      server.middlewares.use(SURVEY_ENDPOINT, (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        void collectBody(req)
          .then((body) => {
            const identity = JSON.parse(body) as StudyFileIdentity
            const targets = fileTargets(identity)
            if (!targets) {
              res.statusCode = 400
              res.end('participantId, host, and condition must match [a-z0-9-]{1,64}')
              return
            }
            const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
            mkdirSync(targets.dir, { recursive: true })
            writeFileSync(
              resolve(targets.dir, `${targets.baseName}-survey-${timestamp}.json`),
              body
            )
            res.statusCode = 204
            res.end()
          })
          .catch((e: unknown) => {
            res.statusCode = 500
            res.end(String(e))
          })
      })
    }
  }
}
