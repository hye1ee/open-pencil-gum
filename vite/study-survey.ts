import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { resolve } from 'node:path'

import type { Connect, Plugin } from 'vite'

import {
  STUDY_IDENTITY_ERROR_MESSAGE,
  collectBody,
  createStudyFileTargets
} from './study-files'
import type { StudyFileIdentity } from './study-files'

/**
 * Dev-only persistence for the study: the user-model baseline captured at
 * injection time, the updated user model archived when a session ends, the
 * end-of-session survey submissions, and the per-run output-quality surveys
 * from the hands-off condition. Files live under
 * `captures/study/<participantId>/` so one participant's four condition runs
 * sit side by side.
 */
const BASELINE_ENDPOINT = '/__study-baseline'
const FINAL_USER_MODEL_ENDPOINT = '/__study-final-user-model'
const SURVEY_ENDPOINT = '/__study-survey'
const OUTPUT_SURVEY_ENDPOINT = '/__study-output-survey'

export function studySurveyPlugin(root: string): Plugin {
  const fileTargets = createStudyFileTargets(root)

  // POST-only sink writing the body verbatim as `<host>-<condition>-<suffix>.json`,
  // overwritten on every write — same rule as the baseline: ending a session
  // twice should leave the latest state, not a pile of near-duplicates.
  function overwritingJsonPostHandler(suffix: string) {
    return (req: Connect.IncomingMessage, res: ServerResponse) => {
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
          mkdirSync(targets.dir, { recursive: true })
          writeFileSync(resolve(targets.dir, `${targets.baseName}-${suffix}.json`), body)
          res.statusCode = 204
          res.end()
        })
        .catch((e: unknown) => {
          res.statusCode = 500
          res.end(String(e))
        })
    }
  }

  // POST-only sink writing the body verbatim as
  // `<host>-<condition>-<suffix>-<timestamp>.json`; one file per submission.
  function timestampedJsonPostHandler(suffix: string) {
    return (req: Connect.IncomingMessage, res: ServerResponse) => {
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
          writeFileSync(resolve(targets.dir, `${targets.baseName}-${suffix}-${timestamp}.json`), body)
          res.statusCode = 204
          res.end()
        })
        .catch((e: unknown) => {
          res.statusCode = 500
          res.end(String(e))
        })
    }
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
              res.end(STUDY_IDENTITY_ERROR_MESSAGE)
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

      server.middlewares.use(
        FINAL_USER_MODEL_ENDPOINT,
        overwritingJsonPostHandler('final-user-model')
      )
      server.middlewares.use(SURVEY_ENDPOINT, timestampedJsonPostHandler('survey'))
      server.middlewares.use(OUTPUT_SURVEY_ENDPOINT, timestampedJsonPostHandler('output-survey'))
    }
  }
}
