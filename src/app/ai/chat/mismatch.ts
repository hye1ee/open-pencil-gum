import { reactive } from 'vue'

import { logMarkAnswer, logMarkHover, logMarkRelease } from '@/app/ai/chat/agent-log'
import { agentTurn, pauseTurn, resumeTurn } from '@/app/ai/chat/agent-turn'
import { getActiveEditorStore } from '@/app/editor/active-store'
import type { EditorStore } from '@/app/editor/active-store'
import { isWarning } from '@/app/meta-agent/judge'
import type { Mark, MarkRelation } from '@/app/meta-agent/judge'

/**
 * The marks the meta-agent has standing, mirrored where the canvas can see them.
 *
 * The list is owned by the meta-agent, not built here: it answers in actions
 * against marks that persist, so a mark has an identity that outlives any one
 * answer and this file must not invent one of its own. All that happens here is
 * the mirror, plus dropping marks whose node has since gone.
 *
 * Three kinds:
 *
 * - a warning rests on something we believe and goes against it. It is a chance
 *   to stop a change before it lands, and comes off once the change has stood.
 * - an alignment rests on something we believe and follows it. Nothing to stop,
 *   so it never holds the run; it comes off on the same event a warning does.
 * - a question rests on nothing we believe, and asks what this person would want
 *   somewhere we have no idea. The change landing does not answer it — seeing
 *   the result is what makes it answerable — so it stays until the turn ends.
 *
 * `alignment` is the meta-agent's own call, −5 to +5, and drives both the badge
 * colour and the glow: the sign picks red or green, the magnitude sets how loud
 * it is. There is deliberately no count of how often something was raised:
 * repetition is an input to how much a thing matters, not a second number for
 * the person to weigh against the first.
 */

/** Beyond a handful the canvas is more noticeboard than design. A backstop only
 * — the meta-agent caps its own questions, the rest retire when their change
 * lands, and a question can also be waved away. */
const MAX_MARKS = 8

/** How long a new warning glows before it settles back to just a badge. */
const INTRO_MS = 2600

/**
 * How long a new question holds the run on its own.
 *
 * A mark is a chance to catch something before it lands, and until now that
 * chance lasted only as long as someone kept a pointer on the badge. Measured:
 * a conflict went up nine seconds before the tool call it warned about, was read
 * for three, and the render went through one second after the pointer left —
 * the person then decided to disagree eight seconds too late. That is a
 * reaction test, not a review.
 */
const QUESTION_WINDOW_MS = 5000

/**
 * A warning is not on a timer. It holds the run until it has been looked at, or
 * until the change it warned about lands and it retires on its own.
 *
 * The ceiling is for the machine nobody is sitting at. Without it, walking away
 * mid-build stops it for good with nothing on screen saying why.
 */
const WARNING_HOLD_CEILING_MS = 60_000

/**
 * How long the run waits after an answer before offering to carry on.
 *
 * Answering one mark is rarely the whole of what someone wants to say — the
 * three marks from one chunk are three parts of the same decision — so the run
 * does not restart the moment a first answer is in. It restarts when they have
 * stopped, and stopping is only visible as a gap.
 */
const IDLE_MS = 3000

/**
 * One mark, answered.
 *
 * Everything but `text` is copied off the mark at the moment it was answered
 * rather than read back later, because the mark is free to be updated after
 * that and the reply belongs to the wording they actually saw.
 *
 * `quote` and `citedId` are the mark's own evidence — the agent's words it was
 * read off, and the proposition it was raised against. They are carried all the
 * way to the user model, which is the point of collecting them: knowing which
 * belief a reply is about beats inferring it from the reply's wording.
 */
export interface MarkAnswer {
  id: string
  nodeId: string | null
  note: string
  quote: string
  citedId: string | null
  /** Carried so the user model can tell a reply that disputed a warning from one
   * that disputed us saying the agent had got it right. */
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

/**
 * Which marks are lit up on the canvas right now.
 *
 * Not all of them: a glow around everything the meta-agent has ever said turns
 * the page into a noticeboard and stops meaning anything. A mark that rests on a
 * proposition flares when it appears, so it is not missed, then leaves a badge
 * behind; pointing at the badge lights it again, which is also what tells you
 * which node the badge belongs to.
 *
 * A mark being answered always glows, whatever it says. The person is looking at
 * the chat while they type, so the canvas has to keep saying which node the
 * sentence they are writing is about.
 *
 * Unknowns never flare. There is nothing to catch before it lands — they ask
 * about a result that does not exist yet — so they wait as badges.
 */
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
  // Signed: the renderer reads the sign for the colour and the magnitude for how
  // loud the glow is.
  store.aiSetMismatch(anchored.map((mark) => [mark.nodeId, mark.alignment]))
}

/**
 * How long after the pointer leaves a badge before the agent starts again.
 *
 * Not zero: the pointer slides off a 16px badge on the way to the next one, or
 * on the way to the node it is about, and restarting the build in that gap
 * means the thing being read moves out from under the reader. Long enough to
 * decide, too: leaving the badge is usually the middle of reading it, not the
 * end.
 */
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

/**
 * Marks nobody has had a chance to read yet.
 *
 * "Leaving a mark alone means agreeing with it" is the rule the whole
 * interaction rests on, and it is only honest if the mark was there to be left
 * alone. So a mark holds the run from the moment it appears, and the hold comes
 * off when it has been looked at rather than when a timer says so — except for
 * the ceiling, which is there so an empty chair does not stop the build for
 * good.
 */
