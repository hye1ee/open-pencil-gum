import { AI_ACTIVE_COLOR } from '@open-pencil/core/constants'
import type { Color, Vector } from '@open-pencil/scene-graph/primitives'

import { clearAgentSpeech } from '@/app/ai/chat/agent-speech'
import { agentTurn } from '@/app/ai/chat/agent-turn'
import type { EditorStore } from '@/app/editor/active-store'

/**
 * Visual "presence" for the AI agent: a cursor + "Agent" nameplate that lives on
 * the canvas. While the agent is running a turn it tracks whatever node it's
 * building; when idle it rests at the center of the user's current view —
 * always visible on screen, wherever the user has panned/zoomed. Rendered by the existing remote-cursor overlay (it reads
 * store.state.agentCursor) — we never create real scene nodes, so nothing here
 * touches the graph, the intervention diff, the guard, or exports.
 *
 * It only ever moves toward something. An earlier version drifted in a small
 * orbit to feel alive, but a cursor circling on its own — including between
 * actions, which is most of a step — reads as a loading spinner.
 *
 * So the sign that it is working is colour and nothing else: while a turn is
 * advancing the arrow is the blue the agent already uses on the node it is
 * touching, and violet otherwise. Position stays honest — it points where the
 * work is, and stands still when there is none.
 *
 * It used to beat between the two colours and swell a halo with it. Too loud
 * next to everything else on the canvas, and the swell dragged the nameplate.
 *
 * Nothing here answers the pointer. The cursor used to be draggable, and
 * grabbing it paused the turn; pointing at a mismatch marker does that now, and
 * does it at every point in a run rather than only at a step boundary.
 *
 * Each frame we call store.requestRepaint() (an overlay-only repaint that emits
 * the render event the loop actually listens to — bumping renderVersion alone is
 * NOT enough and renders choppily).
 */

/** Where the cursor sits when it has nothing to do. */
const RESTING_COLOR: Color = { r: 0.49, g: 0.36, b: 0.96, a: 1 }
const FOLLOW = 0.08 // easing toward the goal per frame

/**
 * How fast the working colour arrives and fades, per frame — about 0.3s either
 * way. Not instant: a turn restarted after someone answered a marker stops and
 * starts again within a second, and a hard switch would blink at exactly the
 * moment the person is reading.
 */
const ENERGY_FOLLOW = 0.15

interface AgentCursorState {
  nodeAnchor: Vector | null // node the agent is currently building (world space)
  cur: Vector | null // eased position (world space)
  /** 0 resting, 1 working. Eased, so the colour crosses rather than snaps. */
  energy: number
  rafId: number
  active: boolean
}

function mixColor(from: Color, to: { r: number; g: number; b: number }, t: number): Color {
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
    a: 1
  }
}

const states = new WeakMap<EditorStore, AgentCursorState>()
// Only one store shows the cursor at a time (avoid orphan loops on tab switch).
let shownStore: EditorStore | null = null

function getState(store: EditorStore): AgentCursorState {
  let state = states.get(store)
  if (!state) {
    state = {
      nodeAnchor: null,
      cur: null,
      energy: 0,
      rafId: 0,
      active: false
    }
    states.set(store, state)
  }
  return state
}

/** Center of the user's current viewport, in world space (always on screen). */
function viewportCenter(store: EditorStore): Vector {
  const { width, height } = store.getViewportSize()
  return store.screenToCanvas(width / 2, height / 2)
}

function frame(store: EditorStore, state: AgentCursorState): void {
  if (!state.active) return
  const next = () => {
    state.rafId = requestAnimationFrame(() => frame(store, state))
  }

  // Paused: freeze wherever it is, so the thing being read stays put.
  if (!agentTurn.paused) {
    // While the agent is actually running a turn it tracks the node it's
    // building; idle, it rests in the middle of whatever the user is looking at.
    const goal: Vector =
      agentTurn.running && state.nodeAnchor ? state.nodeAnchor : viewportCenter(store)

    if (!state.cur) state.cur = { ...goal }
    state.cur.x += (goal.x - state.cur.x) * FOLLOW
    state.cur.y += (goal.y - state.cur.y) * FOLLOW
  }

  // Working means a turn is actually advancing, not merely open. A held turn has
  // stopped for the person to read a marker, and a cursor still blue through
  // that would contradict the frozen position right above.
  const working = agentTurn.running && !agentTurn.paused
  state.energy += ((working ? 1 : 0) - state.energy) * ENERGY_FOLLOW

  if (!state.cur) {
    next()
    return
  }

  // No `emphasis`: that is the halo and the size swell, and the colour says the
  // same thing without moving anything.
  store.state.agentCursor = {
    name: 'Agent',
    // The blue the agent already uses to mark what it is touching, so "this is
    // the agent working" is one colour across the canvas.
    color: mixColor(RESTING_COLOR, AI_ACTIVE_COLOR, state.energy),
    x: state.cur.x,
    y: state.cur.y
  }
  store.requestRepaint()

  next()
}

/** Point the agent cursor at a node (called as the agent touches nodes). */
export function setAgentCursorTarget(store: EditorStore, nodeId: string): void {
  const node = store.graph.getNode(nodeId)
  if (!node) return
  const pos = store.graph.getAbsolutePosition(nodeId)
  const state = getState(store)
  state.nodeAnchor = { x: pos.x + node.width / 2, y: pos.y + node.height / 2 }
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
  state.rafId = requestAnimationFrame(() => frame(store, state))
}

/** Stop and clear the agent cursor. */
export function hideAgentCursor(store: EditorStore): void {
  const state = getState(store)
  state.active = false
  if (state.rafId) cancelAnimationFrame(state.rafId)
  state.rafId = 0
  state.nodeAnchor = null
  state.cur = null
  state.energy = 0
  store.state.agentCursor = null
  clearAgentSpeech() // no bubble floating where the cursor used to be
  store.requestRepaint()
  if (shownStore === store) shownStore = null
}
