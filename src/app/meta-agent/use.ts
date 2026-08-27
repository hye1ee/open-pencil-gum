import { setPreviewSettledObserver } from '@/app/ai/chat/action-preview'
import {
  logJudgeError,
  logJudgeLifecycle,
  logJudgeRejected,
  logJudgeSkip,
  logJudgment,
  logMarkTool
} from '@/app/ai/chat/agent-log'
import { setMarkDismissedObserver, setMarks } from '@/app/ai/chat/mismatch'
import { isSlotConfigured } from '@/app/ai/model-routing'
import { getActiveEditorStore } from '@/app/editor/active-store'
import type { EditorStore } from '@/app/editor/active-store'
import { resetFeedbackNoteHistory, resetFeedbackNotes } from '@/app/feedback-note/use'
import { callMetaAgent } from '@/app/meta-agent/call'
import { compareReasoningWithUserModel } from '@/app/meta-agent/comparison/use'
import {
  actionsSoFar,
  propositionsForRun,
  summariseCanvas,
  withAncestors
} from '@/app/meta-agent/context'
import {
  currentPlan,
  noteAgentPlan,
  setMetaAgentNodeReplacedObserver
} from '@/app/meta-agent/events'
import {
  createMetaAgent,
  signed,
  type AppliedMarkTool,
  type Mark,
  type MetaAgent,
  type Proposition,
  type SettledNote
} from '@/app/meta-agent/judge'
import { JUDGE_SYSTEM, renderJudgePrompt } from '@/app/meta-agent/prompt'
import {
  installReasoningObserver,
  resetFeedbackNoteStreams
} from '@/app/meta-agent/reasoning-observer'
import { forgetReportedMarks } from '@/app/meta-agent/report'
import { load as loadSavedUserModel } from '@/app/user-model/storage'
import { propositions as currentUserModelPropositions } from '@/app/user-model/store'
import { awaitUserModelSettled } from '@/app/user-model/use'

let agent: MetaAgent | null = null
let request = ''
let runPropositions: Proposition[] = []
let runStore: EditorStore | null = null
const feedbackNotesEnabled = import.meta.env.VITE_FEEDBACK_NOTE_EXPERIMENT === 'true'
const comparisonShadowEnabled =
  import.meta.env.DEV && import.meta.env.VITE_META_COMPARISON_SHADOW === 'true'
let comparisonShadowTask: Promise<void> = Promise.resolve()

/** One line per mark. The quoted words are the only way to tell a mark that
 * answers the reasoning from one the model reached for. */
function describeMark(mark: Mark): string {
  const where = mark.nodeId ?? 'whole design'
  const notes = mark.notes
    .map(
      (note) =>
        `${note.text} [${note.evidence.fromUserModel ?? 'nothing covers it'}] ` +
        `"${note.evidence.fromReasoning}"`
    )
    .join(' | ')
  return `  ${mark.id}  ${mark.relation}  ${where}  ${signed(mark.rating)}  ${notes}`
}

function describeTool(event: AppliedMarkTool): string {
  const revived = event.toolName === 'update_mark' && event.revived ? ' revived' : ''
  return (
    `${event.toolName} ${event.id}${revived} → ${event.nodeId ?? 'whole design'} ` +
    `${event.relation} ${signed(event.rating)}`
  )
}

function ensureAgent(store: EditorStore): MetaAgent {
  agent ??= createMetaAgent({
    deps: {
      system: JUDGE_SYSTEM,
      render: renderJudgePrompt,
      judge: ({ system, prompt }) => callMetaAgent(system, prompt)
    },
    onChanged: (marks, from) => {
      // Length off the input this answer was made from: answers land out of
      // order, so a shared counter attributes them to the wrong thought.
      if (from) logJudgment(from.reasoning.length, marks.map(describeMark))
      setMarks(store, marks)
    },
    onTools: (tools, input) => {
      for (const event of tools) logMarkTool(input.reasoning.length, describeTool(event))
    },
    onRejectedTools: (tools, input) => {
      logJudgeRejected(
        input.reasoning.length,
        tools.map((call) => call.toolName)
      )
    },
    onLifecycle: (event) => {
      logJudgeLifecycle(event)
    },
    onSkipped: (_reason, input) => {
      logJudgeSkip(input.reasoning.length)
    },
    onError: (error: unknown) => {
      console.warn('[meta] judge failed:', error)
      logJudgeError(error)
    }
  })
  return agent
}

