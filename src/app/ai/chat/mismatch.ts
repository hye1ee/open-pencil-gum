import { reactive } from 'vue'

import { setAgentCursorFlash } from '@/app/ai/chat/agent-cursor'
import { logMarkAnswer, logMarkHover, logMarkRelease, logSteering } from '@/app/ai/chat/agent-log'
import { agentTurn, pauseTurn, resumeTurn } from '@/app/ai/chat/agent-turn'
import { getActiveEditorStore } from '@/app/editor/active-store'
import type { EditorStore } from '@/app/editor/active-store'
import { OPENING_STEP, SPECTRUM, isUnrelated } from '@/app/meta-agent/judge'
import type { Mark, SpectrumStep } from '@/app/meta-agent/judge'

// Reactive UI mirror of the marks owned by the meta-agent.

const MAX_MARKS = 8
/** History has its own ceiling: an event per generate and per update. */
const MAX_TIMELINE_EVENTS = 240
const INTRO_MS = 2600
/** Every mark now carries a spectrum to choose from, so they all wait the same
 * time to be read. Any interaction releases it sooner. */
const HOLD_MS = 20_000
export interface MarkAnswer {
  id: string
  lineageId: string
  topic: string
  nodeId: string | null
  note: string
  quote: string
  citedId: string | null
  text: string
  fromPosition?: SpectrumStep
  toPosition?: SpectrumStep
  steering?: boolean
}

export interface SteeringDraft {
  id: string
  source: 'canvas' | 'timeline'
  fromPosition: SpectrumStep | null
  toPosition: SpectrumStep | null
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
  activeSteeringStep: number
  steeringSteps: number[]
  timelineMarks: Mark[]
}>({
  marks: [],
  retired: [],
  hovered: null,
  intro: [],
  answers: [],
  steeringDraft: null,
  hidden: [],
  activeSteeringStep: 1,
  steeringSteps: [],
  timelineMarks: []
})

export const mismatch = state
/** `run` expires the entry: one that survives a whole turn was never going to
 * match, and would later attach to whatever reused the name. */
const pendingLineages = new Map<string, { lineageId: string; run: number }>()
let steeringRun = 0

/** Topic alone collides — it is a free string. The cited proposition is an id we
 * issued, so the pair is far harder to hit by accident. */
function lineageKey(topic: string, citedId: string | null, nodeId: string | null): string {
  return `${topic.trim().toLocaleLowerCase()}|${citedId ?? nodeId ?? ''}`
}

export function resetSteeringSteps(): void {
  state.steeringSteps = []
  state.timelineMarks = []
  state.activeSteeringStep = 1
  steeringRun = 0
  pendingLineages.clear()
}

export function beginSteeringRun(): void {
  for (const [key, entry] of pendingLineages) {
    if (entry.run < steeringRun) pendingLineages.delete(key)
  }
  steeringRun += 1
}

/** `step` already runs continuously across a restart. */
export function recordSteeringStep(step: number): void {
  const runStep = Math.max(1, step)
  state.activeSteeringStep = runStep
  if (!state.steeringSteps.includes(runStep)) state.steeringSteps.push(runStep)
}

/** Whether the whole canvas, or a particular preview, carries a mark. Nothing
 * judges a decision any more, so any mark is a place the person may step in. */
export function hasMarks(nodeIds?: readonly string[]): boolean {
  if (!nodeIds) return state.marks.length > 0
  const targets = new Set(nodeIds)
  return state.marks.some((mark) => mark.nodeId !== null && targets.has(mark.nodeId))
}

/** Not all of them: a glow on everything stops meaning anything. A mark flares
 * when raised and again on hover, and always while it is being answered, since
 * the canvas has to say which node the sentence is about. */