const unread = new Set<string>()
const unreadTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Only a conflict stops the run.
 *
 * Zero is how the meta-agent takes a mark back now that it cannot delete one,
 * and nothing it has withdrawn is worth stopping for. Alignment never holds
 * either: interrupting a build to say the agent is doing the right thing is the
 * reaction test this hold was rewritten to stop being.
 */
function worthHolding(mark: Mark): boolean {
  return mark.alignment < 0
}

function holdForNewMark(store: EditorStore, mark: Mark): void {
  if (!agentTurn.running || !worthHolding(mark)) return
  unread.add(mark.id)
  pauseTurn('new-mark')
  unreadTimers.set(
    mark.id,
    // A warning waits to be read; a question is only a question and takes its
    // window whether or not anyone looks.
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
    // Looked at. The `marker` hold takes over from here and lasts as long as
    // the pointer does, plus the grace after it leaves.
    nowRead(store, id)
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
 * Answering marks.
 *
 * Leaving a mark alone is agreement — that is the default and it costs no
 * gesture. Clicking one is the whole disagreement path, and it happens on the
 * mark rather than in the chat: one chunk of thinking can raise three marks at
 * once, they are three parts of one decision, and pulling one of them into a
 * conversation elsewhere breaks that group apart.
 *
 * The run is held from the first click until they are done. "Done" is a gap:
 * three seconds with nothing typed and no box open, after which they are asked
 * whether to carry on. Opening another mark's box cancels the question — they
 * were not finished. Hovering a third mark and not answering it is not an
 * answer, and does not delay anything.
 */
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
    // Only ask when there is something to carry on with. A mark answered after
    // the run has finished still has to reach the user model, and it does so
    // through the same handler — there is just nothing to restart.
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

/** Their words about one mark. Recorded, not sent — the whole set goes at the
 * resume, because passing on one mark is as much a statement as answering it. */
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

/**
 * Everything said during this hold, and the answer boxes closed.
 *
 * The hold itself stays on. The interrupted step is parked at a hold point with
 * its tool call already built, so letting go here sets it running and it
 * finishes that call — the very one the answer was about — before an abort can
 * reach it. Measured: the answer landed, the run resumed, and the render it
 * warned about went through in the same tick. Whoever takes the answers ends
 * the run first and calls `releaseAnswerHold` after.
 */
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

/**
 * What "carry on" does, registered rather than called directly.
 *
 * The button sits beside the agent cursor, which is inside the canvas, and the
 * work it triggers is owned by the chat panel — two different component trees,
 * so an emit has nowhere to go.
 */
let onResume: (() => void) | null = null

export function setMarkResumeHandler(handler: () => void): void {
  onResume = handler
}

export function resumeAfterAnswers(): void {
  onResume?.()
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
 * Told to the meta-agent, which owns the list, rather than filtered out here.
 *
 * This file holds a mirror: the meta-agent re-sends its whole list on every
 * judgment. Hiding a mark downstream meant it kept arriving and kept having to
 * be filtered out again, kept a slot under `MAX_OPEN_QUESTIONS`, and never
 * reached `retired` — so the next chunk was free to raise the same question
 * under a new id. Registered rather than imported because the meta-agent
 * already imports `setMarks` from here.
 */
let onDismiss: ((id: string) => void) | null = null

export function setMarkDismissedObserver(handler: (id: string) => void): void {
  onDismiss = handler
}

/**
 * Waved away. Not an answer and not a disagreement — the same as letting it
 * stand, said out loud so the badge stops taking up room. The meta-agent retires
 * it for the same reason a settled change does, so it still reaches the user
 * model as something this person was shown and did not object to.
 *
 * Questions only. A question asks about something we have no belief on, so
 * "nothing to say here" is a complete response to it and the badge has no
 * further work to do. A warning is not the same: it rests on something we do
 * believe, it is the one chance to stop a change before it lands, and a control
 * that clears it in one click is a control for clearing warnings without reading
 * them. Warnings come off the way they always did — the change lands and stands,
 * or it does not.
 */
export function dismissMark(store: EditorStore, id: string): void {
  const mark = state.marks.find((candidate) => candidate.id === id)
  if (mark?.relation !== 'unknown') return
  // Not 'dismissed', which already means the answer box was closed unused.
  logMarkAnswer('removed', id)
  // Before the list shrinks: the hold is keyed on the id and `nowRead` is what
  // lets go of it.
  nowRead(store, id)
  if (state.composing === id) state.composing = null
  if (state.hovered === id) letGo(store)
  // Comes back through `setMarks` with this mark gone from it.
  onDismiss?.(id)
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

  // A mark still on the list but taken back, or gone from it entirely because
  // the change it warned about landed: either way there is nothing left to read.
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
  forgetUnread()
  letGo(store)
  // Answers left over from the turn that just ended are about marks no longer
  // on screen, and the hold they keep is one nothing else can lift.
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

// Dev handle so the badges, the glow and the answer box can be driven without a
// model call. `relation: 'conflict'` gives a coloured badge that glows, and
// 'unknown' a grey one. Ids are yours to pick; the meta-agent is not involved.
//
//   __mismatch.set([{ id: 'm1', nodeId: __mismatch.pageNodes()[0], importance: 7,
//                     relation: 'conflict',
//                     notes: [{ text: 'wants a shadow · you use thin borders',
//                               evidence: { fromUserModel: 'flat',
//                                           fromReasoning: 'a soft drop shadow' } }] }])
//
// With no turn running nothing is held, so answering one and waiting three
// seconds runs the user-model half on its own — the MODEL lines in the log with
// no restart after them.
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
