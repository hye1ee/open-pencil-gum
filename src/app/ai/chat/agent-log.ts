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

/**
 * A turn that is the same piece of work carrying on — the build restarted after
 * someone answered a marker.
 *
 * Appends where `logRunStart` truncates, and keeps the clock running. Wiping
 * here would throw away the whole first half of the build, including the marks
 * and the answers that caused the restart, which is precisely the part anyone
 * reading this file afterwards needs.
 */
export function logRunContinue(request: string): void {
  write('RUN~', `"${truncate(request, 300)}"`)
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
/**
 * One line per meta-agent judgment, on the same timeline as the thinking it was
 * made about — which is the only way to tell a mark that answers the reasoning
 * from one that answers the canvas. `chars` says how much of the thought had
 * arrived when the judgment was made; a short number next to a long THINK block
 * means it judged half a sentence.
 */
export function logJudgment(chars: number, marks: string[]): void {
  if (!enabled) return
  if (marks.length === 0) {
    write('META', `${chars} chars → silent`)
    return
  }
  writeBlock('META', `${chars} chars →\n${marks.join('\n')}`)
}

export function logJudgeSkip(chars: number): void {
  write('META', `${chars} chars → skipped, a judgment was already running`)
}

export function logMarkTool(chars: number, detail: string): void {
  write('META-TOOL', `${chars} chars → ${detail}`)
}

export function logJudgeRejected(chars: number, tools: string[]): void {
  write('META-DROP', `${chars} chars → rejected ${tools.join(', ')}`)
}

export function logJudgeLifecycle(event: string): void {
  write('META-LIFE', event)
}

export function logJudgeError(error: unknown): void {
  write('META-ERR', error instanceof Error ? error.message : truncate(error))
}

/**
 * The pointer went onto or off a marker. Paired with the HELD lines below, this
 * is the only way to tell a run that really stopped from one that carried on
 * behind a frozen-looking canvas — everything else in this file is written by
 * the agent, so a hold leaves no trace of its own.
 */
export function logMarkHover(id: string, held: boolean): void {
  write('HOVER', held ? `${id} → holding the turn` : `${id} → nothing to hold, turn not running`)
}

export function logMarkRelease(id: string, ms: number): void {
  write('HOVER', `${id} released after ${(ms / 1000).toFixed(1)}s → turn resumes`)
}

/**
 * The person clicked a mark to answer it, and what became of that. Leaving a
 * mark alone counts as agreement, so these lines are the disagreements — and
 * the gap between the last `answered` line and `quiet` is the pause they took
 * before the run offered to carry on.
 */
export function logMarkAnswer(
  event: 'opened' | 'answered' | 'dismissed' | 'quiet' | 'resumed' | 'passed',
  detail: string
): void {
  write('ANSWER', `${event.padEnd(9)} ${detail}`)
}

/**
 * What the user model did with what it was told.
 *
 * Its own state lives in a file that is overwritten in place, so without this
 * there is no way to see *why* a proposition says what it says — only what it
 * ended up saying. On the same timeline as the answers that caused it.
 */
export function logUserModelStage(stage: string, detail: string): void {
  write('MODEL', `${stage.padEnd(9)} ${detail}`)
}

/** One proposition rewritten, with the wording and confidence it had before. */
export function logPropositionChange(change: {
  id: string
  before: { text: string; confidence: number } | null
  after: { text: string; confidence: number }
}): void {
  const out = (value: number) => `${(value * 9 + 1).toFixed(0)}/10`
  if (!change.before) {
    writeBlock(
      'MODEL',
      `new       ${change.id} ${out(change.after.confidence)}\n${change.after.text}`
    )
    return
  }
  if (change.before.text === change.after.text) {
    write(
      'MODEL',
      `confidence ${change.id} ${out(change.before.confidence)} → ${out(change.after.confidence)}`
    )
    return
  }
  writeBlock(
    'MODEL',
    `rewrote   ${change.id} ${out(change.before.confidence)} → ${out(change.after.confidence)}\n` +
      `was:  ${change.before.text}\n` +
      `now:  ${change.after.text}`
  )
}

/**
 * One rationale, with what it was read off.
 *
 * The grounds are here rather than only in the model file because they are how
 * this stage gets judged. A rationale drawn from propositions no note touched is
 * where invention would show up first, so `read with` is printed even when it is
 * the only interesting part of the line — and everything is printed as sentences,
 * since the ids in the model are UUIDs and say nothing to a reader.
 */
export function logRationaleChange(change: {
  text: string
  before: string | null
  after: string
  grounds: string
  readWith: string[]
}): void {
  const lines = [
    change.text,
    `why:   ${change.after}`,
    ...(change.before === null ? [] : [`was:   ${change.before}`]),
    ...(change.readWith.length === 0
      ? []
      : ['read with:', ...change.readWith.map((t) => `  · ${t}`)]),
    `because: ${change.grounds}`
  ]
  writeBlock('MODEL', `rationale ${lines.join('\n')}`)
}

/** A place in the run that actually stopped, and for how long. Written on
 * release, since that is when the duration is known. */
export function logTurnHeld(where: string, ms: number): void {
  write('HELD', `${where} — ${(ms / 1000).toFixed(1)}s`)
}

/**
 * A turn thrown away rather than resumed, and where the stream noticed.
 *
 * Both halves are needed and neither can be inferred from the other. Without
 * the first, a step that quietly ran anyway looks like the abort never fired;
 * without the second, a stream that killed itself on a stale flag looks like a
 * provider returning nothing.
 */
export function logTurnAbandoned(detail: string): void {
  write('DROP', detail)
}

/**
 * The order the provider's stream parts arrived in, one line per step.
 *
 * The beats and the hold points hang off particular part types, so which parts
 * a provider sends and in what order decides which of them exist at all. This
 * cannot be read off the rest of the timeline: a beat that never ran and a beat
 * that ran instantly look identical there.
 */
export function logStreamShape(parts: string[]): void {
  write('STREAM', parts.join(' → '))
}

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
