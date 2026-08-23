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
import { setReasoningObserver } from '@/app/ai/chat/model-trace'
import { isSlotConfigured } from '@/app/ai/model-routing'
import { currentRunSteps } from '@/app/ai/tools'
import { getActiveEditorStore } from '@/app/editor/active-store'
import type { EditorStore } from '@/app/editor/active-store'
import { considerFeedbackNotesForStep } from '@/app/feedback-note/meta'
import {
  resetFeedbackNoteHistory,
  resetFeedbackNotes,
  settleFeedbackNoteStep
} from '@/app/feedback-note/use'
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
import { forgetReportedMarks } from '@/app/meta-agent/report'
import { load as loadSavedUserModel } from '@/app/user-model/storage'
import { awaitUserModelSettled } from '@/app/user-model/use'

/** The app-specific half of the meta-agent: which model it calls, how the canvas
 * is described to it, and where its judgment lands. `judge.ts` knows none of it. */

let agent: MetaAgent | null = null
let feedbackNoteChunk = 0
let feedbackNoteStep: number | null = null
let feedbackNoteStepSettled = false
let request = ''
let runPropositions: Proposition[] = []
let runStore: EditorStore | null = null
const feedbackNotesEnabled = import.meta.env.VITE_FEEDBACK_NOTE_EXPERIMENT === 'true'
const comparisonShadowEnabled =
  import.meta.env.DEV && import.meta.env.VITE_META_COMPARISON_SHADOW === 'true'
let feedbackNoteTask: Promise<void> = Promise.resolve()
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
  // Held for the turn: the capture pipeline writes to disk while the agent
  // works, and a model that grows mid-run makes two steps incomparable.
  runPropositions = propositionsForRun(await loadSavedUserModel())
  const withheld = runPropositions.filter((p) => !p.shownToAgent).length
  logJudgeLifecycle(`loaded ${runPropositions.length} propositions, ${withheld} withheld`)
  resetFeedbackNotes()
  feedbackNoteTask = Promise.resolve()
  comparisonShadowTask = Promise.resolve()
  feedbackNoteStep = null
  feedbackNoteStepSettled = false
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
setReasoningObserver({
  start: () => {
    if (feedbackNotesEnabled) {
      feedbackNoteChunk = 0
      feedbackNoteStep = runStore ? currentRunSteps(runStore) + 1 : null
      feedbackNoteStepSettled = false
    }
    if (!feedbackNotesEnabled) agent?.beginStep()
  },
  chunk: (reasoningChunk, reasoningSoFar) => {
    if (!feedbackNotesEnabled) {
      considerReasoning(reasoningSoFar)
      return
    }
    const store = runStore
    if (!store || reasoningChunk.trim() === '') return
    feedbackNoteChunk++
    const originStep = feedbackNoteStep ?? currentRunSteps(store) + 1
    const originChunk = feedbackNoteChunk
    feedbackNoteTask = feedbackNoteTask.then(() =>
      considerFeedbackNotesForStep({
        store,
        request,
        plan: currentPlan(),
        reasoning: reasoningChunk,
        originStep,
        originChunk,
        propositions: runPropositions
      })
    )
  },
  end: (reasoning) => {
    if (comparisonShadowEnabled && reasoning.trim() !== '') {
      comparisonShadowTask = comparisonShadowTask.then(() =>
        compareReasoningWithUserModel({ request, reasoning, propositions: runPropositions })
      )
    }
    if (
      !feedbackNotesEnabled ||
      feedbackNoteChunk === 0 ||
      feedbackNoteStep === null ||
      feedbackNoteStepSettled
    ) {
      return
    }
    feedbackNoteStepSettled = true
    const generation = feedbackNoteTask
    feedbackNoteTask = settleFeedbackNoteStep(feedbackNoteStep, generation)
  },
  settled: () => (feedbackNotesEnabled ? feedbackNoteTask : (agent?.settled() ?? Promise.resolve()))
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

/** Read once in `startMetaAgentTurn` and held, so the design agent, the planning
 * call and the judge all work from the same version. */
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
