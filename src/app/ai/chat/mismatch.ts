import { reactive } from 'vue'

import { getActiveEditorStore } from '@/app/editor/active-store'
import type { EditorStore } from '@/app/editor/active-store'

/**
 * Where the meta-agent thinks the agent is about to do something this user
 * would not want.
 *
 * The agent reasons in several chunks before it acts and each chunk is judged
 * on its own, so the same node can be flagged more than once in one turn. That
 * repetition is the signal, not noise — a node raised in three chunks out of
 * four is a stronger disagreement than one raised in passing — so this counts
 * hits rather than tracking membership, and the glow deepens with the count.
 *
 * A later chunk can also take a flag back: the agent considers an idea and
 * drops it two chunks later, and a marker for a thought it abandoned is worse
 * than no marker at all. `unflag` removes the node outright rather than
 * decrementing, because what was withdrawn is the whole claim.
 */

export interface MismatchMark {
  nodeId: string
  /** How many reasoning chunks have flagged this node this turn. */
  count: number
  /** The meta-agent's one-liners, newest last. Shown on hover. */
  notes: string[]
}

/** Beyond a handful the canvas is more warning than design. */
const MAX_MARKS = 6

const state = reactive<{ marks: MismatchMark[] }>({ marks: [] })

/** Read-only view for the overlay. */
export const mismatch = state

function sync(store: EditorStore): void {
  store.aiSetMismatch(state.marks.map((mark) => [mark.nodeId, mark.count]))
}

export function flagMismatch(store: EditorStore, nodeId: string, note: string): void {
  const existing = state.marks.find((mark) => mark.nodeId === nodeId)
  if (existing) {
    existing.count++
    // The meta-agent often restates the same objection in different words;
    // only a genuinely new sentence earns a line in the hover card.
    if (!existing.notes.includes(note)) existing.notes.push(note)
  } else {
    state.marks.push({ nodeId, count: 1, notes: [note] })
    // Oldest out first: the newest disagreement is the one still in play.
    if (state.marks.length > MAX_MARKS) state.marks.shift()
  }
  sync(store)
}

export function unflagMismatch(store: EditorStore, nodeId: string): void {
  const next = state.marks.filter((mark) => mark.nodeId !== nodeId)
  if (next.length === state.marks.length) return
  state.marks = next
  sync(store)
}

export function clearMismatch(store: EditorStore): void {
  if (state.marks.length === 0) return
  state.marks = []
  store.aiClearMismatch()
}

/** Drop marks whose nodes are gone, so nothing glows around a deleted node. */
export function pruneMismatch(store: EditorStore): void {
  const alive = state.marks.filter((mark) => store.graph.getNode(mark.nodeId))
  if (alive.length === state.marks.length) return
  state.marks = alive
  sync(store)
}

// Dev handle so the glow and the badge can be driven without a model call:
//   __mismatch.flag('node-id', 'prefers flat borders')
if (import.meta.env.DEV) {
  Object.assign(window, {
    __mismatch: {
      flag: (nodeId: string, note = 'test') => flagMismatch(getActiveEditorStore(), nodeId, note),
      unflag: (nodeId: string) => unflagMismatch(getActiveEditorStore(), nodeId),
      clear: () => clearMismatch(getActiveEditorStore()),
      marks: () => state.marks,
      /** Ids on the current page, so a flag can be aimed without the chat. */
      pageNodes: () => {
        const store = getActiveEditorStore()
        return store.graph.getChildren(store.state.currentPageId).map((node) => node.id)
      }
    }
  })
}
