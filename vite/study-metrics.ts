import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Plugin } from 'vite'

import {
  STUDY_IDENTITY_ERROR_MESSAGE,
  collectBody,
  createStudyFileTargets
} from './study-files'
import type { StudyFileIdentity } from './study-files'

/**
 * Dev-only study metric sink. Every study event (user request, feedback
 * opportunity, feedback left) is appended to
 * `captures/study/<participantId>/<host>-<condition>-events.jsonl` the moment
 * it happens, so a mid-session refresh or crash loses nothing. The End session
 * summary lands beside it as a timestamped JSON file.
 */
const EVENTS_ENDPOINT = '/__study-metric-events'
const SUMMARY_ENDPOINT = '/__study-metric-summary'

interface StudyMetricEventEnvelope extends StudyFileIdentity {
  event?: unknown
}

interface RawStudyMetricEvent {
  type?: unknown
}

function metricEventType(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as RawStudyMetricEvent
  return typeof raw.type === 'string' ? raw.type : null
}

export function studyMetricsPlugin(root: string): Plugin {
  const fileTargets = createStudyFileTargets(root)

  return {
    name: 'open-pencil-study-metrics',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(EVENTS_ENDPOINT, (req, res) => {
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
          const file = resolve(targets.dir, `${targets.baseName}-events.jsonl`)
          if (!existsSync(file)) {
            res.statusCode = 404
            res.end()
            return
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/plain')
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
            const envelope = JSON.parse(body) as StudyMetricEventEnvelope
            const targets = fileTargets(envelope)
            if (!targets) {
              res.statusCode = 400
              res.end(STUDY_IDENTITY_ERROR_MESSAGE)
              return
            }
            if (metricEventType(envelope.event) === null) {
              res.statusCode = 400
              res.end('event must be an object with a string "type"')
              return
            }
            mkdirSync(targets.dir, { recursive: true })
            appendFileSync(
              resolve(targets.dir, `${targets.baseName}-events.jsonl`),
              JSON.stringify(envelope.event) + '\n'
            )
            res.statusCode = 204
            res.end()
          })
          .catch((e: unknown) => {
            res.statusCode = 500
            res.end(String(e))
          })
      })

      server.middlewares.use(SUMMARY_ENDPOINT, (req, res) => {
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
              res.end(STUDY_IDENTITY_ERROR_MESSAGE)
              return
            }
            const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
            mkdirSync(targets.dir, { recursive: true })
            writeFileSync(
              resolve(targets.dir, `${targets.baseName}-metrics-${timestamp}.json`),
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
