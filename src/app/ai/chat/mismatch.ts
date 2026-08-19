import { reactive } from 'vue'

import { setAgentCursorFlash } from '@/app/ai/chat/agent-cursor'
import { logMarkAnswer, logMarkHover, logMarkRelease } from '@/app/ai/chat/agent-log'
import { agentTurn, pauseTurn, resumeTurn } from '@/app/ai/chat/agent-turn'
import { getActiveEditorStore } from '@/app/editor/active-store'
import type { EditorStore } from '@/app/editor/active-store'
import { isWarning } from '@/app/meta-agent/judge'
import type { Mark, MarkRating, MarkRelation } from '@/app/meta-agent/judge'

// Reactive UI mirror of the marks owned by the meta-agent.

const MAX_MARKS = 8
const INTRO_MS = 2600
const QUESTION_WINDOW_MS = 5000
const WARNING_HOLD_CEILING_MS = 60_000
export interface MarkAnswer {
  id: string
  nodeId: string | null
  note: string
  quote: string
  citedId: string | null
  relation: MarkRelation
  text: string
  fromRating?: MarkRating
  toRating?: MarkRating
  steering?: boolean
}

export interface SteeringDraft {
  id: string
  fromRating: MarkRating | null
  toRating: MarkRating | null
  text: string
}

const state = reactive<{
  marks: Mark[]
  retired: Mark[]
  hovered: string | null
  intro: string[]
  answers: MarkAnswer[]
  steeringDraft: SteeringDraft | null
  hidden: string[]
}>({
  marks: [],
  retired: [],
  hovered: null,
  intro: [],
  answers: [],
  steeringDraft: null,
  hidden: []
})

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
 * the canvas has to say which node the sentence is about. */
function lit(mark: Mark): boolean {
  if (state.answers.some((answer) => answer.id === mark.id)) return true
  if (state.hovered === mark.id) return true
  // Only on hover for a question: raising one is not worth a glow, but pointing
  // at it in the steering space has to say which node it is about.
  return mark.relation !== 'unknown' && state.intro.includes(mark.id)
}

function sync(store: EditorStore): void {
  const shown = [...state.marks, ...state.retired].filter(lit)
  const anchored = shown.filter((mark): mark is Mark & { nodeId: string } => mark.nodeId !== null)
  store.aiSetMismatch(anchored.map((mark) => [mark.nodeId, mark.rating]))
  setAgentCursorFlash(shown.some((mark) => mark.nodeId === null))
}

/** Not zero: the pointer slides off a 16px badge on the way to the next one, and
 * restarting there moves the thing being read out from under the reader. */
const RESUME_DELAY_MS = 3000

let releaseTimer: ReturnType<typeof setTimeout> | null = null
let hoverStarted = 0
let releasing: string | null = null

function cancelRelease(): void {
  if (releaseTimer === null) return
  clearTimeout(releaseTimer)
  releaseTimer = null
}

function letGo(store: EditorStore): void {
  cancelRelease()
  const id = state.hovered ?? releasing
  if (id === null) return
  logMarkRelease(id, Date.now() - hoverStarted)
  state.hovered = null
  releasing = null
  resumeTurn('marker')
  sync(store)
}

const unread = new Set<string>()
const unreadTimers = new Map<string, ReturnType<typeof setTimeout>>()

function worthHolding(mark: Mark): boolean {
  return mark.rating < 0
}

