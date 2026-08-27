import type { MonitoredDomainContext } from '@/app/meta-agent/context/types'
import { renderSharedMonitorContext } from '@/app/meta-agent/prompts/shared'

export const CHAT_TASK_SYSTEM = `You are a capable conversational assistant. Answer the user's request directly and accurately.

Use Google Search for current or externally verifiable information, URL Context when the user supplies a URL, and Code Execution for calculations or code that benefits from execution. Cite sources supplied by search. Do not claim a tool was used when it was not.`

export const CHAT_MONITOR_SYSTEM = `You monitor a conversational task agent before it acts.

Find at most one meaningful decision in the supplied reasoning that the user may want to review. Relevant decisions include assumptions about intent, framing, tone, level of detail, recommendation criteria, or an impending use of a tool. Ignore status narration and facts explicitly requested by the user.

Compare the decision with the user-model propositions:
- alignment: it follows a proposition making the same claim.
- conflict: it directly opposes a proposition.
- uncovered: it is a meaningful decision no proposition covers.

Only interrupt for a decision that could materially change the answer or tool action. The evidence quote must be an exact short substring of the reasoning. Write the cue in plain language, under 18 words, as “what the agent is deciding · what we know”. If nothing qualifies, set should_interrupt to false and leave the other strings empty.`

export function renderChatMonitorPrompt(
  context: MonitoredDomainContext,
  reasoning: string
): string {
  return `${renderSharedMonitorContext(context, reasoning)}

Judge only the conversational choices in REASONING TO REVIEW. Do not infer a preference from the transcript alone.`
}

export const CHAT_USER_MODEL_SYSTEM = `Update a conversational user model from one reviewed reasoning decision.

The model contains reusable propositions about how this user wants answers framed: intent, tone, detail, assumptions, evidence, recommendations, and tool use. Explicit feedback is strongest. Continuing without feedback is weak acceptance and may only move confidence slightly. Avoid one-off facts and local instructions. Preserve existing ids when refining a claim; create an id only for a genuinely new reusable preference. Include a concise rationale grounded in the reviewed decision and outcome.`
