/**
 * Chronological trace of one agent run — user messages, interventions, tool
 * calls and their results, guard blocks, the agent's own text, and per-step
 * token usage, all on one timeline.
 *
 * The chat UI shows tool cards but not what was injected into each step, not
 * what the guard refused, and not what a call actually cost. Every diagnosis
 * made without this file has been wrong, so it exists to be read first.
 *
 * Dev-only. Lines are batched and POSTed to the Vite plugin in `vite/agent-log.ts`,
 * which appends them to `agent-log.txt` at the repo root (`tail -f` it mid-run).
 */

const ENDPOINT = '/__agent-log'
const FLUSH_MS = 300
/** Args and results are truncated to this many chars — a full JSX string would
 * bury everything else. */
const MAX_VALUE = 200
/** Width of the label column, so the timeline stays readable. */
const LABEL_WIDTH = 9
const INDENT = ' '.repeat(18)

const enabled = import.meta.env.DEV

let queue: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let runStart = 0

function post(payload: { reset?: boolean; lines?: string[] }): void {
  void fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true
  }).catch(() => {
    // The dev sink is best-effort; a logging failure must never break a run.
  })
}

function flush(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (queue.length === 0) return
  const lines = queue
  queue = []
  post({ lines })
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(flush, FLUSH_MS)
}

/** Seconds since the run started, so the log reads as a timeline rather than
 * wall-clock stamps you have to subtract by hand. */
function stamp(): string {
  const elapsed = (Date.now() - runStart) / 1000
  return elapsed.toFixed(1).padStart(6) + 's'
}

function truncate(value: unknown, max = MAX_VALUE): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text === undefined) return ''
  const flat = text.replaceAll(/\s+/g, ' ')
  return flat.length > max ? flat.slice(0, max) + `…(${flat.length})` : flat
}

function write(label: string, detail: string): void {
  if (!enabled) return
  queue.push(`${stamp()}  ${label.padEnd(LABEL_WIDTH)} ${detail}`)
  scheduleFlush()
}

/** Multi-line detail (an intervention diff, the agent's text) indented under its
 * label so it stays visually attached without losing the line breaks. */
function writeBlock(label: string, text: string): void {
  if (!enabled || !text.trim()) return
  const [first, ...rest] = text.trim().split('\n')
  write(label, first)
  for (const line of rest) queue.push(INDENT + line)
}

export function logRunStart(request: string): void {
  if (!enabled) return
  runStart = Date.now()
  queue = []
  post({ reset: true })
  write('RUN', `"${truncate(request, 300)}"`)
}

export function logRunEnd(reason: string): void {
  write('END', reason)
  flush()
}

export function logPlan(plan: string | null, updated = false): void {
  if (!plan) return
  writeBlock(updated ? 'PLAN~' : 'PLAN', plan)
}

export function logStep(stepNumber: number, parts: string[]): void {
  write(`STEP ${stepNumber}`, parts.length > 0 ? parts.join(' ') : '(nothing injected)')
}

export function logIntervention(diff: string): void {
  writeBlock('USER-EDIT', diff)
}

export function logUserMessage(text: string): void {
  writeBlock('USER-MSG', text)
}

export function logAgentText(text: string): void {
  writeBlock('AGENT', text)
}

/** The model's reasoning summary, written when the block closes — i.e. while the
 * step is still running, before the tool calls it led to. */
export function logThinking(text: string): void {
  writeBlock('THINK', text)
}

/** One line, not the prompt itself: it is ~10k chars and identical every step,
 * so the full text goes to the console once instead of burying the timeline. */
export function logSystemPrompt(chars: number): void {
  write('SYSTEM', `${chars.toLocaleString()} chars`)
}

export function logToolCall(tool: string, args: Record<string, unknown>): void {
  const pairs = Object.entries(args)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${truncate(value, 120)}`)
  write('TOOL', `${tool}  ${pairs.join(' ')}`)
}

export function logToolResult(tool: string, result: unknown, durationMs: number): void {
  write('  →', `${tool}  ${truncate(result)}  (${durationMs}ms)`)
}

export function logToolError(tool: string, error: string, durationMs: number): void {
  write('  ✗', `${tool}  ${error}  (${durationMs}ms)`)
}

/** A call the intervention guard refused. Logged distinctly from an error — the
 * whole point is to see whether a guard fix stopped a wrong block. */
export function logBlocked(tool: string, reason: string): void {
  write('  ⛔', `${tool}  ${reason}`)
}

export function logUsage(usage: {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}): void {
  const cached = usage.cacheReadTokens > 0 ? ` cache ${usage.cacheReadTokens.toLocaleString()}` : ''
  write(
    'USAGE',
    `in ${usage.inputTokens.toLocaleString()}${cached}  out ${usage.outputTokens.toLocaleString()}`
  )
}
