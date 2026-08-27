import { AI_PULSE_PERIOD_MS } from '@open-pencil/core/constants'
import type { Color, Vector } from '@open-pencil/scene-graph/primitives'

import { metaAgentIsWorking } from '@/app/ai/chat/agent-activity'
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
 * So the sign that it is working is a soft halo rather than motion. The arrow
 * keeps its resting violet and its position stays honest — it points where the
 * work is, and stands still when there is none.
 *
 * Nothing here handles Feedback Note interaction; the note session owns the
 * intervention hold independently from this visual presence.
 *
 * Each frame we call store.requestRepaint() (an overlay-only repaint that emits
 * the render event the loop actually listens to — bumping renderVersion alone is
 * NOT enough and renders choppily).
 */

/** Where the cursor sits when it has nothing to do. */
const RESTING_COLOR: Color = { r: 0.49, g: 0.36, b: 0.96, a: 1 }
const FOLLOW = 0.08 // easing toward the goal per frame

/**
 * How fast the working state arrives and fades, per frame.
 *
 * Deliberately slow (~2s either way). A turn restarted after someone answered a
 * Feedback Note stops and starts again within a second or so, and a signal that snapped
 * off and back on would flash at exactly the moment the person is reading. At
 * this rate the pulse only dims through the handover.
 */
const ENERGY_FOLLOW = 0.06

/**
 * Peak halo at full pulse. The renderer keeps the arrow and nameplate fixed;
 * this value changes only the glow intensity.
 */
const WORKING_EMPHASIS = 0.5

interface AgentCursorState {
  nodeAnchor: Vector | null // node the agent is currently building (world space)
  cur: Vector | null // eased position (world space)
  /** 0 resting, 1 working. Eased, so the pulse fades in and out. */
  energy: number
  rafId: number
  active: boolean
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

  // A feedback hold freezes position, but it is still the same active agent
  // turn. Keep the working colour through the review so showing a Note does not
  // make the cursor briefly look idle or disconnected from the task.
  const working = agentTurn.running || agentTurn.paused || metaAgentIsWorking()
  state.energy += ((working ? 1 : 0) - state.energy) * ENERGY_FOLLOW

  if (!state.cur) {
    next()
    return
  }

  // The same period as the glow on the node being built, so the two read as one
  // heartbeat rather than two things blinking at each other.
  const phase = (performance.now() % AI_PULSE_PERIOD_MS) / AI_PULSE_PERIOD_MS
  const beat = state.energy * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2))

  store.state.agentCursor = {
    name: 'Agent',
    color: RESTING_COLOR,
    x: state.cur.x,
    y: state.cur.y,
    emphasis: beat * WORKING_EMPHASIS,
    working: state.energy,
    appearance: 'agent'
  }
  store.requestRepaint()

  next()
}

function agentCursorNodeAnchor(store: EditorStore, nodeId: string): Vector | null {
  const node = store.graph.getNode(nodeId)
  if (!node) return null
  const pos = store.graph.getAbsolutePosition(nodeId)
  return { x: pos.x + node.width / 2, y: pos.y + node.height / 2 }
}

/** Point the agent cursor at a node (called as the agent touches nodes). */
export function setAgentCursorTarget(store: EditorStore, nodeId: string): void {
  const anchor = agentCursorNodeAnchor(store, nodeId)
  if (!anchor) return
  const state = getState(store)
  state.nodeAnchor = anchor
}

/**
 * Move immediately to the decision a Feedback Note is holding for review.
 * A normal target eases while the agent works, but the turn is already paused
 * by the time a Note has a node, so easing would leave the cursor frozen at its
 * previous task position.
 */
export function focusAgentCursorTarget(store: EditorStore, nodeId: string): void {
  const anchor = agentCursorNodeAnchor(store, nodeId)
  if (!anchor) return
  const state = getState(store)
  state.nodeAnchor = anchor
  state.cur = { ...anchor }
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
  store.requestRepaint()
  if (shownStore === store) shownStore = null
}
