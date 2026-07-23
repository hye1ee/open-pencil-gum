import { reactive } from 'vue'

import { AI_ATTENTION_MAX_NODES } from '@open-pencil/core/constants'

import type { EditorStore } from '@/app/editor/active-store'

/**
 * The agent's attention: what it has declared it is paying attention to.
 *
 *   working    — nodes the AGENT is building or editing right now, set through
 *                the `set_attention` tool. Changes constantly. This is what the
 *                user sees glowing and what the close-up image shows.
 *   reference  — material the USER hands over ("build it like this one"). The
 *                agent cannot set it and must not change it; it only reads it.
 *                Sticky, because a reference stays a reference for a whole run.
 *
 * The split exists because a measured run collapsed without it: the agent was
 * told "put something in your attention to see it properly", so it put the card
 * it was copying from into the same slot as its work — and then spent nine steps
 * re-reviewing that card instead of building, rebuilding one frame three times.
 *
 * `reference` currently has no UI to fill it and is not drawn or captured. The
 * field and the injected line exist so the distinction is real in the transcript
 * before the user-facing half lands.
 *
 * Singleton, like the turn gate and the speech bubble — one active agent is
 * assumed throughout. Cleared at the start of each run and on tab switch.
 *
 * Visibility is not the same thing as membership: the set survives for the whole
 * run, but it only *draws* while the user peeks (` held) or during the short
 * auto-reveal after the agent moves it.
 */

interface AgentAttentionState {
  /** Nodes being built/edited now. Glowed, captured, capped. */
  working: string[]
  /** Nodes being worked from. Sticky across steps. */
  reference: string[]
  /** Short label from the tool call ("checking the hero spacing"). */
  note: string | null
  /** The ` key is held. */
  peeking: boolean
  /** Auto-reveal timer is alive (the agent just moved its attention). */
  revealing: boolean
}

export const agentAttention: AgentAttentionState = reactive({
  working: [],
  reference: [],
  note: null,
  peeking: false,
  revealing: false
})

/** How long a tool-driven change shows itself without the user asking. */
const REVEAL_MS = 2000

let revealTimer = 0

/**
 * Node ids the USER added or removed since the last step boundary. Reported to
 * the agent once and then cleared — same lifetime rule as the intervention diff,
 * for the same reason: a signal held longer than the moment it was news becomes
 * noise the agent re-acts on every step.
 */
const pendingUserEdits = { added: [] as string[], removed: [] as string[] }

export function isAttentionVisible(): boolean {
  return (agentAttention.peeking || agentAttention.revealing) && agentAttention.working.length > 0
}

function syncRenderer(store: EditorStore): void {
  // Only `working` is drawn. A reference glowing the same way as the work
  // surface is exactly the confusion this split exists to remove.
  store.aiSetAttention(agentAttention.working)
  store.aiSetAttentionVisible(isAttentionVisible())
}

/**
 * Replace what the agent is working on (the `set_attention` tool). Returns the
 * ids actually kept, so the tool can tell the model what it dropped.
 */
export function setAttention(store: EditorStore, working: string[], note?: string): string[] {
  const unique = [...new Set(working)].slice(0, AI_ATTENTION_MAX_NODES)
  agentAttention.working = unique
  agentAttention.note = note?.trim() || null
  // The agent moved its focus — show the user, briefly, without them asking.
  agentAttention.revealing = true
  clearTimeout(revealTimer)
  revealTimer = window.setTimeout(() => {
    agentAttention.revealing = false
    syncRenderer(store)
  }, REVEAL_MS)
  syncRenderer(store)
  return unique
}

/** True when a call would change nothing — the tool warns instead of burning a
 * step silently. Three of eight calls in a measured run were exactly this. */
export function isSameWorkingSet(working: string[]): boolean {
  const next = [...new Set(working)].slice(0, AI_ATTENTION_MAX_NODES)
  return (
    next.length === agentAttention.working.length &&
    next.every((id) => agentAttention.working.includes(id))
  )
}

