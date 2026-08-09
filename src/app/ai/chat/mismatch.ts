import { reactive } from 'vue'

import { logMarkHover, logMarkRelease } from '@/app/ai/chat/agent-log'
import { agentTurn, pauseTurn, resumeTurn } from '@/app/ai/chat/agent-turn'
import { getActiveEditorStore } from '@/app/editor/active-store'
import type { EditorStore } from '@/app/editor/active-store'
import { isWarning } from '@/app/meta-agent/judge'
import type { Mark } from '@/app/meta-agent/judge'

/**
 * The marks the meta-agent has standing, mirrored where the canvas can see them.
 *
 * The list is owned by the meta-agent, not built here: it answers in actions
 * against marks that persist, so a mark has an identity that outlives any one
 * answer and this file must not invent one of its own. All that happens here is
 * the mirror, plus dropping marks whose node has since gone.
 *
 * Two kinds, told apart by whether any note cites a proposition:
 *
 * - a warning rests on something we believe, and is a chance to stop a change
 *   before it lands. It comes off once the change has stood.
 * - a question rests on nothing we believe, and asks what this person would want
 *   somewhere we have no idea. The change landing does not answer it — seeing
 *   the result is what makes it answerable — so it stays until the turn ends.
 *
 * `importance` is the meta-agent's own call, 1-10, and drives both the badge
 * colour and the glow. There is deliberately no count of how often something was
 * raised: repetition is an input to how much a thing matters, not a second
 * number for the person to weigh against the first.
 */

/** Beyond a handful the canvas is more warning than design. A backstop only —
 * the meta-agent caps its own questions, and warnings retire on their own. */
const MAX_MARKS = 8

/** How long a new warning glows before it settles back to just a badge. */
const INTRO_MS = 2600

const state = reactive<{ marks: Mark[]; hovered: string | null; intro: string[] }>({
  marks: [],
  hovered: null,
  intro: []
})

/** Read-only view for the overlay. */
export const mismatch = state

/** Whether the whole canvas, or a particular preview, carries a warning. */
export function hasWarnings(nodeIds?: readonly string[]): boolean {
  if (!nodeIds) return state.marks.some(isWarning)
  const targets = new Set(nodeIds)
  return state.marks.some(
    (mark) => isWarning(mark) && mark.nodeId !== null && targets.has(mark.nodeId)
  )
}

/**
 * Which marks are lit up on the canvas right now.
 *
 * Not all of them: a glow around everything the meta-agent has ever said turns
 * the page into a warning board and stops meaning anything. A warning flares
 * when it appears, so it is not missed, then leaves a badge behind; pointing at
 * the badge lights it again, which is also what tells you which node the badge
 * belongs to. Questions never glow — they are not asking you to stop.
 */
function lit(mark: Mark): boolean {
  return isWarning(mark) && (state.hovered === mark.id || state.intro.includes(mark.id))
}

function sync(store: EditorStore): void {
  const anchored = state.marks.filter(
    (mark): mark is Mark & { nodeId: string } => mark.nodeId !== null && lit(mark)
  )
  store.aiSetMismatch(anchored.map((mark) => [mark.nodeId, mark.importance]))
}

/**
 * How long after the pointer leaves a badge before the agent starts again.
 *
 * Not zero: the pointer slides off a 16px badge on the way to the next one, or
 * on the way to the node it is about, and restarting the build in that gap
 * means the thing being read moves out from under the reader.
 */
const RESUME_DELAY_MS = 2000

let releaseTimer: ReturnType<typeof setTimeout> | null = null
/** When the pointer landed, so the log can say how long the run was held. */
let hoverStarted = 0

function cancelRelease(): void {
  if (releaseTimer === null) return
  clearTimeout(releaseTimer)
  releaseTimer = null
}

function letGo(store: EditorStore): void {
  cancelRelease()
  if (state.hovered === null) return
  logMarkRelease(state.hovered, Date.now() - hoverStarted)
  state.hovered = null
  resumeTurn('marker')
  sync(store)
}

