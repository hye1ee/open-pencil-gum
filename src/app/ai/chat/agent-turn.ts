import { reactive } from 'vue'

import { logTurnAbandoned, logTurnHeld } from '@/app/ai/chat/agent-log'

/**
 * Pause/resume gate for the agent's turn, held while the user is reading a
 * mismatch marker. A real pause, not an abort: the run stays alive and picks up
 * where it stopped. Single active agent assumed.
 *
 * It is honoured wherever the run can be held without leaving something half
 * done — between blocks of thinking, before a tool call, at a step boundary, and
 * while a change is still shown faint. A marker is a chance to catch something
 * before it lands, which is worth nothing if the canvas moves while it is being
 * read.
 */

interface AgentTurnState {
  /** True while a turn is actually in progress (chat streaming/submitted). */
  running: boolean
  paused: boolean
}

export const agentTurn: AgentTurnState = reactive({
  running: false,
  paused: false
})

let resolvers: Array<() => void> = []

/**
 * What is holding the turn still. A set rather than a flag because whoever
 * holds has to be the one who lets go: pointing at one marker while composing
 * feedback about another is ordinary, and the pointer leaving must not release
 * the composer's hold.
 *
 * - `new-mark` — a mark has just appeared and nobody has had a chance to read
 *   it yet. Held without anyone doing anything, because the alternative is that
 *   catching a mistake depends on getting a pointer onto a 16px badge before
 *   the tool call goes out.
 * - `marker` — a pointer is resting on a badge. Released when it leaves.
 * - `feedback` — the chat input is open against a mark. Released when that
 *   feedback is sent or dismissed, which can be a minute later.
 */
export type TurnHold = 'new-mark' | 'marker' | 'feedback' | 'feedback-note'

const holds = new Set<TurnHold>()

/**
 * Set when the turn is being thrown away rather than carried on.
 *
 * A hold sits inside the stream transform, downstream of the request being
 * aborted. Stopping the run cuts the connection, but the parts already received
 * are still in the transform waiting for the hold to lift — so lifting it sends
 * the held tool call on its way as if nothing had happened, which is the one
 * thing answering a marker is supposed to prevent. Measured: an answer landed,
 * the run was stopped, and the render it warned about went through in the same
 * tick. Whoever ends a held turn says so here, and the stream drops what it was
 * holding instead of forwarding it.
 */
let abandoned = false

export function abandonTurn(reason = 'unknown source'): void {
  abandoned = true
  logTurnAbandoned(`turn abandoned by ${reason} — the stream drops whatever it was holding`)
  resumeTurn()
}

/**
 * A replacement turn is being sent, so the abandoned one is over.
 *
 * Called at the send rather than from the running-state watch. `stop()` returns
 * once the abort is signalled, not once the run has wound down: measured, the
 * old turn's `END` arrived 1.1s after the new one had already started, so
 * `status` never left 'streaming' and the watch never fired between the two.
 * The new turn then read the flag and killed itself on its first chunk.
 */
export function forgetAbandonedTurn(): void {
  abandoned = false
}

/** Mirror the chat's running state; clearing it also lifts any pause. */
export function setTurnRunning(running: boolean): void {
  agentTurn.running = running
  if (running) abandoned = false
  else resumeTurn()
}

export function pauseTurn(hold: TurnHold): void {
  holds.add(hold)
  agentTurn.paused = true
}

/** Let go of one hold, or of all of them when called without one — which is
 * what a new turn and a finished turn both want. */
export function resumeTurn(hold?: TurnHold): void {
  if (hold) holds.delete(hold)
  else holds.clear()
  if (holds.size > 0) return
  agentTurn.paused = false
  const pending = resolvers
  resolvers = []
  for (const resolve of pending) resolve()
}

export function isTurnPaused(): boolean {
  return agentTurn.paused
}

/**
 * Resolves immediately unless paused, in which case it waits for resume.
 *
 * False means the turn was abandoned while held and the caller should drop
 * whatever it was about to do, rather than carry on where it left off.
 *
 * `where` names the point in the run so the log can show which of them actually
 * stopped. A hold that never appears in the log is a hold that was never
 * reached — which is the difference between a paused run and a run that only
 * looks paused because the canvas has nothing left to draw.
 */
export function awaitTurnResume(where: string): Promise<boolean> {
  if (abandoned) return Promise.resolve(false)
  if (!agentTurn.paused) return Promise.resolve(true)
  const since = Date.now()
  return new Promise((resolve) => {
    resolvers.push(() => {
      logTurnHeld(where, Date.now() - since)
      resolve(!abandoned)
    })
  })
}
