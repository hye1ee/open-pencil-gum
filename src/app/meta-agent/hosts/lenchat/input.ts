import { isTextUIPart } from 'ai'
import type { UIMessage } from 'ai'

import type { FeedbackNoteHistoryItem, Proposition } from '@/app/meta-agent/core/types'
import type { ChatFeedbackNotePromptInput } from '@/app/meta-agent/domains/chat/prompt'
import type { ChatProposition } from '@/app/user-model-chat/types'

const MAX_CONVERSATION_MESSAGES = 10
const MAX_MESSAGE_CHARACTERS = 800
const TASK_AGENT_PROPOSITION_THRESHOLD = 0.35

export interface LenChatMetaAgentContext {
  messages: readonly UIMessage[]
  request: string
  propositions: readonly ChatProposition[]
  completedActions: readonly string[]
  previousNotes?: readonly FeedbackNoteHistoryItem[]
}

export interface LenChatFeedbackNoteSource extends LenChatMetaAgentContext {
  reasoning: string
}

export type LenChatFeedbackNoteInput = ChatFeedbackNotePromptInput

function messageText(message: UIMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join(' ')
    .trim()
}

export function summarizeLenChatConversation(messages: readonly UIMessage[]): string {
  if (messages.length === 0) return '(new conversation)'
  return messages
    .slice(-MAX_CONVERSATION_MESSAGES)
    .map(
      (message) =>
        `${message.role}: ${messageText(message).slice(0, MAX_MESSAGE_CHARACTERS) || '(tool activity)'}`
    )
    .join('\n')
}

function adaptProposition(proposition: ChatProposition): Proposition {
  return {
    id: proposition.id,
    text: proposition.text,
    confidence: proposition.confidence,
    rationale: proposition.rationale,
    shownToAgent: proposition.confidence >= TASK_AGENT_PROPOSITION_THRESHOLD
  }
}

export function buildLenChatFeedbackNoteInput(
  source: LenChatFeedbackNoteSource
): LenChatFeedbackNoteInput {
  return {
    request: source.request,
    plan: null,
    reasoning: source.reasoning,
    propositions: source.propositions.map(adaptProposition),
    conversation: summarizeLenChatConversation(source.messages),
    completedActions: [...source.completedActions],
    previousNotes: source.previousNotes
  }
}
