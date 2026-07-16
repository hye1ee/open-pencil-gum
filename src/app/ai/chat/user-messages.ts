import type { EditorStore } from '@/app/editor/active-store'

/**
 * Mid-run user-message channel (intervention channel b).
 *
 * The agent runs as one long tool loop. When the user sends a message WHILE it's
 * working, we can't route it through the normal chat turn (that would start a
 * separate request). Instead the UI drops the text into this per-store queue,
 * and the agent's prepareStep drains it at the next step boundary and injects it
 * — exactly like a canvas edit — so the remaining tool calls adapt to it.
 */

const queues = new WeakMap<EditorStore, string[]>()

function queueFor(store: EditorStore): string[] {
  let queue = queues.get(store)
  if (!queue) {
    queue = []
    queues.set(store, queue)
  }
  return queue
}

/** Queue a message the user sent mid-run (drained + injected next step). */
export function enqueueUserMessage(store: EditorStore, text: string): void {
  const trimmed = text.trim()
  if (trimmed) queueFor(store).push(trimmed)
}

/** Take and clear all queued mid-run messages. */
export function drainUserMessages(store: EditorStore): string[] {
  const queue = queueFor(store)
  if (queue.length === 0) return []
  const out = [...queue]
  queue.length = 0
  return out
}

/** Discard any queued messages (e.g. at the start of a fresh run). */
export function clearUserMessages(store: EditorStore): void {
  queueFor(store).length = 0
}

/** Wrap queued messages as an injectable instruction for the model. */
export function buildUserMessageText(messages: string[]): string {
  const joined = messages.map((m) => `"${m}"`).join('\n')
  return (
    `[User message] While you are working, the user sent you the following. Treat it as an ` +
    `updated instruction: adjust your remaining tool calls to satisfy it (on top of the original ` +
    `request), without throwing away correct work you've already done:\n${joined}`
  )
}
