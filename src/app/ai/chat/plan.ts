import { generateText } from 'ai'
import type { ImagePart, LanguageModel, UserContent } from 'ai'

import { backgroundProviderOptions } from '@/app/ai/model-routing'
import { recordAuxUsage } from '@/app/ai/tools'
import type { EditorStore } from '@/app/editor/active-store'

/**
 * The run's design direction, decided by its own model call rather than by the
 * agent writing itself a plan inside its first tool step.
 *
 * A plan the agent writes as text lands in the transcript once and is never seen
 * again. Twenty steps and a couple of user interventions later it has been
 * pushed far behind the growing tool history, and the agent starts re-deriving
 * its goal from the conversation each step. Owning the plan in code means it can
 * be injected in the same place every step, at a fixed cost.
 *
 * Deliberately TINY — one or two lines. A long checklist costs hundreds of
 * output tokens to keep up to date, drifts out of sync with the canvas, and ends
 * up listing finished work as outstanding. Progress is legible from the canvas
 * image that is already injected; the plan only has to hold the *direction*.
 */

const PLAN_SYSTEM = `You are the planning module for a UI design agent working on a canvas.

Read the user's request and the current canvas, then state the design direction for this run.

### Output
ONE or TWO short lines. A high-level directive, nothing else.

- Say the creative direction or the next design move — not steps, not pixel values, not tool names.
- If the user has a meaningful selection, name its node id and name in the directive.
- Do not summarise the conversation or describe the canvas back to me.
- No preamble, no markdown headings, no numbered list.

### If you are given observations about this person
A block of observations about how this person works may follow the request. They are things noticed on earlier sessions, not instructions, and they carry a confidence out of ten.

Use them to settle how the request should be carried out — which direction to take among several that all answer it. Do not use them to change what the directive is about: the request decides that, and an observation is never a reason to add a goal nobody asked for. Where the request and an observation disagree, the request wins and the observation is dropped.

Do not name the observations in the directive. It is one or two lines about what to build; the reasoning behind them belongs nowhere.

### Examples
Build a pricing card with a clear plan/price hierarchy and one accent colour.
Refine the header composition for balance; keep the existing type scale.
Restyle the selected button (0:14 "CTA") to match the user's new accent.`

const PLAN_UPDATE_SYSTEM = `You maintain a UI design agent's directive while it works, while the user edits the same canvas, and while the user sends it messages.

You are given the current directive and one or both of:
- WHAT THE USER CHANGED — edits the user made on the canvas with their own hands
- WHAT THE USER SAID — a message the user sent the agent mid-run

The two are opposites: a change is something already done, a message is something being asked for.

### A message is an instruction — fold it in
The directive is the only thing the agent still sees several steps from now, so anything the user asked for has to survive here or it is lost. Rewrite the directive to cover it whenever the message asks for something the directive does not already imply — another variation, a different palette, a new section, a change of goal.
Leave the directive alone only when the message adds nothing to do: praise, a question, or a remark about work the directive already covers.

### A change is NOT an instruction — default to UNCHANGED
The agent is told about canvas changes separately, and the user editing one element is not a new rule for the whole design. Return the directive word for word unless the change **conflicts with the high-level direction** — a different kind of design, a different goal.

Do NOT rewrite for:
- a colour, size, spacing or text change the user made
- the user doing part of the work themselves
- the user duplicating something to keep their own copy
- anything that merely adds detail to the existing direction

### Observations about this person are not a reason to rewrite
A block of observations about how this person works may be included. It is the same block every time and nothing in it is news, so on its own it never justifies a change. Use it only to word a rewrite you were already going to make for one of the reasons above.

### When you do rewrite
- Change only the direction, never add steps or implementation detail.
- Keep any node ids and names already in the directive.
- Keep the same shape: one or two short lines.

### Output
The directive, and nothing else. No preamble, no explanation of what you changed.`

/** Build the user message for a plan call. */
function planInput(blocks: string[], image: ImagePart | null): UserContent {
  const content: UserContent = blocks.map((text) => ({ type: 'text' as const, text }))
  if (image) content.push(image)
  return content
}

/**
 * Draft the directive for this run. Returns null on failure — a run without a
 * directive is degraded, not broken, so a planning error must never take the
 * build down.
 */
export async function runPlan(
  model: LanguageModel,
  store: EditorStore,
  request: string,
  image: ImagePart | null,
  userModelPropositions: string | null
): Promise<string | null> {
  // After the request, so the request is what the directive is read against and
  // the observations arrive as something to weigh against it.
  const blocks = [`USER REQUEST:\n${request}`]
  if (userModelPropositions) blocks.push(userModelPropositions)
  try {
    const result = await generateText({
      model,
      providerOptions: backgroundProviderOptions('task-planning'),
      system: PLAN_SYSTEM,
      messages: [{ role: 'user', content: planInput(blocks, image) }]
    })
    recordPlanUsage(result, store)
    return result.text.trim() || null
  } catch (e) {
    console.warn('[agent/plan] failed, continuing without a directive:', e)
    return null
  }
}

/**
 * Reconcile the directive with what the user just did. Only called when there
 * was an intervention — the agent runs for twenty-odd steps, so doing this every
 * step would cost more than the build.
 *
 * Canvas edits and chat messages are handed over under separate labels on
 * purpose. Merged into one block they read as one kind of event, and the
 * conservative default written for edits ("the user made their own copy —
 * leave the directive alone") swallowed the messages too. A request that never
 * reaches the directive is gone after a single step, since the block we inject
 * per step is not kept in the transcript.
 */
export async function runPlanUpdate(
  model: LanguageModel,
  store: EditorStore,
  plan: string,
  change: { edits: string | null; messages: string[] },
  userModelPropositions: string | null
): Promise<string> {
  const blocks = [`CURRENT DIRECTIVE:\n${plan}`]
  if (change.edits) blocks.push(`WHAT THE USER CHANGED:\n${change.edits}`)
  if (change.messages.length > 0) {
    blocks.push(`WHAT THE USER SAID:\n${change.messages.join('\n')}`)
  }
  // Last, after what actually happened. This block is identical on every call
  // and is the one thing here that is never a reason to rewrite anything.
  if (userModelPropositions) blocks.push(userModelPropositions)
  try {
    const result = await generateText({
      model,
      providerOptions: backgroundProviderOptions('task-planning'),
      system: PLAN_UPDATE_SYSTEM,
      messages: [{ role: 'user', content: planInput(blocks, null) }]
    })
    recordPlanUsage(result, store)
    return result.text.trim() || plan
  } catch (e) {
    console.warn('[agent/plan-update] failed, keeping the directive:', e)
    return plan
  }
}

type PlanResult = {
  usage: {
    inputTokens?: number
    outputTokens?: number
    inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number }
  }
}

/** Report the call's tokens without advancing the step budget — these calls run
 * no tools, and letting them consume steps would trip the step-limit warning. */
function recordPlanUsage(result: PlanResult, store: EditorStore): void {
  recordAuxUsage(
    {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      cacheReadTokens: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
      cacheWriteTokens: result.usage.inputTokenDetails?.cacheWriteTokens ?? 0,
      timestamp: Date.now()
    },
    store
  )
}
