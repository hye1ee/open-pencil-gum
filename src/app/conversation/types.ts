import type { UIMessage } from 'ai'

import type { Proposition } from '@/app/user-model/pipeline'

export type ConversationFeedbackRelationship = 'alignment' | 'conflict' | 'uncovered'
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

export interface ConversationFeedbackNote {
  id: string
  messageId: string | null
  cue: string
  reasoningEvidence: string
  relationship: ConversationFeedbackRelationship
  propositionIds: string[]
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
  propositions: Proposition[]
  updatedAt: number
}