function lit(mark: Mark): boolean {
  if (state.answers.some((answer) => answer.id === mark.id)) return true
  if (state.hovered === mark.id) return true
  // Only on hover for a question: raising one is not worth a glow, but pointing
  // at it in the steering space has to say which node it is about.
  return !isUnrelated(mark) && state.intro.includes(mark.id)
}

/** Faint until the person moves it, brightest at either end: the glow says how
 * much has been done to a decision, never whether it was any good. */
function glowStrength(mark: Mark): number {
  const step = steeringPosition(mark)
  if (step === null) return 0.45
  const middle = (SPECTRUM.length - 1) / 2
  return 0.35 + 0.65 * (Math.abs(SPECTRUM.indexOf(step) - middle) / middle)
}

function sync(store: EditorStore): void {
  const shown = [...state.marks, ...state.retired].filter(lit)
  const anchored = shown.filter((mark): mark is Mark & { nodeId: string } => mark.nodeId !== null)
  store.aiSetMismatch(anchored.map((mark) => [mark.nodeId, glowStrength(mark)]))
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

/** Every new mark holds: all of them can be steered. */
function holdForNewMark(store: EditorStore, mark: Mark): void {
  if (!agentTurn.running) return
  unread.add(mark.id)
  pauseTurn('new-mark')
  unreadTimers.set(
    mark.id,
    // A warning waits to be read; the rest take their window.
    setTimeout(() => nowRead(store, mark.id), HOLD_MS)
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

/** `hold` is off for a mark from an earlier step: it lights the canvas so the
 * person can see which node the history is about, but there is nothing to
 * answer there, so stopping the agent for it only stalls the run. */
export function setHoveredMark(store: EditorStore, id: string | null, hold = true): void {
  if (id !== null) {
    cancelRelease()
    releasing = null
    if (state.hovered === id) return
    state.hovered = id
    hoverStarted = Date.now()
    sync(store)
    if (!hold) return
    nowRead(store, id)
    logMarkHover(id, agentTurn.running)
    if (agentTurn.running) pauseTurn('marker')
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
let onFeedbackConfirmed: (() => void) | null = null

export function setMarkLockObserver(handler: (id: string, locked: boolean) => void): void {
  onLock = handler
}

export function setFeedbackConfirmedObserver(handler: () => void): void {
  onFeedbackConfirmed = handler
}

/** Only one draft is open at a time, so reaching for a second mark has to settle
 * the first. Dropping it instead sent the mark it was on back to the middle,
 * which reads as the app undoing a move the person had just made and watched. */
function settleOpenDraft(store: EditorStore, id: string): void {
  const draft = state.steeringDraft
  if (!draft || draft.id === id) return
  if (draft.text.trim() === '') cancelSteeringFeedback(store)
  else confirmSteeringFeedback(store)
}

/** Standing marks only: the agent is told earlier steps stand, so feedback on a
 * finished one contradicts that. */
export function beginSteeringFeedback(
  store: EditorStore,
  id: string,
  source: SteeringDraft['source'] = 'canvas'
): void {
  settleOpenDraft(store, id)
  const mark = state.marks.find((candidate) => candidate.id === id)
  if (!mark?.feedbackContents) return
  const previous = state.answers.find((answer) => answer.id === id)
  const fromPosition = previous?.fromPosition ?? mark.position ?? OPENING_STEP
  const toPosition = previous?.toPosition ?? fromPosition
  state.steeringDraft = {
    id,
    source,
    fromPosition,
    toPosition,
    text: previous?.text ?? mark.feedbackContents[toPosition]
  }
  onLock?.(id, true)
  nowRead(store, id)
  pauseTurn('feedback')
}

export function moveSteeringFeedback(step: SpectrumStep): void {
  const draft = state.steeringDraft
  if (!draft) return
  const mark = state.marks.find((candidate) => candidate.id === draft.id)
  const text = mark?.feedbackContents?.[step]
  if (!text) return
  draft.toPosition = step
  draft.text = text
}

/** Standing marks only, for the same reason as `beginSteeringFeedback`. */
export function beginUnknownFeedback(
  store: EditorStore,
  id: string,
  source: SteeringDraft['source'] = 'canvas'
): void {
  settleOpenDraft(store, id)
  const mark = state.marks.find((candidate) => candidate.id === id)
  if (!mark || !isUnrelated(mark)) return
  const previous = state.answers.find((answer) => answer.id === id)
  state.steeringDraft = {
    id,
    source,
    fromPosition: null,
    toPosition: null,
    // Empty when there is no draft: the box opens for them to type.
    text: previous?.text ?? mark.suggestedFeedback ?? ''
  }
  onLock?.(id, true)
  nowRead(store, id)
  pauseTurn('feedback')
}

export function editSteeringFeedback(text: string): void {
  if (state.steeringDraft) state.steeringDraft.text = text
}

/** The mark as it stood when the box opened, or its last snapshot if it has
 * since left the standing list. */
function markForDraft(draft: SteeringDraft): Mark | undefined {
  return (
    state.marks.find((candidate) => candidate.id === draft.id) ??
    state.timelineMarks.findLast((candidate) => candidate.id === draft.id)
  )
}

function answerFromDraft(draft: SteeringDraft, mark: Mark | undefined): MarkAnswer {
  const latest = mark?.notes.at(-1)
  const moved =
    draft.fromPosition !== null && draft.toPosition !== null
      ? { fromPosition: draft.fromPosition, toPosition: draft.toPosition }
      : {}
  return {
    id: draft.id,
    lineageId: mark?.lineageId ?? draft.id,
    topic: mark?.topic ?? 'Decision',
    nodeId: mark?.nodeId ?? null,
    note: latest?.text ?? '',
    quote: latest?.evidence.fromReasoning ?? '',
    citedId: latest?.evidence.fromUserModel ?? null,
    text: draft.text.trim(),
    steering: true,
    ...moved
  }
}

export function confirmSteeringFeedback(store: EditorStore): void {
  const draft = state.steeringDraft
  if (!draft || draft.text.trim() === '') return
  state.answers = [
    ...state.answers.filter((answer) => answer.id !== draft.id),
    answerFromDraft(draft, markForDraft(draft))
  ]
  onFeedbackConfirmed?.()
  // Onto the standing mark as well as the timeline copy. Written only on the
  // copy it lasted until the next judgment, which rebuilds every copy from the
  // standing mark — so answering one mark sent all the others back to the middle.
  if (draft.toPosition !== null) {
    const standing = state.marks.find((candidate) => candidate.id === draft.id)
    if (standing) standing.position = draft.toPosition
    const historical = state.timelineMarks.findLast((candidate) => candidate.id === draft.id)
    if (historical) historical.position = draft.toPosition
  }
  state.steeringDraft = null
  logMarkAnswer('answered', draft.id)
  if (draft.fromPosition !== null && draft.toPosition !== null) {
    logSteering(draft.id, draft.fromPosition, draft.toPosition, draft.text.trim())
  }
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

/** Where the mark reads as sitting right now: the open draft first, then a
 * settled answer, then wherever the mark itself stands. */
export function steeringPosition(mark: Mark): SpectrumStep | null {
  const draft = state.steeringDraft?.id === mark.id ? state.steeringDraft : null
  if (draft?.toPosition != null) return draft.toPosition
  return state.answers.find((answer) => answer.id === mark.id)?.toPosition ?? mark.position
}

/** The hold stays on: the parked step already holds its tool call, so letting go
 * here runs the very call the answer was about. The caller ends the run first,
 * then calls `releaseAnswerHold`. */
export function takeAnswers(store: EditorStore): MarkAnswer[] {
  const answers = state.answers
  for (const answer of answers) {
    pendingLineages.set(lineageKey(answer.topic, answer.citedId, answer.nodeId), {
      lineageId: answer.lineageId,
      run: steeringRun
    })
  }
  state.answers = []
  state.steeringDraft = null
  sync(store)
  return answers
}

export function releaseAnswerHold(): void {
  resumeTurn('feedback')
}

export function resetMarkInteraction(store: EditorStore): void {
  forgetUnread()
  letGo(store)
  state.steeringDraft = null
  sync(store)
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

// Only marks no proposition covers can be dismissed explicitly.
export function acceptAndHideMark(store: EditorStore, id: string): void {
  const mark = state.marks.find((candidate) => candidate.id === id)
  if (!mark || !isUnrelated(mark)) return
  state.hidden = [...state.hidden, id]
  onLock?.(id, true)
  logMarkAnswer('removed', id)
  nowRead(store, id)
  if (state.hovered === id) letGo(store)
  onDismiss?.(id)
}

/** Slim: feedback opens from standing marks only, so the five instructions and
 * the older notes would pile up on every event for nothing. `position` stays —
 * it is the seat on the scale and also what says whether there is one. */
function timelineSnapshot(mark: Mark): Mark {
  const latest = mark.notes.at(-1)
  const snapshot = structuredClone({
    ...mark,
    // Where the person has it, not where the meta-agent opened it: an answer
    // taken but not yet folded in lives only in `answers`.
    position: steeringPosition(mark),
    notes: latest ? [latest] : [],
    feedbackContents: null,
    suggestedFeedback: null
  })
  snapshot.lineageId ||= snapshot.id
  return snapshot
}

/** Marks on a vanished node are dropped here, not at the renderer: the badge
 * would float over empty canvas, and the meta-agent's listing can be a step old. */
export function setMarks(store: EditorStore, marks: Mark[], retired: Mark[] = []): void {
  const known = new Set(state.marks.map((mark) => mark.id))
  for (const mark of marks) {
    mark.lineageId ||= mark.id
    if (known.has(mark.id)) continue
    const key = lineageKey(
      mark.topic,
      mark.notes.at(-1)?.evidence.fromUserModel ?? null,
      mark.nodeId
    )
    const entry = pendingLineages.get(key)
    if (!entry) continue
    mark.lineageId = entry.lineageId
    pendingLineages.delete(key)
  }
  const valid = marks.filter((mark) => mark.nodeId === null || store.graph.getNode(mark.nodeId))
  state.marks = valid.slice(Math.max(0, valid.length - MAX_MARKS))
  state.retired = retired.filter((mark) => mark.nodeId === null || store.graph.getNode(mark.nodeId))
  const eventKey = (mark: Mark) => `${mark.id}:${mark.raisedInStep}:${mark.raisedOrder}`
  const history = new Map(state.timelineMarks.map((mark) => [eventKey(mark), mark]))
  for (const mark of [...marks, ...retired]) {
    const snapshot = timelineSnapshot(mark)
    snapshot.raisedInStep = Math.max(1, mark.changedInStep)
    snapshot.raisedOrder = mark.changedOrder
    history.set(eventKey(snapshot), snapshot)
  }
  const events = [...history.values()]
  state.timelineMarks = events.slice(Math.max(0, events.length - MAX_TIMELINE_EVENTS))
  releaseIfHoveredGone(store)

  const standing = new Map(state.marks.map((mark) => [mark.id, mark]))
  const gone: string[] = []
  for (const id of unread) {
    const mark = standing.get(id)
    if (mark === undefined) gone.push(id)
  }
  // Collected first: `nowRead` deletes from the set being iterated.
  for (const id of gone) nowRead(store, id)

  for (const mark of state.marks) {
    if (known.has(mark.id)) continue
    holdForNewMark(store, mark)
    if (isUnrelated(mark)) continue
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
//   __mismatch.set([{ id: 'm1', nodeId: __mismatch.pageNodes()[0], raisedInStep: 0,
//                     position: 'halfway', feedbackContents: { as_reasoned: '…', … },
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