function holdForNewMark(store: EditorStore, mark: Mark): void {
  if (!agentTurn.running || !worthHolding(mark)) return
  unread.add(mark.id)
  pauseTurn('new-mark')
  unreadTimers.set(
    mark.id,
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

export function setHoveredMark(store: EditorStore, id: string | null): void {
  if (id !== null) {
    cancelRelease()
    releasing = null
    if (state.hovered === id) return
    state.hovered = id
    hoverStarted = Date.now()
    nowRead(store, id)
    logMarkHover(id, agentTurn.running)
    if (agentTurn.running) pauseTurn('marker')
    sync(store)
    return
  }
  if (state.hovered === null || releaseTimer !== null) return
  releasing = state.hovered
  state.hovered = null
  sync(store)
  releaseTimer = setTimeout(() => {
    releaseTimer = null
    letGo(store)
  }, RESUME_DELAY_MS)
}

let onLock: ((id: string, locked: boolean) => void) | null = null

export function setMarkLockObserver(handler: (id: string, locked: boolean) => void): void {
  onLock = handler
}

export function beginSteeringFeedback(store: EditorStore, id: string): void {
  const mark = state.marks.find((candidate) => candidate.id === id)
  if (!mark?.feedbackContents || mark.rating === 0) return
  const previous = state.answers.find((answer) => answer.id === id)
  const fromRating = previous?.fromRating ?? (mark.rating as MarkRating)
  const toRating = previous?.toRating ?? fromRating
  state.steeringDraft = {
    id,
    fromRating,
    toRating,
    text: previous?.text ?? mark.feedbackContents[String(toRating) as `${MarkRating}`]
  }
  onLock?.(id, true)
  nowRead(store, id)
  pauseTurn('feedback')
}

export function moveSteeringFeedback(rating: MarkRating): void {
  const draft = state.steeringDraft
  if (!draft) return
  const mark = state.marks.find((candidate) => candidate.id === draft.id)
  const text = mark?.feedbackContents?.[String(rating) as `${MarkRating}`]
  if (!text) return
  draft.toRating = rating
  draft.text = text
}

export function beginUnknownFeedback(store: EditorStore, id: string): void {
  const mark = state.marks.find((candidate) => candidate.id === id)
  if (mark?.relation !== 'unknown' || !mark.suggestedFeedback) return
  const previous = state.answers.find((answer) => answer.id === id)
  state.steeringDraft = {
    id,
    fromRating: null,
    toRating: null,
    text: previous?.text ?? mark.suggestedFeedback
  }
  onLock?.(id, true)
  nowRead(store, id)
  pauseTurn('feedback')
}

export function editSteeringFeedback(text: string): void {
  if (state.steeringDraft) state.steeringDraft.text = text
}

export function confirmSteeringFeedback(store: EditorStore): void {
  const draft = state.steeringDraft
  if (!draft || draft.text.trim() === '') return
  const mark = state.marks.find((candidate) => candidate.id === draft.id)
  const latest = mark?.notes.at(-1)
  state.answers = [
    ...state.answers.filter((answer) => answer.id !== draft.id),
    {
      id: draft.id,
      nodeId: mark?.nodeId ?? null,
      note: latest?.text ?? '',
      quote: latest?.evidence.fromReasoning ?? '',
      citedId: latest?.evidence.fromUserModel ?? null,
      relation: mark?.relation ?? 'unknown',
      text: draft.text.trim(),
      steering: true,
      ...(draft.fromRating !== null && draft.toRating !== null
        ? { fromRating: draft.fromRating, toRating: draft.toRating }
        : {})
    }
  ]
  state.steeringDraft = null
  logMarkAnswer('answered', draft.id)
  sync(store)
}

export function cancelSteeringFeedback(store: EditorStore): void {
  const draft = state.steeringDraft
  if (!draft) return
  state.steeringDraft = null
  if (!state.answers.some((answer) => answer.id === draft.id)) onLock?.(draft.id, false)
  if (state.answers.length === 0) resumeTurn('feedback')
  sync(store)
}

export function steeringRating(mark: Mark): number {
  const draft = state.steeringDraft?.id === mark.id ? state.steeringDraft : null
  if (draft?.toRating !== null && draft?.toRating !== undefined) return draft.toRating
  return state.answers.find((answer) => answer.id === mark.id)?.toRating ?? mark.rating
}

/** The hold stays on: the parked step already holds its tool call, so letting go
 * here runs the very call the answer was about. The caller ends the run first,
 * then calls `releaseAnswerHold`. */
export function takeAnswers(store: EditorStore): MarkAnswer[] {
  const answers = state.answers
  state.answers = []
  state.steeringDraft = null
  sync(store)
  return answers
}

export function releaseAnswerHold(): void {
  resumeTurn('feedback')
}

// Bridges the canvas overlay to the chat panel.
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
  if ([...state.marks, ...state.retired].some((mark) => mark.id === state.hovered)) return
  letGo(store)
}

/** Told to the meta-agent rather than filtered here: it re-sends its whole list
 * every judgment, so a mark hidden downstream keeps its slot and never retires.
 * Registered rather than imported, since `setMarks` comes the other way. */
let onDismiss: ((id: string) => void) | null = null

export function setMarkDismissedObserver(handler: (id: string) => void): void {
  onDismiss = handler
}

// Only unknown marks can be dismissed explicitly.
export function acceptAndHideMark(store: EditorStore, id: string): void {
  const mark = state.marks.find((candidate) => candidate.id === id)
  if (mark?.relation !== 'unknown') return
  state.hidden = [...state.hidden, id]
  onLock?.(id, true)
  logMarkAnswer('removed', id)
  nowRead(store, id)
  if (state.hovered === id) letGo(store)
  onDismiss?.(id)
}

/** Marks on a vanished node are dropped here, not at the renderer: the badge
 * would float over empty canvas, and the meta-agent's listing can be a step old. */
export function setMarks(store: EditorStore, marks: Mark[], retired: Mark[] = []): void {
  const known = new Set(state.marks.map((mark) => mark.id))
  const valid = marks.filter((mark) => mark.nodeId === null || store.graph.getNode(mark.nodeId))
  state.marks = valid.slice(Math.max(0, valid.length - MAX_MARKS))
  state.retired = retired.filter((mark) => mark.nodeId === null || store.graph.getNode(mark.nodeId))
  releaseIfHoveredGone(store)

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
    setTimeout(() => {
      state.intro = state.intro.filter((id) => id !== mark.id)
      sync(store)
    }, INTRO_MS)
  }
  sync(store)
}

export function clearMarks(store: EditorStore): void {
  if (state.marks.length === 0 && state.retired.length === 0) return
  state.marks = []
  state.retired = []
  state.intro = []
  state.steeringDraft = null
  state.hidden = []
  forgetUnread()
  letGo(store)
  takeAnswers(store)
  releaseAnswerHold()
  store.aiClearMismatch()
}

/** Drop marks whose nodes are gone, so nothing glows around a deleted node. */
export function pruneMarks(store: EditorStore): void {
  const onLiveNode = (mark: Mark) => mark.nodeId === null || store.graph.getNode(mark.nodeId)
  const alive = state.marks.filter(onLiveNode)
  const aliveRetired = state.retired.filter(onLiveNode)
  if (alive.length === state.marks.length && aliveRetired.length === state.retired.length) return
  state.marks = alive
  state.retired = aliveRetired
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
