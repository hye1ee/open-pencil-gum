import { appendFileSync, createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'

import type { Plugin } from 'vite'

/**
 * Dev-only sink for `src/app/capture`. The browser POSTs each frame as a raw
 * binary body and we stream it to `captures/<session>/000123.webp`.
 *
 * Raw body rather than base64 JSON: a frame is hundreds of KB, and `JSON.parse`
 * on that every few seconds would stall the dev server. Metadata rides in the
 * query string, where it costs nothing.
 *
 * Security: like `/__agent-log`, this answers anything that can reach the dev
 * server, so under `vite --host` it is a remote file-write primitive — bounded
 * by the checks below to `captures/<safe>/<digits>.{png,jpg,webp}`.
 */
const ENDPOINT = '/__page-capture'
/** Per-session history of the model after each batch, JSONL beside the frames. */
const PROPOSITION_ENDPOINT = '/__propositions'
const PROPOSITION_FILE = 'propositions.jsonl'
/**
 * The user model itself. One file outside the session directories, because the
 * whole point is that it outlives any one sitting.
 */
const USER_MODEL_ENDPOINT = '/__user-model'
const USER_MODEL_FILE = 'user-model.json'
const OUT_DIR = 'captures'

const SESSION_PATTERN = /^[a-z0-9-]{1,64}$/
const INDEX_PATTERN = /^\d{1,9}$/
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
}

/** A frame this big means something is wrong; don't let it reach the disk. */
const MAX_FRAME_BYTES = 8 * 1024 * 1024

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      resolveBody(body)
    })
    req.on('error', rejectBody)
  })
}

export function pageCapturePlugin(root: string): Plugin {
  const outDir = resolve(root, OUT_DIR)
  /** Directories already created, so we don't stat on every frame. */
  const known = new Set<string>()

  function sessionDirFor(session: string): string | null {
    if (!SESSION_PATTERN.test(session)) return null
    const dir = resolve(outDir, session)
    if (!dir.startsWith(outDir + sep)) return null
    if (!known.has(dir)) {
      mkdirSync(dir, { recursive: true })
      known.add(dir)
    }
    return dir
  }

  return {
    name: 'open-pencil-page-capture',
    apply: 'serve',
    configureServer(server) {
      // The user model: GET to seed a fresh tab, POST to replace it wholesale.
      // Small enough that rewriting it every batch beats maintaining a log.
      server.middlewares.use(USER_MODEL_ENDPOINT, (req, res) => {
        const file = resolve(outDir, USER_MODEL_FILE)

        if (req.method === 'GET') {
          try {
            res.setHeader('Content-Type', 'application/json')
            res.end(readFileSync(file, 'utf8'))
          } catch {
            res.statusCode = 404
            res.end()
          }
          return
        }

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }

        readBody(req)
          .then((body) => {
            mkdirSync(outDir, { recursive: true })
            writeFileSync(file, body)
            res.statusCode = 204
            res.end()
          })
          .catch((error: unknown) => {
            res.statusCode = 500
            res.end(String(error))
          })
      })

      // Propositions inferred from the frames — one JSON object per line, so
      // the file stays appendable and readable while a session is running.
      server.middlewares.use(PROPOSITION_ENDPOINT, (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const session = new URL(req.url ?? '', 'http://localhost').searchParams.get('session') ?? ''
        const dir = sessionDirFor(session)
        if (!dir) {
          res.statusCode = 400
          res.end()
          return
        }
        readBody(req)
          .then((body) => {
            if (body.trim()) appendFileSync(resolve(dir, PROPOSITION_FILE), body)
            res.statusCode = 204
            res.end()
          })
          .catch((error: unknown) => {
            res.statusCode = 500
            res.end(String(error))
          })
      })

      server.middlewares.use(ENDPOINT, (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }

        const params = new URL(req.url ?? '', 'http://localhost').searchParams
        const session = params.get('session') ?? ''
        const index = params.get('index') ?? ''
        const extension = EXTENSIONS[(req.headers['content-type'] ?? '').split(';')[0].trim()]

        if (!INDEX_PATTERN.test(index) || !extension) {
          res.statusCode = 400
          res.end()
          return
        }

        if (Number(req.headers['content-length'] ?? 0) > MAX_FRAME_BYTES) {
          req.destroy()
          res.statusCode = 413
          res.end()
          return
        }

        // Validates the session name and creates the directory, or refuses.
        const sessionDir = sessionDirFor(session)
        if (!sessionDir) {
          res.statusCode = 400
          res.end()
          return
        }
        const file = resolve(sessionDir, `${index.padStart(6, '0')}.${extension}`)

        // Streamed, never buffered — no reason to churn the dev server's heap.
        pipeline(req, createWriteStream(file))
          .then(() => {
            res.statusCode = 204
            res.end()
          })
          .catch((error: unknown) => {
            res.statusCode = 500
            res.end(String(error))
          })
      })
    }
  }
}
