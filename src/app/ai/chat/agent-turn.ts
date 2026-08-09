import { reactive } from 'vue'

import { logTurnHeld } from '@/app/ai/chat/agent-log'

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
 * What is holding the turn still. One thing does today — a pointer resting on a
 * marker — but it is a set rather than a flag because whoever holds has to be
 * the one who lets go: a second holder appearing later must not be released by
 * the first one leaving.
 */
export type TurnHold = 'marker'

const holds = new Set<TurnHold>()

/** Mirror the chat's running state; clearing it also lifts any pause. */
export function setTurnRunning(running: boolean): void {
  agentTurn.running = running
  if (!running) resumeTurn()
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
 * `where` names the point in the run so the log can show which of them actually
 * stopped. A hold that never appears in the log is a hold that was never
 * reached — which is the difference between a paused run and a run that only
 * looks paused because the canvas has nothing left to draw.
 */
export function awaitTurnResume(where: string): Promise<void> {
  if (!agentTurn.paused) return Promise.resolve()
  const since = Date.now()
  return new Promise((resolve) => {
    resolvers.push(() => {
      logTurnHeld(where, Date.now() - since)
      resolve()
    })
  })
}
