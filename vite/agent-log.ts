import { appendFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Plugin } from 'vite'

/**
 * Dev-only sink for the agent trace log. The app runs in a browser/webview and
 * can't write files, so it POSTs batched lines here and we append them to
 * `agent-log.txt` at the repo root — a plain file you can `tail -f` while a run
 * is in flight.
 */
const ENDPOINT = '/__agent-log'
const LOG_FILE = 'agent-log.txt'

interface LogPayload {
  reset?: boolean
  lines?: string[]
}

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((res, rej) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => res(body))
    req.on('error', rej)
  })
}

export function agentLogPlugin(root: string): Plugin {
  const file = resolve(root, LOG_FILE)

  return {
    name: 'open-pencil-agent-log',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(ENDPOINT, (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        void readBody(req)
          .then((body) => {
            const payload = JSON.parse(body) as LogPayload
            // A new run truncates, so the file always holds exactly one run.
            if (payload.reset) writeFileSync(file, '')
            if (payload.lines?.length) appendFileSync(file, payload.lines.join('\n') + '\n')
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
