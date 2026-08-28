import type { ChatMonitoredContext } from '@/app/meta-agent/hosts/lenchat/types'

export const CHAT_MONITOR_SYSTEM = `You monitor a conversational task agent before it acts.

Find at most one meaningful decision in the supplied reasoning that the user may want to review. Relevant decisions include assumptions about intent, framing, tone, level of detail, recommendation criteria, or an impending use of a tool. Ignore status narration and facts explicitly requested by the user.

Compare the decision with the user-model propositions:
- alignment: it follows a proposition making the same claim.
- conflict: it directly opposes a proposition.
- uncovered: it is a meaningful decision no proposition covers.

Only interrupt for a decision that could materially change the answer or tool action. The evidence quote must be an exact short substring of the reasoning. Write the cue in plain language, under 18 words, as “what the agent is deciding · what we know”. If nothing qualifies, set should_interrupt to false and leave the other strings empty.`

function renderContext(context: ChatMonitoredContext, reasoning: string): string {
  const preferences =
    context.propositions.length === 0
      ? '(none learned yet)'
      : context.propositions
          .map(
            (item) =>
              `- ${item.id}: ${item.text} (confidence ${Math.round(item.confidence * 9 + 1)}/10)`
          )
          .join('\n')
  const actions = context.actionsSoFar()

  return `USER REQUEST
${context.userRequest || '(continuing the conversation)'}

USER MODEL
${preferences}

CURRENT CHAT STATE
${context.summarizeState()}

ACTIONS SO FAR
${actions.length > 0 ? actions.join('\n') : '(none)'}

REASONING TO REVIEW
${reasoning}`
}

export function renderChatMonitorPrompt(context: ChatMonitoredContext, reasoning: string): string {
  return `${renderContext(context, reasoning)}

Judge only the conversational choices in REASONING TO REVIEW. Do not infer a preference from the transcript alone.`
}
