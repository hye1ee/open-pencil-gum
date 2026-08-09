import { generateText } from 'ai'
import type { LanguageModel } from 'ai'

import { setPreviewSettledObserver } from '@/app/ai/chat/action-preview'
import {
  logJudgeError,
  logJudgeLifecycle,
  logJudgeRejected,
  logJudgeSkip,
  logJudgment,
  logMarkTool
} from '@/app/ai/chat/agent-log'
import { setMarks } from '@/app/ai/chat/mismatch'
import { createUntracedLanguageModel } from '@/app/ai/chat/model'
import { setReasoningObserver } from '@/app/ai/chat/model-trace'
import {
  backgroundProviderOptions,
  isSlotConfigured,
  modelConfigForSlot
} from '@/app/ai/model-routing'
import { getActiveEditorStore } from '@/app/editor/active-store'
import type { EditorStore } from '@/app/editor/active-store'
import { actionsSoFar, summariseCanvas, withAncestors } from '@/app/meta-agent/context'
import { setMetaAgentNodeReplacedObserver } from '@/app/meta-agent/events'
import {
  createMetaAgent,
  type AppliedMarkTool,
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

/**
 * The app-specific half of the meta-agent: which model it calls, how this
 * canvas is described to it, and where its judgment lands. `judge.ts` knows
 * none of this.
 */

/** Reasoning shares this budget on Gemini, and the answer is a short list. */
const JUDGE_MAX_TOKENS = 2048

/**
 * This call fires on every chunk of the agent's thinking, so it wants a cheap
 * model — but more than that it wants a *different* one. A judge running the
 * same model as the agent it judges shares whatever that model is blind to, and
 * agrees with the reasoning for the same reasons the reasoning was written.
 * `VITE_MODEL_META_AGENT` is how they are told apart.
 */
function judgeModel(): LanguageModel {
  return createUntracedLanguageModel(modelConfigForSlot('meta-agent'))
}

let agent: MetaAgent | null = null
let request = ''
let runPropositions: Proposition[] = []

/** One log line per mark: where it sits, what it costs, and the words in the
 * agent's own thinking it was read off — the last is the only way to tell a mark
 * that answers the reasoning from one the model reached for. */
function describeMark(mark: Mark): string {
  const where = mark.nodeId ?? 'whole design'
  const notes = mark.notes
    .map(
      (note) =>
        `${note.text} [${note.evidence.fromUserModel ?? 'nothing covers it'}] ` +
        `"${note.evidence.fromReasoning}"`
    )
    .join(' | ')
  return `  ${mark.id}  ${mark.relation}  ${where}  imp ${mark.importance}  ${notes}`
}

function describeTool(event: AppliedMarkTool): string {
  const revived = event.toolName === 'update_mark' && event.revived ? ' revived' : ''
  return (
    `${event.toolName} ${event.id}${revived} → ${event.nodeId ?? 'whole design'} ` +
    `${event.relation} imp ${event.importance}`
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
    onChanged: (marks, from) => {
      // The length off the input the answer was made from, not off a variable
      // the next chunk has already overwritten — answers land out of order with
      // the calls that started them, so a shared counter reports whichever chunk
      // arrived most recently and the log quietly attributes an answer to the
      // wrong thought.
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

/**
 * Notes the person has already answered during this build.
 *
 * Held here rather than inside the meta-agent because it has to outlive
 * `beginTurn`: answering a note restarts the turn, and everything the judge
 * knows is wiped at that boundary. Cleared when a genuinely new request comes
 * in, which is the only point at which these stop being relevant.
 */
let settled: SettledNote[] = []

export function noteSettledMarks(notes: SettledNote[]): void {
  settled = [...settled, ...notes]
}

/** A new turn: what the user asked for, and a clean slate. */
export async function startMetaAgentTurn(store: EditorStore, userText: string): Promise<void> {
  // A restart keeps the same request, so a change of request is what tells us
  // the answers from the last build no longer describe what is being built.
  if (userText !== request) {
    settled = []
    forgetReportedMarks()
  }
  request = userText
  // A turn restarted because someone answered a marker has a revision of the
  // user model in flight. Reading the file before it lands would judge the
  // redone step against the belief they just corrected.
  await awaitUserModelSettled()
  // Read once, here, and hold it for the turn. The capture pipeline writes new
  // propositions to disk while the agent works, and a model that grows mid-run
  // makes two steps of the same turn incomparable.
  const saved = await loadSavedUserModel()
  runPropositions = saved.map((proposition) => ({
    id: proposition.id,
    text: proposition.text,
    confidence: proposition.confidence,
    rationale: proposition.rationale ?? null
  }))
  logJudgeLifecycle(`loaded ${runPropositions.length} saved user-model propositions`)
  ensureAgent(store).beginTurn()
}

// The preview has run its course and the change stood, so the warnings about it
// have had their chance. Hung off the preview rather than the tool call: the
// preview *is* the window they exist for, and taking them down as the change
// lands would leave nothing to read during it.
setPreviewSettledObserver((nodeIds) => {
  agent?.retireWarnings(withAncestors(getActiveEditorStore(), nodeIds))
})

setMetaAgentNodeReplacedObserver((oldId, newId) => {
  agent?.remapNode(oldId, newId)
})

// Registered here rather than imported by the tap, which must not depend on
// anything that builds a model — see `setReasoningObserver`.
setReasoningObserver({
  start: () => {
    agent?.beginStep()
  },
  chunk: (reasoning) => {
    considerReasoning(reasoning)
  },
  settled: () => agent?.settled() ?? Promise.resolve()
})

/**
 * The marks the person had a chance to answer — standing, or retired because
 * the change they warned about landed and stood. Not the ones the meta-agent
 * withdrew, which were never theirs to accept.
 */
export function marksAwaitingAnswer(): Mark[] {
  return agent?.answerable ?? []
}

/** What the person asked for, so a turn restarted after feedback can keep it
 * rather than treating the feedback itself as the new request. */
export function currentMetaRequest(): string {
  return request
}

/**
 * The agent has thought some more. `reasoning` is everything it has thought this
 * step, not the latest piece — an answer about a half-formed thought is an
 * answer about an idea that may not survive the next sentence.
 */
export function considerReasoning(reasoning: string): void {
  if (!isSlotConfigured('meta-agent') || reasoning.trim() === '') return
  const store = getActiveEditorStore()
  ensureAgent(store).consider({
    request,
    propositions: runPropositions,
    canvas: summariseCanvas(store),
    reasoning,
    actions: actionsSoFar(store),
    settled
  })
}
