import { reactive } from 'vue'

import { logMarkAnswer, logMarkHover, logMarkRelease } from '@/app/ai/chat/agent-log'
import { agentTurn, pauseTurn, resumeTurn } from '@/app/ai/chat/agent-turn'
import { getActiveEditorStore } from '@/app/editor/active-store'
import type { EditorStore } from '@/app/editor/active-store'
import { isWarning } from '@/app/meta-agent/judge'
import type { Mark, MarkRelation } from '@/app/meta-agent/judge'

/**
 * A mirror of the marks the meta-agent has standing. The list is owned there, so
 * this file invents no identity of its own and only drops marks whose node has
 * gone. A warning holds the run and retires when its change stands; an alignment
 * never holds; a question waits until the turn ends. `rating` is −5 to +5, and
 * its sign picks the colour while its magnitude sets how loud the glow is.
 */

/** Beyond a handful the canvas is a noticeboard. A backstop only: the meta-agent
 * caps its own questions and the rest retire when their change lands. */
const MAX_MARKS = 8

/** How long a new warning glows before it settles back to just a badge. */
const INTRO_MS = 2600

/** Measured: a warning went up nine seconds before its tool call, was read for
 * three, and the render landed one second after the pointer left. */
const QUESTION_WINDOW_MS = 5000

/** A warning holds until read, not on a timer. The ceiling is for the machine
 * nobody is sitting at. */
const WARNING_HOLD_CEILING_MS = 60_000

/** Three marks from one chunk are three parts of one decision, so the run waits
 * for a gap rather than restarting on the first answer. */
const IDLE_MS = 3000

/** Copied at the moment of answering, since the mark can be updated after and
 * the reply belongs to the wording they saw. `quote` and `citedId` travel all
 * the way to the user model, which is the point of collecting them. */
export interface MarkAnswer {
  id: string
  nodeId: string | null
  note: string
  quote: string
  citedId: string | null
  /** Tells a reply that disputed a warning from one that disputed us saying the
   * agent had got it right. */
  relation: MarkRelation
  text: string
}

