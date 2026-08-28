import type { UIMessage } from 'ai'

import type { ChatMonitoredContext } from '@/app/meta-agent-chat/types'
import { summarizeLenChatConversation } from '@/app/meta-agent/hosts/lenchat/input'
import type { Proposition } from '@/app/user-model/pipeline'

export { summarizeLenChatConversation as summarizeConversation }

export function createChatContext(input: {
  messages: readonly UIMessage[]
  userRequest: string
  propositions: readonly Proposition[]
  actions: readonly string[]
}): ChatMonitoredContext {
  return {
    domain: 'chat',
    userRequest: input.userRequest,
    propositions: input.propositions,
    summarizeState: () => summarizeLenChatConversation(input.messages),
    actionsSoFar: () => input.actions
  }
}