/** Notes already answered this build. Held out here because it has to outlive
 * `beginTurn`, which an answer triggers; cleared only on a new request. */
let settled: SettledNote[] = []

export function noteSettledMarks(notes: SettledNote[]): void {
  settled = [...settled, ...notes]
}

/** A new turn: what the user asked for, and a clean slate. */
export async function startMetaAgentTurn(store: EditorStore, userText: string): Promise<void> {
  runStore = store
  // A restart keeps the same request, so a changed one is what says the last
  // build's answers no longer describe what is being built.
  if (userText !== request) {
    settled = []
    forgetReportedMarks()
    resetFeedbackNoteHistory()
  }
  request = userText
  noteAgentPlan(null)
  // A restart after a marker answer has a revision in flight; reading early
  // would judge the redone step against the belief just corrected.
  await awaitUserModelSettled()
  // Held for the turn. Prefer the in-memory model: feedback revision updates it
  // synchronously, while persistence is intentionally disabled for fixtures
  // and otherwise finishes in the background. Disk is only the cold-start
  // fallback before anything has populated the store.
  const inMemory = currentUserModelPropositions.value
  const userModel = inMemory.length > 0 ? inMemory : await loadSavedUserModel()
  runPropositions = propositionsForRun(userModel)
  const withheld = runPropositions.filter((p) => !p.shownToAgent).length
  logJudgeLifecycle(`loaded ${runPropositions.length} propositions, ${withheld} withheld`)
  resetFeedbackNotes()
  resetFeedbackNoteStreams()
  comparisonShadowTask = Promise.resolve()
  if (feedbackNotesEnabled) setMarks(store, [])
  else ensureAgent(store).beginTurn()
}

// Hung off the preview rather than the tool call: the preview is the window
// these marks exist for, so taking them down as the change lands reads nothing.
setPreviewSettledObserver((nodeIds) => {
  agent?.retireSettledMarks(withAncestors(getActiveEditorStore(), nodeIds))
})

setMetaAgentNodeReplacedObserver((oldId, newId) => {
  agent?.remapNode(oldId, newId)
})

setMarkDismissedObserver((id) => {
  agent?.dismissMark(id)
})

// Registered here because the tap must not import anything that builds a model.
installReasoningObserver({
  feedbackNotesEnabled,
  getStore: () => runStore,
  getRequest: () => request,
  getPlan: currentPlan,
  getPropositions: () => runPropositions,
  onOrdinaryStart: () => agent?.beginStep(),
  onOrdinaryChunk: considerReasoning,
  onReasoningEnd: (reasoning) => {
    if (comparisonShadowEnabled && reasoning.trim() !== '') {
      comparisonShadowTask = comparisonShadowTask.then(() =>
        compareReasoningWithUserModel({ request, reasoning, propositions: runPropositions })
      )
    }
  },
  ordinarySettled: () => agent?.settled() ?? Promise.resolve()
})

/** Standing marks plus retired ones. Not the marks the meta-agent withdrew,
 * which were never the person's to accept. */
export function marksAwaitingAnswer(): Mark[] {
  return feedbackNotesEnabled ? [] : (agent?.answerable ?? [])
}

/** So a turn restarted after feedback keeps the request rather than treating
 * the feedback as a new one. */
export function currentMetaRequest(): string {
  return request
}

/** Read once in `startMetaAgentTurn` and held, so the task agent and the judge
 * work from the same version. The separate planning module intentionally does
 * not receive the user model. */
export function runUserModel(): Proposition[] {
  return runPropositions
}

/** `reasoning` is everything thought this step, not the latest piece: a judgment
 * on a half-formed thought is about an idea that may not survive. */
export function considerReasoning(reasoning: string): void {
  if (!isSlotConfigured('meta-agent') || reasoning.trim() === '') return
  const store = getActiveEditorStore()
  ensureAgent(store).consider({
    request,
    plan: currentPlan(),
    propositions: runPropositions,
    canvas: summariseCanvas(store),
    reasoning,
    actions: actionsSoFar(store),
    settled
  })
}
