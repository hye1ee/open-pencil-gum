import { generateText } from 'ai'
import type { LanguageModel } from 'ai'

import { setPreviewSettledObserver } from '@/app/ai/chat/action-preview'
import {
  logJudgeError,
  logJudgeLifecycle,
  logJudgeRejected,
  logJudgeSkip,
  logJudgment,
  logMarkInstructions,
  logMarkTool
} from '@/app/ai/chat/agent-log'
import {
  beginSteeringRun,
  resetSteeringSteps,
  setMarkDismissedObserver,
  resetMarkInteraction,
  setFeedbackConfirmedObserver,
  setMarkLockObserver,
  setMarks
} from '@/app/ai/chat/mismatch'
import { createUntracedLanguageModel } from '@/app/ai/chat/model'
import { setReasoningObserver } from '@/app/ai/chat/model-trace'
import {
  backgroundProviderOptions,
  isSlotConfigured,
  modelConfigForSlot
} from '@/app/ai/model-routing'
import { getActiveEditorStore } from '@/app/editor/active-store'
import type { EditorStore } from '@/app/editor/active-store'
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
  SPECTRUM,
  createMetaAgent,
  isUnrelated,
  type AppliedMarkTool,
  type JudgeInput,
  type Mark,
  type MarkToolCall,
  type MetaAgent,
  type Proposition,
  type SettledNote
} from '@/app/meta-agent/judge'
import { JUDGE_SYSTEM, renderJudgePrompt } from '@/app/meta-agent/prompt'
import { forgetReportedMarks } from '@/app/meta-agent/report'
import { MARK_TOOLS } from '@/app/meta-agent/tools'
import { load as loadSavedUserModel } from '@/app/user-model/storage'
import { awaitUserModelSettled } from '@/app/user-model/use'

/** The app-specific half of the meta-agent: which model it calls, how the canvas
 * is described to it, and where its judgment lands. `judge.ts` knows none of it. */

/** Reasoning shares this budget on Gemini, and the answer is a short list. */
const JUDGE_MAX_TOKENS = 4096

/** Wants a cheap model, and more than that a different one: a judge on the same
 * model is blind to whatever that model is blind to. `VITE_MODEL_META_AGENT`. */
function judgeModel(): LanguageModel {
  return createUntracedLanguageModel(modelConfigForSlot('meta-agent'))
}

let agent: MetaAgent | null = null
let request = ''
let runPropositions: Proposition[] = []

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
  const seat = isUnrelated(mark) ? 'unrelated' : (mark.position ?? '')
  return `  ${mark.id}  ${seat}  ${where}  ${notes}`
}

function describeTool(event: AppliedMarkTool): string {
  const revived = event.toolName === 'update_mark' && event.revived ? ' revived' : ''
  return (
    `${event.toolName} ${event.id}${revived} → ${event.nodeId ?? 'whole design'} ` +
    (event.position ?? 'unrelated')
  )
}

function ensureAgent(store: EditorStore): MetaAgent {
  agent ??= createMetaAgent({
    deps: {
      system: JUDGE_SYSTEM,
      render: renderJudgePrompt,
      judge: async ({ system, prompt }) => {
        const result = await generateText({
          model: judgeModel(),
          system,
          maxOutputTokens: JUDGE_MAX_TOKENS,
          providerOptions: backgroundProviderOptions('meta-agent'),
          prompt,
          tools: MARK_TOOLS,
          toolChoice: 'auto'
        })
        return result.staticToolCalls.map(
          (call): MarkToolCall => ({ toolName: call.toolName, input: call.input })
        )
      }
    },
    onChanged: (marks, retired, from) => {
      // Length off the input this answer was made from: answers land out of
      // order, so a shared counter attributes them to the wrong thought.
      if (from) logJudgment(from.reasoning.length, marks.map(describeMark))
      setMarks(store, marks, retired)
    },
    onTools: (tools, input) => {
      for (const event of tools) {
        logMarkTool(input.reasoning.length, describeTool(event))
        const contents = event.feedbackContents
        if (contents) {
          logMarkInstructions(
            event.id,
            SPECTRUM.map((step) => [step, contents[step]])
          )
        }
      }
    },
    onRejectedTools: (tools, input) => {
      logJudgeRejected(
        input.reasoning.length,
        tools.map(({ call, reason }) => `${call.toolName}: ${reason}`)
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
  // A restart keeps the same request, so a changed one is what says the last
  // build's answers no longer describe what is being built.
  if (userText !== request) {
    settled = []
    forgetReportedMarks()
    resetSteeringSteps()
  }
  beginSteeringRun()
  request = userText
  noteAgentPlan(null)
  const turnAgent = ensureAgent(store)
  turnAgent.beginTurn()
  resetMarkInteraction(store)
  // A restart after a marker answer has a revision in flight; reading early
  // would judge the redone step against the belief just corrected.
  await awaitUserModelSettled()
  // Held for the turn: the capture pipeline writes to disk while the agent
  // works, and a model that grows mid-run makes two steps incomparable.
  runPropositions = propositionsForRun(await loadSavedUserModel())
  const withheld = runPropositions.filter((p) => !p.shownToAgent).length
  logJudgeLifecycle(`loaded ${runPropositions.length} propositions, ${withheld} withheld`)
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

setMarkLockObserver((id, locked) => {
  if (locked) agent?.lockMark(id)
  else agent?.unlockMark(id)
})

setFeedbackConfirmedObserver(() => {
  agent?.suspend()
})

// Registered here because the tap must not import anything that builds a model.
setReasoningObserver({
  chunk: (reasoning) => {
    considerReasoning(reasoning)
  },
  settled: () => agent?.settled() ?? Promise.resolve()
})

export function startMetaAgentStep(step: number): void {
  agent?.beginStep(step)
}

/** Standing marks plus retired ones. Not the marks the meta-agent withdrew,
 * which were never the person's to accept. */
export function marksAwaitingAnswer(): Mark[] {
  return agent?.answerable ?? []
}

export function currentMetaInput(): JudgeInput | null {
  return agent?.currentInput ?? null
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
