import { isTextUIPart } from 'ai'
import type { UIMessage } from 'ai'

import type { ChatMonitoredContext } from '@/app/meta-agent-chat/types'
import type { ChatProposition } from '@/app/user-model-chat/types'

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
  propositions: readonly ChatProposition[]
  actions: readonly string[]
}): ChatMonitoredContext {
  return {
    domain: 'chat',
    userRequest: input.userRequest,
    propositions: input.propositions,
    summarizeState: () => summarizeConversation(input.messages),
    actionsSoFar: () => input.actions
  }
}
