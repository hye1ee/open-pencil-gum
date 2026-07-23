import { generateText } from 'ai'
import type { ImagePart, LanguageModel, UserContent } from 'ai'

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

### Examples
Build a pricing card with a clear plan/price hierarchy and one accent colour.
Refine the header composition for balance; keep the existing type scale.
Restyle the selected button (0:14 "CTA") to match the user's new accent.`

const PLAN_UPDATE_SYSTEM = `You maintain a UI design agent's directive while it works and the user edits the same canvas.

You are given the current directive and what the user just did.

### Default: return the directive UNCHANGED
Return it word for word in almost every case. Only rewrite it when the user's action **conflicts with the high-level direction** — a different kind of design, a different goal, an explicit new instruction.

Do NOT rewrite for:
- a colour, size, spacing or text change (the agent is told about those separately)
- the user doing part of the work themselves
- the user making their own copy or variation
- anything that merely adds detail to the existing direction

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
  image: ImagePart | null
): Promise<string | null> {
  try {
    const result = await generateText({
      model,
      system: PLAN_SYSTEM,
      messages: [{ role: 'user', content: planInput([`USER REQUEST:\n${request}`], image) }]
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
 */
export async function runPlanUpdate(
  model: LanguageModel,
  store: EditorStore,
  plan: string,
  change: string
): Promise<string> {
  try {
    const result = await generateText({
      model,
      system: PLAN_UPDATE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: planInput([`CURRENT DIRECTIVE:\n${plan}`, `WHAT THE USER DID:\n${change}`], null)
        }
      ]
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
