import type { UIMessage } from 'ai'

import type { FeedbackNoteRepresentation } from '@/app/meta-agent/core/types'
import type { ChatProposition } from '@/app/user-model-chat/types'

export type ConversationFeedbackRelationship = 'alignment' | 'conflict' | 'uncovered'
export type ConversationFeedbackStatus = 'pending' | 'continued' | 'answered'
export type ConversationToolState = 'running' | 'complete' | 'failed'

export interface ConversationToolActivity {
  id: string
  name: string
  label: string
  state: ConversationToolState
  input?: unknown
  output?: unknown
  errorText?: string
  providerExecuted?: boolean
}

export interface ConversationReasoningChunk {
  streamId: number
  chunkIndex: number
  text: string
}

export interface ConversationFeedbackNote {
  id: string
  messageId: string | null
  originStep: number
  originChunk: number
  topic: string
  cue: string
  reasoningEvidence: string
  relationship: ConversationFeedbackRelationship
  representation: FeedbackNoteRepresentation
  representationGoal: string
  propositionIds: string[]
  status: ConversationFeedbackStatus
  reply: string | null
  createdAt: number
}

export interface ConversationRecord {
  id: string
  title: string
  messages: UIMessage[]
  createdAt: number
  updatedAt: number
}

export interface ConversationPreferencesRecord {
  id: 'chat'
  propositions: ChatProposition[]
  updatedAt: number
}
