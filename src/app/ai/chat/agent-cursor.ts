import { computeContentBounds } from '@open-pencil/core/io'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import type { EditorStore } from '@/app/editor/active-store'

/**
 * Visual "presence" for the AI agent: a cursor + "Agent" nameplate that lives on
 * the canvas. While the agent works it glides to whatever node it's touching;
 * when idle it rests over the design and drifts in a small orbit so it feels
 * alive. Rendered by the existing remote-cursor overlay (it reads
 * store.state.agentCursor) — we never create real scene nodes, so nothing here
 * touches the graph, the intervention diff, the guard, or exports.
 *
 * Each frame we call store.requestRepaint() (an overlay-only repaint that emits
 * the render event the loop actually listens to — bumping renderVersion alone is
 * NOT enough and renders choppily).
 */

const COLOR = { r: 0.49, g: 0.36, b: 0.96, a: 1 }
const FOLLOW = 0.08 // easing toward the anchor per frame
const WANDER_SCREEN_PX = 22 // orbit radius, kept constant in screen space

interface AgentCursorState {
  anchor: Vector | null
  cur: Vector | null
  rafId: number
  active: boolean
}

const states = new WeakMap<EditorStore, AgentCursorState>()
// Only one store shows the cursor at a time (avoid orphan loops on tab switch).
let shownStore: EditorStore | null = null

function getState(store: EditorStore): AgentCursorState {
  let state = states.get(store)
  if (!state) {
    state = { anchor: null, cur: null, rafId: 0, active: false }
    states.set(store, state)
  }
  return state
}

/** Center of the current page's content, or null if the page is empty. */
function contentCenter(store: EditorStore): Vector | null {
  const ids = store.graph.getChildren(store.state.currentPageId).map((n) => n.id)
  if (ids.length === 0) return null
  const bounds = computeContentBounds(store.graph, ids)
  if (!bounds) return null
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
}

function frame(store: EditorStore, state: AgentCursorState, t: number): void {
  if (!state.active) return

  if (state.anchor) {
    if (!state.cur) state.cur = { ...state.anchor }
    state.cur.x += (state.anchor.x - state.cur.x) * FOLLOW
    state.cur.y += (state.anchor.y - state.cur.y) * FOLLOW

    const amp = WANDER_SCREEN_PX / (store.state.zoom || 1)
    store.state.agentCursor = {
      name: 'Agent',
      color: COLOR,
      x: state.cur.x + amp * Math.sin(t / 900),
      y: state.cur.y + amp * Math.cos(t / 1300)
    }
    store.requestRepaint()
  }

  state.rafId = requestAnimationFrame((next) => frame(store, state, next))
}

/** Point the agent cursor at a node (called as the agent touches nodes). */
export function setAgentCursorTarget(store: EditorStore, nodeId: string): void {
  const node = store.graph.getNode(nodeId)
  if (!node) return
  const pos = store.graph.getAbsolutePosition(nodeId)
  getState(store).anchor = { x: pos.x + node.width / 2, y: pos.y + node.height / 2 }
}

/** Show the agent cursor and keep it alive (idempotent). */
export function showAgentCursor(store: EditorStore): void {
  if (typeof requestAnimationFrame === 'undefined') return
  if (shownStore && shownStore !== store) hideAgentCursor(shownStore)
  shownStore = store
  const state = getState(store)
  if (!state.anchor) state.anchor = contentCenter(store)
  if (state.active) return
  state.active = true
  state.rafId = requestAnimationFrame((t) => frame(store, state, t))
}

/** Stop and clear the agent cursor. */
export function hideAgentCursor(store: EditorStore): void {
  const state = getState(store)
  state.active = false
  if (state.rafId) cancelAnimationFrame(state.rafId)
  state.rafId = 0
  state.anchor = null
  state.cur = null
  store.state.agentCursor = null
  store.requestRepaint()
  if (shownStore === store) shownStore = null
}
