import { reactive } from 'vue'

import { logTurnAbandoned, logTurnHeld } from '@/app/ai/chat/agent-log'

/**
 * Pause/resume gate for the agent's turn, held while the user reviews a
 * Feedback Note. A real pause, not an abort: the run stays alive and picks up
 * where it stopped. Single active agent assumed.
 *
 * It is honoured wherever the run can be held without leaving something half
 * done — between blocks of thinking, before a tool call, at a step boundary, and
 * while a change is still shown faint. A note is a chance to catch something
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
 * holds has to be the one who lets go. The Feedback Note session owns this hold
 * from note creation until every note in the step has been resolved.
 */
export type TurnHold = 'feedback-note'

const holds = new Set<TurnHold>()

/**
 * Every task-agent stream captures this value when it starts. Abandoning a turn
 * advances it, permanently making every stream from the previous generation
 * stale. Unlike an `abandoned` boolean, a generation cannot be cleared too soon
 * when the replacement turn starts while the old stream is still unwinding.
 */
export type TurnGeneration = number

let generation: TurnGeneration = 0

export function currentTurnGeneration(): TurnGeneration {
  return generation
}

export function abandonTurn(reason = 'unknown source'): void {
  generation += 1
  logTurnAbandoned(`turn abandoned by ${reason} — the stream drops whatever it was holding`)
  resumeTurn()
}

/**
 * Mirror the chat's running state without treating a transient ready state as
 * user consent. An active hold owns its own lifetime and must be released by
 * the feature that created it.
 */
export function setTurnRunning(running: boolean): void {
  agentTurn.running = running
  if (!running && !agentTurn.paused) resumeTurn()
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
export function awaitTurnResume(
  where: string,
  expectedGeneration: TurnGeneration
): Promise<boolean> {
  if (expectedGeneration !== generation) return Promise.resolve(false)
  if (!agentTurn.paused) return Promise.resolve(true)
  const since = Date.now()
  return new Promise((resolve) => {
    resolvers.push(() => {
      logTurnHeld(where, Date.now() - since)
      resolve(expectedGeneration === generation)
    })
  })
}
