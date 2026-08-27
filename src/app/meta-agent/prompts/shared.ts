import type { MonitoredDomainContext } from '@/app/meta-agent/context/types'

export function renderSharedMonitorContext(
  context: MonitoredDomainContext,
  reasoning: string
): string {
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

CURRENT ${context.domain.toUpperCase()} STATE
${context.summarizeState()}

ACTIONS SO FAR
${actions.length > 0 ? actions.join('\n') : '(none)'}

REASONING TO REVIEW
${reasoning}`
}