/**
 * The pointer moved onto or off a badge.
 *
 * Pointing at a mark stops the agent. A mark is a chance to catch something
 * before it lands, and that is worth nothing if the canvas keeps changing while
 * it is being read — by the time the sentence is finished the step it warned
 * about is done.
 *
 * Leaving does not take the glow down straight away. It comes down when the run
 * actually restarts, because a mark that looks finished while the run is still
 * held is the pause being invisible, which is how you end up not knowing what
 * the app is doing.
 */
export function setHoveredMark(store: EditorStore, id: string | null): void {
  if (id !== null) {
    cancelRelease()
    if (state.hovered === id) return
    state.hovered = id
    hoverStarted = Date.now()
    // Only when there is something to hold. A marker left over from a finished
    // turn would otherwise put the app in a paused state with nothing paused.
    logMarkHover(id, agentTurn.running)
    if (agentTurn.running) pauseTurn('marker')
    sync(store)
    return
  }
  if (state.hovered === null || releaseTimer !== null) return
  releaseTimer = setTimeout(() => {
    releaseTimer = null
    letGo(store)
  }, RESUME_DELAY_MS)
}

/**
 * The mark under the pointer is no longer on the list.
 *
 * Nothing else will let go for us: the badge is removed from the page while the
 * pointer is still over it, and an element that disappears out from under a
 * pointer does not reliably raise a leave event. Without this the hold is never
 * released and the whole run stops for good — and this is the likely case, not a
 * corner one, because a mark is most worth pointing at while the meta-agent is
 * still changing its mind.
 */
function releaseIfHoveredGone(store: EditorStore): void {
  if (state.hovered === null) return
  if (state.marks.some((mark) => mark.id === state.hovered)) return
  letGo(store)
}

/**
 * Mirror the meta-agent's list. Marks naming a node that no longer exists are
 * dropped here rather than at the renderer: the badge would otherwise float over
 * empty canvas, and the meta-agent works from a listing that can be a step old.
 */
export function setMarks(store: EditorStore, marks: Mark[]): void {
  const known = new Set(state.marks.map((mark) => mark.id))
  const valid = marks.filter((mark) => mark.nodeId === null || store.graph.getNode(mark.nodeId))
  state.marks = valid.slice(Math.max(0, valid.length - MAX_MARKS))
  releaseIfHoveredGone(store)

  for (const mark of state.marks) {
    if (known.has(mark.id) || !isWarning(mark)) continue
    state.intro = [...state.intro, mark.id]
    // A plain timeout, not a vueuse timer: this is module state with no
    // component to scope to, and it must keep running while the user is looking
    // at a different panel.
    setTimeout(() => {
      state.intro = state.intro.filter((id) => id !== mark.id)
      sync(store)
    }, INTRO_MS)
  }
  sync(store)
}

export function clearMarks(store: EditorStore): void {
  if (state.marks.length === 0) return
  state.marks = []
  state.intro = []
  letGo(store)
  store.aiClearMismatch()
}

/** Drop marks whose nodes are gone, so nothing glows around a deleted node. */
export function pruneMarks(store: EditorStore): void {
  const alive = state.marks.filter(
    (mark) => mark.nodeId === null || store.graph.getNode(mark.nodeId)
  )
  if (alive.length === state.marks.length) return
  state.marks = alive
  releaseIfHoveredGone(store)
  sync(store)
}

// Dev handle so the badges and the glow can be driven without a model call:
//   __mismatch.set([{ id: 'm1', nodeId: '0:3', importance: 7,
//                     notes: [{ text: 'wants a shadow · you use thin borders',
//                               evidence: { basedOn: 'flat', quote: '' } }] }])
if (import.meta.env.DEV) {
  Object.assign(window, {
    __mismatch: {
      set: (marks: Mark[]) => {
        setMarks(getActiveEditorStore(), marks)
      },
      clear: () => {
        clearMarks(getActiveEditorStore())
      },
      marks: () => state.marks,
      /** Ids on the current page, so a mark can be aimed without the chat. */
      pageNodes: () => {
        const store = getActiveEditorStore()
        return store.graph.getChildren(store.state.currentPageId).map((node) => node.id)
      }
    }
  })
}
