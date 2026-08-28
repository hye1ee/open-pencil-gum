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
/** Results are truncated to this many chars — most are an id and a name, and
 * the long ones are listings the canvas summary already covers. */
const MAX_VALUE = 200
/**
 * Tool arguments get far more room, because they are the change itself.
 *
 * They were cut at 120, which stopped one character into the body of a `render`
 * — enough to see that a frame was made and not what was in it. That is the
 * difference between a log you can check a judgment against and one you can
 * only read the judgment in: a Feedback Note saying the agent put a border on an input
 * could not be confirmed or refuted from this file. Only the payload arguments
 * are ever near this long; ids and names are short whatever the ceiling is.
 */
const MAX_ARG = 1600
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
 * someone answered a Feedback Note.
 *
 * Appends where `logRunStart` truncates, and keeps the clock running. Wiping
 * here would throw away the whole first half of the build, including the Notes
 * and the feedback that caused the restart, which is precisely the part anyone
 * reading this file afterwards needs.
 */
export function logRunContinue(request: string): void {
  write('RUN~', `"${truncate(request, 300)}"`)
}

export function logRunEnd(reason: string): void {
  write('END', reason)
  flush()
}

/**
 * Which model each of this app's AIs is about to call.
 *
 * Written at the top of a run because nothing else in the file says it. Working
 * out which provider was live from a finished log meant reading the order the
 * stream parts arrived in — that is a fingerprint, not a record.
 */
export function logModelRouting(lines: string[]): void {
  writeBlock('ROUTING', lines.join('\n'))
}

/**
 * The user model's propositions as the building side was told them.
 *
 * The whole block, not a count, and written on a restart as well as a start.
 * Half of what this feature promises is that answering a Feedback Note changes what the
 * agent is told next — and the only way to see that is two blocks in one run
 * that differ. A line saying "9 propositions" both times would look identical
 * whether or not the answer landed.
 */
export function logUserModelPropositions(propositions: string): void {
  writeBlock('USER-MODEL', propositions)
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

export function logFeedbackNote(
  step: number,
  position: number,
  relationship: 'alignment' | 'conflict' | 'uncovered' | null,
  representation: 'text' | 'code-visual' | 'image' | null,
  nodeId: string | null,
  detail?: string
): void {
  write(
    'NOTE',
    `step ${step}${position > 0 ? ` note ${position}` : ''} → ${relationship ? `${relationship}/${representation}` : 'skip'}${relationship ? `  ${nodeId ?? 'agent cursor'}` : ''}${detail ? `  ${detail}` : ''}`
  )
}

export function logFeedbackNoteImage(
  id: string,
  status: 'ready' | 'failed',
  detail?: string
): void {
  write('NOTE-IMG', `${id} → ${status}${detail ? `  ${detail}` : ''}`)
}

export function logFeedbackNoteCode(
  id: string,
  status: 'html' | 'svg' | 'failed',
  detail?: string
): void {
  write('NOTE-CODE', `${id} → ${status}${detail ? `  ${detail}` : ''}`)
}

/**
 * State transitions after the user reviews an Interactive Feedback Note.
 *
 * These are intentionally separate from NOTE, which records generation. A run
 * can now be checked end-to-end: what was shown, how each note was resolved,
 * and whether the held action was released or the step was retried.
 */
export function logFeedbackStep(
  step: number,
  event: 'note' | 'waiting' | 'proceed' | 'retry' | 'report',
  detail: string
): void {
  write('NOTE-STEP', `step ${step} ${event} → ${detail}`)
}

/** The lifetime of the one-retry window in which new notes are suppressed. */
export function logFeedbackReplay(
  step: number,
  event: 'started' | 'waiting' | 'completed',
  detail: string
): void {
  write('NOTE-RTRY', `step ${step} ${event} → ${detail}`)
}

export function logUserModelFeedback(
  step: number,
  event: 'queued' | 'evidence' | 'duplicate' | 'failed',
  detail: string
): void {
  write('UM-FEEDBACK', `step ${step} ${event} → ${detail}`)
}

export function logMetaAgentLifecycle(event: string): void {
  write('META-LIFE', event)
}

/** One raw LenChat provider delta sent to the shared Meta Agent. */
export function logChatMetaAgentReasoning(
  streamId: number,
  chunkIndex: number,
  reasoning: string
): void {
  writeBlock('CHAT-RSN', `stream ${streamId} chunk ${chunkIndex}\n${reasoning}`)
}

/** One LenChat Meta Agent judgment before host validation and intervention. */
export function logChatMetaAgentReview(
  streamId: number,
  chunkIndex: number,
  result: 'decision' | 'skip' | 'failed',
  detail = ''
): void {
  write(
    'CHAT-META',
    `stream ${streamId} chunk ${chunkIndex} → ${result}${detail ? `  ${detail}` : ''}`
  )
}

/** LenChat's output gate and feedback-driven retry lifecycle. */
export function logChatFeedbackLifecycle(
  event: 'note' | 'continued' | 'answered' | 'resumed' | 'retry' | 'retry-complete',
  detail: string
): void {
  write('CHAT-GATE', `${event.padEnd(14)} ${detail}`)
}

/**
 * What happened after the person reviewed the Feedback Notes for a step.
 */
export function logFeedbackAnswer(
  event: 'opened' | 'answered' | 'dismissed' | 'removed' | 'quiet' | 'resumed' | 'passed',
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
    .map(([key, value]) => `${key}=${truncate(value, MAX_ARG)}`)
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
