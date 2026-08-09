import { useIntervalFn } from '@vueuse/core'
import { reactive } from 'vue'

/**
 * What the agent says *on the canvas* — a speech bubble next to the agent
 * cursor, so the user sees what it is doing without having the AI tab open.
 *
 * Two registers share the bubble. `sayAgent` is the finished line the agent
 * addressed to the user, the same text the chat shows. `streamThinking` is the
 * reasoning summary arriving token by token while it decides — shown muted,
 * because it is the agent talking to itself and may not survive to be true.
 *
 * Fed from the provider stream tap (`model-trace.ts`), not from the chat
 * component: the panel is unmounted whenever the user is on another tab, which
 * is exactly when the bubble matters. Lines replace each other and expire on
 * their own so a finished run doesn't leave a stale bubble over the canvas.
 */

export const agentSpeech = reactive<{ text: string; thinking: boolean }>({
  text: '',
  thinking: false
})

const MIN_MS = 2500
const MAX_MS = 9000
const MS_PER_CHAR = 55
/** Refreshed by every reveal, so this only fires once the bubble stops moving. */
const THINKING_LINGER_MS = 4000
/** A glance, not a transcript — the full text is still in the chat. */
const MAX_CHARS = 120

/**
 * Reveal pace. Deltas arrive far faster than anyone reads, so the bubble is
 * driven by its own clock instead of the network: ~30 chars/sec, about reading
 * speed. The buffer is what arrived; `revealed` is how much of it is on screen.
 */
const TICK_MS = 200
const CHARS_PER_TICK = 1
/** …but never lag more than this many ticks (~1.3s) behind. A block that lands
 * in one burst catches up instead of trickling out long after the agent moved on. */
const CATCHUP_TICKS = 40

/** Beat at the end of each sentence. The bubble shows one sentence at a time,
 * so without this the finished one is overwritten the instant the next
 * character lands and there is nothing to read. */
const SENTENCE_HOLD_MS = 900

/** Ceiling on how long the tool loop is held waiting for the bubble to finish.
 * Past this the reveal accelerates to land on time — a run must not stall
 * behind an animation, however slow the typing is set. Sentence beats are
 * dropped rather than rushed once the budget runs low. */
const MAX_HOLD_MS = 12000

let timer = 0
/** The reasoning block being streamed, kept whole so the tail can be recomputed
 * as more of it is revealed. */
let thinkingBuffer = ''
let revealed = 0
let blockEnded = true
/** Set while the tool loop waits: finish the remaining text by this time. */
let deadline = 0
let waiters: (() => void)[] = []
/** Sentence beat: hold until this time, and the reveal length it was taken at
 * so the same boundary isn't held twice. */
let holdUntil = 0
let heldAt = -1

const {
  pause: stopTicker,
  resume: startTicker,
  isActive: ticking
} = useIntervalFn(tick, TICK_MS, { immediate: false })

function arm(ms: number): void {
  clearTimeout(timer)
  timer = window.setTimeout(clearAgentSpeech, ms)
}

/** Let go of anyone waiting for the bubble to catch up. */
function release(): void {
  deadline = 0
  const pending = waiters
  waiters = []
  for (const resolve of pending) resolve()
}

