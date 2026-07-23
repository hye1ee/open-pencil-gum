import type { Vector } from '@open-pencil/scene-graph/primitives'

import { clearAgentSpeech } from '@/app/ai/chat/agent-speech'
import { agentTurn } from '@/app/ai/chat/agent-turn'
import type { EditorStore } from '@/app/editor/active-store'

/**
 * Visual "presence" for the AI agent: a cursor + "Agent" nameplate that lives on
 * the canvas. While the agent is actually running a turn it tracks whatever node
 * it's building; when idle it rests at the center of the user's current view (or
 * wherever the user parked it) and drifts in a small orbit so it feels alive —
 * always visible on screen, wherever the user has panned/zoomed. Rendered by the
 * existing remote-cursor overlay (it reads store.state.agentCursor) — we never
 * create real scene nodes, so nothing here touches the graph, the intervention
 * diff, the guard, or exports.
 *
 * Each frame we call store.requestRepaint() (an overlay-only repaint that emits
 * the render event the loop actually listens to — bumping renderVersion alone is
 * NOT enough and renders choppily).
 */

const COLOR = { r: 0.49, g: 0.36, b: 0.96, a: 1 }
const FOLLOW = 0.08 // easing toward the goal per frame
const WANDER_SCREEN_PX = 22 // orbit radius, kept constant in screen space

interface AgentCursorState {
  nodeAnchor: Vector | null // node the agent is currently building (world space)
  parked: Vector | null // where the user dragged it to (world space); overrides the viewport center
  cur: Vector | null // eased position (world space)
  rafId: number
  active: boolean
}

const states = new WeakMap<EditorStore, AgentCursorState>()
// Only one store shows the cursor at a time (avoid orphan loops on tab switch).
let shownStore: EditorStore | null = null

function getState(store: EditorStore): AgentCursorState {
  let state = states.get(store)
  if (!state) {
    state = { nodeAnchor: null, parked: null, cur: null, rafId: 0, active: false }
    states.set(store, state)
  }
  return state
}

/** Center of the user's current viewport, in world space (always on screen). */
function viewportCenter(store: EditorStore): Vector {
  const { width, height } = store.getViewportSize()
  return store.screenToCanvas(width / 2, height / 2)
}

const VISIBLE_MARGIN_PX = 48 // keep the cursor (plus its wander/nameplate) clear of the edges

/** Is a world point comfortably inside the current viewport? */
function isOnScreen(store: EditorStore, p: Vector): boolean {
  const { width, height } = store.getViewportSize()
  const sx = p.x * store.state.zoom + store.state.panX
  const sy = p.y * store.state.zoom + store.state.panY
  return (
    sx >= VISIBLE_MARGIN_PX &&
    sx <= width - VISIBLE_MARGIN_PX &&
    sy >= VISIBLE_MARGIN_PX &&
    sy <= height - VISIBLE_MARGIN_PX
  )
}

function frame(store: EditorStore, state: AgentCursorState, t: number): void {
  if (!state.active) return

  // Paused: freeze wherever it is (the user is holding / has parked it).
  if (agentTurn.paused) {
    state.rafId = requestAnimationFrame((next) => frame(store, state, next))
    return
  }

  // While the agent is actually running a turn, it always tracks the node it's
  // building — no viewport blending. Otherwise (idle) it rests wherever the user
  // parked it, else the middle of whatever the user is currently looking at. A
  // park is honored only while still on screen — once the user pans it out of
  // view we drop it so the cursor rejoins them at the viewport center.
  let goal: Vector
  if (agentTurn.running && state.nodeAnchor) goal = state.nodeAnchor
  else if (state.parked && isOnScreen(store, state.parked)) goal = state.parked
  else {
    state.parked = null
    goal = viewportCenter(store)
  }

  if (!state.cur) state.cur = { ...goal }
  state.cur.x += (goal.x - state.cur.x) * FOLLOW
  state.cur.y += (goal.y - state.cur.y) * FOLLOW

  const amp = WANDER_SCREEN_PX / (store.state.zoom || 1)
  store.state.agentCursor = {
    name: 'Agent',
    color: COLOR,
    x: state.cur.x + amp * Math.sin(t / 900),
    y: state.cur.y + amp * Math.cos(t / 1300)
  }
  store.requestRepaint()

  state.rafId = requestAnimationFrame((next) => frame(store, state, next))
}

/** Move the cursor to a world position (user dragging it). Parks it there so it
 * stays put instead of springing back, and syncs the eased position so it
 * doesn't jump when the agent resumes. */
export function dragAgentCursor(store: EditorStore, x: number, y: number): void {
  const state = getState(store)
  state.parked = { x, y }
  state.cur = { x, y }
  store.state.agentCursor = { name: 'Agent', color: COLOR, x, y }
  store.requestRepaint()
}

/** Point the agent cursor at a node (called as the agent touches nodes). */
export function setAgentCursorTarget(store: EditorStore, nodeId: string): void {
  const node = store.graph.getNode(nodeId)
  if (!node) return
  const pos = store.graph.getAbsolutePosition(nodeId)
  const state = getState(store)
  state.nodeAnchor = { x: pos.x + node.width / 2, y: pos.y + node.height / 2 }
  state.parked = null // the agent is working now — release any manual park
}

/** Show the agent cursor and keep it alive (idempotent). */
export function showAgentCursor(store: EditorStore): void {
  if (typeof requestAnimationFrame === 'undefined') return
  if (shownStore && shownStore !== store) hideAgentCursor(shownStore)
  shownStore = store
  const state = getState(store)
  state.nodeAnchor = null // fresh slate: don't chase a node left over from a prior run
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
  state.nodeAnchor = null
  state.parked = null
  state.cur = null
  store.state.agentCursor = null
  clearAgentSpeech() // no bubble floating where the cursor used to be
  store.requestRepaint()
  if (shownStore === store) shownStore = null
}