const state = reactive<{
  marks: Mark[]
  hovered: string | null
  intro: string[]
  /** The mark whose answer box is open, if any. */
  composing: string | null
  /** Answers given since the run was last held, oldest first. */
  answers: MarkAnswer[]
  /** They have gone quiet, and are being asked whether to carry on. */
  askingToResume: boolean
}>({
  marks: [],
  hovered: null,
  intro: [],
  composing: null,
  answers: [],
  askingToResume: false
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

/** Not all of them: a glow on everything stops meaning anything. A mark flares
 * when raised and again on hover, and always while it is being answered, since
 * the canvas has to say which node the sentence is about. Unknowns never flare. */
function lit(mark: Mark): boolean {
  if (state.composing === mark.id) return true
  if (state.answers.some((answer) => answer.id === mark.id)) return true
  if (mark.relation === 'unknown') return false
  return state.hovered === mark.id || state.intro.includes(mark.id)
}

function sync(store: EditorStore): void {
  const anchored = state.marks.filter(
    (mark): mark is Mark & { nodeId: string } => mark.nodeId !== null && lit(mark)
  )
  // Signed: the renderer reads the sign for colour, the magnitude for loudness.
  store.aiSetMismatch(anchored.map((mark) => [mark.nodeId, mark.rating]))
}

/** Not zero: the pointer slides off a 16px badge on the way to the next one, and
 * restarting there moves the thing being read out from under the reader. */
const RESUME_DELAY_MS = 5000

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

/** Leaving a mark alone is agreement, which is only honest if it was there to be
 * left alone. So it holds from the moment it appears until it is looked at. */
const unread = new Set<string>()
const unreadTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Only a conflict stops the run. Interrupting a build to say the agent is doing
 * the right thing is the reaction test this hold exists to avoid. */
function worthHolding(mark: Mark): boolean {
  return mark.rating < 0
}

function holdForNewMark(store: EditorStore, mark: Mark): void {
  if (!agentTurn.running || !worthHolding(mark)) return
  unread.add(mark.id)
  pauseTurn('new-mark')
  unreadTimers.set(
    mark.id,
    // A warning waits to be read; a question takes its window regardless.
    setTimeout(
      () => nowRead(store, mark.id),
      isWarning(mark) ? WARNING_HOLD_CEILING_MS : QUESTION_WINDOW_MS
    )
  )
}

function nowRead(store: EditorStore, id: string): void {
  const timer = unreadTimers.get(id)
  if (timer !== undefined) clearTimeout(timer)
  unreadTimers.delete(id)
  if (!unread.delete(id)) return
  if (unread.size === 0) resumeTurn('new-mark')
  sync(store)
}

function forgetUnread(): void {
  for (const timer of unreadTimers.values()) clearTimeout(timer)
  unreadTimers.clear()
  unread.clear()
  resumeTurn('new-mark')
}

/** Pointing at a mark stops the agent, or the step it warns about finishes while
 * it is being read. The glow comes down when the run actually restarts. */
export function setHoveredMark(store: EditorStore, id: string | null): void {
  if (id !== null) {
    cancelRelease()
    if (state.hovered === id) return
    state.hovered = id
    hoverStarted = Date.now()
    // The `marker` hold takes over, lasting as long as the pointer plus grace.
    nowRead(store, id)
    // A marker left over from a finished turn would pause with nothing paused.
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

/** Disagreement happens on the mark, not in the chat: three marks from one chunk
 * are one decision, and pulling one into a conversation breaks the group. The
 * run holds from the first click until a three-second gap says they are done. */
let idleTimer: ReturnType<typeof setTimeout> | null = null

function cancelIdle(): void {
  if (idleTimer === null) return
  clearTimeout(idleTimer)
  idleTimer = null
}

/** Restart the quiet-period clock. Once it runs out they get asked to resume. */
function waitForQuiet(store: EditorStore): void {
  cancelIdle()
  if (state.answers.length === 0) return
  idleTimer = setTimeout(() => {
    idleTimer = null
    logMarkAnswer('quiet', `${state.answers.length} answered`)
    // A mark answered after the run ended still reaches the user model through
    // the same handler; there is just nothing to restart.
    if (agentTurn.running) state.askingToResume = true
    else resumeAfterAnswers()
    sync(store)
  }, IDLE_MS)
}

/** Hold the run from the first click, and only let go at the resume. */
function holdForAnswers(): void {
  if (agentTurn.running) pauseTurn('feedback')
}

export function openMarkFeedback(store: EditorStore, id: string): void {
  if (state.composing === id) return
  if (!state.marks.some((mark) => mark.id === id)) return
  cancelIdle()
  state.askingToResume = false
  state.composing = id
  logMarkAnswer('opened', id)
  nowRead(store, id)
  holdForAnswers()
  sync(store)
}

/** Closed the box without saying anything. Any earlier answers still stand. */
export function cancelMarkFeedback(store: EditorStore): void {
  if (state.composing === null) return
  logMarkAnswer('dismissed', state.composing)
  state.composing = null
  if (state.answers.length === 0) resumeTurn('feedback')
  else waitForQuiet(store)
  sync(store)
}

/** Recorded, not sent: the whole set goes at the resume, because passing on one
 * mark is as much a statement as answering it. */
export function answerMark(store: EditorStore, id: string, text: string): void {
  const body = text.trim()
  if (body === '') return
  const mark = state.marks.find((candidate) => candidate.id === id)
  const latest = mark && mark.notes.length > 0 ? mark.notes[mark.notes.length - 1] : null
  state.answers = [
    ...state.answers.filter((answer) => answer.id !== id),
    {
      id,
      nodeId: mark?.nodeId ?? null,
      note: latest?.text ?? '',
      quote: latest?.evidence.fromReasoning ?? '',
      citedId: latest?.evidence.fromUserModel ?? null,
      relation: mark?.relation ?? 'unknown',
      text: body
    }
  ]
  state.composing = null
  logMarkAnswer('answered', id)
  holdForAnswers()
  waitForQuiet(store)
  sync(store)
}

/** The hold stays on: the parked step already holds its tool call, so letting go
 * here runs the very call the answer was about. The caller ends the run first,
 * then calls `releaseAnswerHold`. */
export function takeAnswers(store: EditorStore): MarkAnswer[] {
  const answers = state.answers
  cancelIdle()
  state.answers = []
  state.composing = null
  state.askingToResume = false
  sync(store)
  return answers
}

export function releaseAnswerHold(): void {
  resumeTurn('feedback')
}

/** True while the run is held for answers, whether or not a box is open. */
export function isAnsweringMarks(): boolean {
  return state.composing !== null || state.answers.length > 0
}

/** The button is in the canvas and the work is the chat panel's: two component
 * trees, so an emit has nowhere to go. */
let onResume: (() => void) | null = null

export function setMarkResumeHandler(handler: () => void): void {
  onResume = handler
}

export function resumeAfterAnswers(): void {
  onResume?.()
}

/** An element removed under the pointer does not reliably raise a leave event,
 * so without this the hold is never released and the run stops for good. */
function releaseIfHoveredGone(store: EditorStore): void {
  if (state.hovered === null) return
  if (state.marks.some((mark) => mark.id === state.hovered)) return
  letGo(store)
}

/** Told to the meta-agent rather than filtered here: it re-sends its whole list
 * every judgment, so a mark hidden downstream keeps its slot and never retires.
 * Registered rather than imported, since `setMarks` comes the other way. */
let onDismiss: ((id: string) => void) | null = null

export function setMarkDismissedObserver(handler: (id: string) => void): void {
  onDismiss = handler
}

/** The same as letting it stand, said out loud so the badge stops taking room.
 * Questions only: a one-click clear on a warning is a control for clearing
 * warnings without reading them. */
export function dismissMark(store: EditorStore, id: string): void {
  const mark = state.marks.find((candidate) => candidate.id === id)
  if (mark?.relation !== 'unknown') return
  // Not 'dismissed', which already means the answer box was closed unused.
  logMarkAnswer('removed', id)
  // Before the list shrinks: the hold is keyed on the id.
  nowRead(store, id)
  if (state.composing === id) state.composing = null
  if (state.hovered === id) letGo(store)
  // Comes back through `setMarks` with this mark gone from it.
  onDismiss?.(id)
}

/** Marks on a vanished node are dropped here, not at the renderer: the badge
 * would float over empty canvas, and the meta-agent's listing can be a step old. */
export function setMarks(store: EditorStore, marks: Mark[]): void {
  const known = new Set(state.marks.map((mark) => mark.id))
  const valid = marks.filter((mark) => mark.nodeId === null || store.graph.getNode(mark.nodeId))
  state.marks = valid.slice(Math.max(0, valid.length - MAX_MARKS))
  releaseIfHoveredGone(store)

  // Taken back, or gone because its change landed: nothing left to read.
  const standing = new Map(state.marks.map((mark) => [mark.id, mark]))
  const gone: string[] = []
  for (const id of unread) {
    const mark = standing.get(id)
    if (mark === undefined || !worthHolding(mark)) gone.push(id)
  }
  // Collected first: `nowRead` deletes from the set being iterated.
  for (const id of gone) nowRead(store, id)

  for (const mark of state.marks) {
    if (known.has(mark.id)) continue
    holdForNewMark(store, mark)
    if (!isWarning(mark)) continue
    state.intro = [...state.intro, mark.id]
    // Module state with no component to scope to, and it has to keep running
    // while the user is looking at another panel.
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
  forgetUnread()
  letGo(store)
  // Leftover answers are about marks off screen, and nothing else lifts their hold.
  takeAnswers(store)
  releaseAnswerHold()
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

// Dev handle: drives the badges, the glow and the answer box with no model call.
//
//   __mismatch.set([{ id: 'm1', nodeId: __mismatch.pageNodes()[0], rating: -4,
//                     relation: 'conflict', raisedInStep: 0,
//                     notes: [{ text: 'wants a shadow · you use thin borders',
//                               evidence: { fromUserModel: 'flat',
//                                           fromReasoning: 'a soft drop shadow' } }] }])
//
// With no turn running nothing is held, so answering one and waiting three
// seconds runs the user-model half on its own.
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
