import { isTextUIPart } from 'ai'
import type { UIMessage } from 'ai'

import { selectTaskAgentPropositionsByRelevance } from '@/app/ai/chat/user-model-propositions'
import type { FeedbackNoteHistoryItem, Proposition } from '@/app/meta-agent/core/types'
import type { ChatFeedbackNotePromptInput } from '@/app/meta-agent/domains/chat/prompt'
import { getStudyRuntime } from '@/app/study/runtime'
import type { Proposition as UserModelProposition } from '@/app/user-model/pipeline'

const MAX_CONVERSATION_MESSAGES = 10
const MAX_MESSAGE_CHARACTERS = 800

export interface LenChatMetaAgentContext {
  messages: readonly UIMessage[]
  request: string
  /** The embedding the Task Agent selection ranked against this run; null
   * means it fell back to confidence order. */
  requestEmbedding: number[] | null
  propositions: readonly UserModelProposition[]
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

// shownToAgent mirrors the actual Task Agent selection — same function, same
// request embedding — so the flag can never disagree with what the agent was
// told.
function adaptPropositions(
  propositions: readonly UserModelProposition[],
  requestEmbedding: number[] | null
): Proposition[] {
  const selected = selectTaskAgentPropositionsByRelevance(
    propositions,
    getStudyRuntime().condition,
    requestEmbedding
  )
  const selectedIds = new Set(selected.map((proposition) => proposition.id))
  return propositions.map((proposition) => ({
    id: proposition.id,
    text: proposition.text,
    confidence: proposition.confidence,
    rationale: proposition.rationale,
    shownToAgent: selectedIds.has(proposition.id)
  }))
}

export function buildLenChatFeedbackNoteInput(
  source: LenChatFeedbackNoteSource
): LenChatFeedbackNoteInput {
  return {
    request: source.request,
    plan: null,
    reasoning: source.reasoning,
    propositions: adaptPropositions(source.propositions, source.requestEmbedding),
    conversation: summarizeLenChatConversation(source.messages),
    completedActions: [...source.completedActions],
    previousNotes: source.previousNotes
  }
}
