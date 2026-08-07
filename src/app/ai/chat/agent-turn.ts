import { reactive } from 'vue'

/**
 * Pause/resume gate for the agent's turn, driven by direct manipulation of the
 * agent cursor. When the user grabs the cursor we pause; the tool loop suspends
 * at its next step boundary (prepareStep awaits `awaitTurnResume`) — a real
 * pause, not an abort, so the run stays alive. Single active agent assumed.
 */

interface AgentTurnState {
  /** True while a turn is actually in progress (chat streaming/submitted). */
  running: boolean
  paused: boolean
  /** True once the user has been idle a moment while paused — show "Resume?". */
  askResume: boolean
}

export const agentTurn: AgentTurnState = reactive({
  running: false,
  paused: false,
  askResume: false
})

let resolvers: Array<() => void> = []

/** Mirror the chat's running state; clearing it also lifts any pause. */
export function setTurnRunning(running: boolean): void {
  agentTurn.running = running
  if (!running) resumeTurn()
}

export function pauseTurn(): void {
  agentTurn.paused = true
  agentTurn.askResume = false
}

export function resumeTurn(): void {
  agentTurn.paused = false
  agentTurn.askResume = false
  const pending = resolvers
  resolvers = []
  for (const resolve of pending) resolve()
}

/** Offer to resume (user went idle while paused). */
export function promptResume(): void {
  if (agentTurn.paused) agentTurn.askResume = true
}

export function isTurnPaused(): boolean {
  return agentTurn.paused
}

/** Resolves immediately unless paused, in which case it waits for resume. */
export function awaitTurnResume(): Promise<void> {
  if (!agentTurn.paused) return Promise.resolve()
  return new Promise((resolve) => {
    resolvers.push(resolve)
  })
}
