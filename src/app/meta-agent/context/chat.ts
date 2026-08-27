import { isTextUIPart } from 'ai'
import type { UIMessage } from 'ai'

import type { MonitoredDomainContext } from '@/app/meta-agent/context/types'
import type { Proposition } from '@/app/user-model/pipeline'

function messageText(message: UIMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join(' ')
    .trim()
}

export function summarizeConversation(messages: readonly UIMessage[]): string {
  if (messages.length === 0) return '(new conversation)'
  return messages
    .slice(-10)
    .map((message) => `${message.role}: ${messageText(message).slice(0, 800) || '(tool activity)'}`)
    .join('\n')
}

export function createChatContext(input: {
  messages: readonly UIMessage[]
  userRequest: string
  propositions: readonly Proposition[]
  actions: readonly string[]
}): MonitoredDomainContext {
  return {
    domain: 'chat',
    userRequest: input.userRequest,
    plan: null,
    propositions: input.propositions,
    summarizeState: () => summarizeConversation(input.messages),
    actionsSoFar: () => input.actions
  }
}