/** User clicked a node while the attention was on screen. */
export function toggleAttentionNode(store: EditorStore, nodeId: string): void {
  if (agentAttention.working.includes(nodeId)) {
    agentAttention.working = agentAttention.working.filter((id) => id !== nodeId)
    pendingUserEdits.removed.push(nodeId)
  } else {
    if (agentAttention.working.length >= AI_ATTENTION_MAX_NODES) return
    agentAttention.working = [...agentAttention.working, nodeId]
    pendingUserEdits.added.push(nodeId)
  }
  syncRenderer(store)
}

/** Set the reference material. User-driven only — there is no tool for this, by
 * design: the agent choosing its own reference is what caused the collapse this
 * split fixes. Wire this to the selection/import UI when that lands. */
export function setReference(store: EditorStore, nodeIds: string[]): void {
  agentAttention.reference = [...new Set(nodeIds)].slice(0, AI_ATTENTION_MAX_NODES)
  syncRenderer(store)
}

/** The ` key went down or up. */
export function setAttentionPeek(store: EditorStore, peeking: boolean): void {
  if (agentAttention.peeking === peeking) return
  agentAttention.peeking = peeking
  syncRenderer(store)
}

export function clearAttention(store: EditorStore): void {
  clearTimeout(revealTimer)
  revealTimer = 0
  agentAttention.working = []
  agentAttention.reference = []
  agentAttention.note = null
  agentAttention.peeking = false
  agentAttention.revealing = false
  pendingUserEdits.added = []
  pendingUserEdits.removed = []
  syncRenderer(store)
}

/** `TYPE "name" (id)` — the same shape the intervention diff uses, so the model
 * reads node references identically wherever they come from. */
function nodeLabel(store: EditorStore, nodeId: string): string {
  const node = store.graph.getNode(nodeId)
  if (!node) return nodeId
  return `${node.type} "${node.name}" (${nodeId})`
}

/** Drop ids whose nodes are gone (the agent or the user deleted them) so the
 * glow and the injected line never reference a node that no longer exists. */
export function pruneAttention(store: EditorStore): void {
  const alive = (ids: string[]) => ids.filter((id) => store.graph.getNode(id))
  const working = alive(agentAttention.working)
  const reference = alive(agentAttention.reference)
  if (
    working.length === agentAttention.working.length &&
    reference.length === agentAttention.reference.length
  ) {
    return
  }
  agentAttention.working = working
  agentAttention.reference = reference
  syncRenderer(store)
}

/**
 * The `[Attention]` block for this step, or null when there's nothing to say.
 * Draining is a side effect: the user-edit line is reported exactly once.
 */
export function buildAttentionText(store: EditorStore): string | null {
  pruneAttention(store)

  const lines: string[] = []
  if (agentAttention.working.length > 0) {
    const listed = agentAttention.working.map((id) => nodeLabel(store, id)).join(', ')
    const note = agentAttention.note ? ` — ${agentAttention.note}` : ''
    lines.push(`[Attention] Working on: ${listed}${note}`)
  }
  if (agentAttention.reference.length > 0) {
    const listed = agentAttention.reference.map((id) => nodeLabel(store, id)).join(', ')
    lines.push(
      `Working from (reference, not yours to judge or change): ${listed}`
    )
  }

  const { added, removed } = pendingUserEdits
  if (added.length > 0) {
    lines.push(
      `The user just added ${added.map((id) => nodeLabel(store, id)).join(', ')} to your ` +
        `attention — they are pointing you at it. Look at it before you carry on.`
    )
  }
  if (removed.length > 0) {
    lines.push(
      `The user took ${removed.map((id) => nodeLabel(store, id)).join(', ')} out of your attention.`
    )
  }
  pendingUserEdits.added = []
  pendingUserEdits.removed = []

  return lines.length > 0 ? lines.join('\n') : null
}
