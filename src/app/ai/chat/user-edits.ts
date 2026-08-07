/**
 * A short, timestamped feed of the canvas edits the user made by hand,
 * published for observers other than the agent.
 *
 * `intervention.ts` is what detects them, and it *tells* the agent about each
 * one exactly once — the telling drains the queue, which is right for the agent.
 * The user model needs the same facts on its own schedule and for a different
 * reason: a screenshot cannot tell a change the user made from one the agent
 * made, and during an agent run almost everything on screen is the agent's.
 * Reading here consumes nothing, so the two observers do not compete.
 */

interface UserEditRecord {
  at: number
  text: string
}

/** Long enough to cover a capture batch; this is a live signal, not a log. */
const EDIT_MEMORY_MS = 60_000

const recent: UserEditRecord[] = []

export function recordUserEdit(text: string): void {
  const now = Date.now()
  recent.push({ at: now, text })
  while (recent.length > 0 && now - recent[0].at > EDIT_MEMORY_MS) recent.shift()
}

/** What the user changed by hand since `at`. Reading does not consume. */
export function userEditsSince(at: number): string[] {
  return recent.filter((edit) => edit.at >= at).map((edit) => edit.text)
}

export function clearUserEdits(): void {
  recent.length = 0
}