function tick(): void {
  if (Date.now() < holdUntil) return // sitting on a finished sentence

  const backlog = thinkingBuffer.length - revealed
  if (backlog <= 0) {
    if (blockEnded) {
      stopTicker()
      release()
    }
    return
  }
  let step = Math.max(CHARS_PER_TICK, Math.ceil(backlog / CATCHUP_TICKS))
  if (deadline) {
    // The tool loop is waiting on us — spread what's left over the time left.
    const ticksLeft = Math.max(1, (deadline - Date.now()) / TICK_MS)
    step = Math.max(step, Math.ceil(backlog / ticksLeft))
  }
  revealed = Math.min(thinkingBuffer.length, revealed + step)
  const shown = thinkingBuffer.slice(0, revealed)
  const tail = streamingTail(shown)
  if (!tail) return
  agentSpeech.thinking = true
  agentSpeech.text = tail
  arm(THINKING_LINGER_MS)

  // A sentence just landed. Hold it — unless the tool loop is waiting and the
  // budget is nearly spent, in which case finishing the text wins over pacing.
  if (revealed >= thinkingBuffer.length || heldAt === revealed) return
  if (!/[.!?]["')\]]?\s*$/.test(shown)) return
  heldAt = revealed
  if (!deadline || deadline - Date.now() > SENTENCE_HOLD_MS * 2) {
    holdUntil = Date.now() + SENTENCE_HOLD_MS
  }
}

/** First meaningful line, stripped of the markdown the chat renders and we don't. */
function condense(text: string): string {
  const line = text
    .split('\n')
    .map((l) => l.replaceAll(/^[\s>#*\-•\d.]+/g, '').trim())
    .find((l) => l.length > 0)
  if (!line) return ''
  const flat = line.replaceAll(/[*_`]/g, '').replaceAll(/\s+/g, ' ').trim()
  if (flat.length <= MAX_CHARS) return flat
  const cut = flat.slice(0, MAX_CHARS)
  const space = cut.lastIndexOf(' ')
  return (space > MAX_CHARS * 0.6 ? cut.slice(0, space) : cut) + '…'
}

/**
 * The sentence currently being written. Reasoning runs to paragraphs, and a
 * bubble showing its opening line would sit frozen while text kept arriving —
 * following the tail is what makes the streaming visible.
 */
function streamingTail(text: string): string {
  const parts = text.replaceAll(/[*_`#>]/g, '').split(/(?<=[.!?])\s+|\n+/)
  const sentence = parts.findLast((part) => part.trim().length > 0)?.trim() ?? ''
  if (sentence.length <= MAX_CHARS) return sentence
  const cut = sentence.slice(-MAX_CHARS)
  const space = cut.indexOf(' ')
  return '…' + (space !== -1 && space < MAX_CHARS * 0.4 ? cut.slice(space + 1) : cut)
}

/** Show a line the agent produced. No-op for an empty/whitespace-only step. */
export function sayAgent(text: string): void {
  const message = condense(text)
  if (!message) return
  resetThinking()
  agentSpeech.thinking = false
  agentSpeech.text = message
  arm(Math.min(MAX_MS, Math.max(MIN_MS, message.length * MS_PER_CHAR)))
}

/** One reasoning delta, straight off the provider stream. Queued, not shown —
 * the ticker decides when it reaches the bubble. */
export function streamThinking(delta: string): void {
  // A new block after the last one drained starts from empty, so the buffer
  // stays one block long rather than a whole run's reasoning.
  if (blockEnded && revealed >= thinkingBuffer.length) resetThinking()
  blockEnded = false
  thinkingBuffer += delta
  // Guard: resume() restarts the interval, so calling it per delta would keep
  // pushing the next tick out and the bubble would never advance.
  if (!ticking.value) startTicker()
}

/** No more deltas coming. The ticker keeps revealing what's left, then stops;
 * the bubble fades on its own or is replaced by the agent's actual line. */
export function endThinking(): void {
  blockEnded = true
}

function resetThinking(): void {
  stopTicker()
  thinkingBuffer = ''
  revealed = 0
  blockEnded = true
  holdUntil = 0
  heldAt = -1
  release()
}

/**
 * Resolves once the bubble has caught up with everything queued. The stream tap
 * holds the next stage behind this, so the agent finishes a thought before it
 * speaks and finishes speaking before it acts. Bounded by `MAX_HOLD_MS`, which
 * the reveal accelerates to meet.
 */
export function awaitSpeechDrained(): Promise<void> {
  if (!ticking.value || (blockEnded && revealed >= thinkingBuffer.length)) {
    return Promise.resolve()
  }
  deadline ||= Date.now() + MAX_HOLD_MS
  return new Promise<void>((resolve) => {
    waiters.push(resolve)
    // Safety net: an aborted stream stops the ticker without draining, and a
    // held tool call must not outlive it.
    setTimeout(resolve, MAX_HOLD_MS + TICK_MS)
  })
}

export function clearAgentSpeech(): void {
  clearTimeout(timer)
  timer = 0
  resetThinking()
  agentSpeech.text = ''
  agentSpeech.thinking = false
}
