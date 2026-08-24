import type { FeedbackNote, FeedbackNoteRelationship } from '@/app/feedback-note/types'

export interface FeedbackPoint {
  x: number
  y: number
}

export type FeedbackSelection =
  | { type: 'region'; x: number; y: number; width: number; height: number }
  | { type: 'point'; x: number; y: number }
  | { type: 'arrow'; start: FeedbackPoint; end: FeedbackPoint }
  | { type: 'sequence'; points: FeedbackPoint[] }
  | { type: 'freehand'; points: FeedbackPoint[] }
  | {
      type: 'text'
      text: string
      source: 'cue' | 'reasoning' | 'proposition' | 'proposition-rationale'
      start: number
      end: number
    }

export interface ConfirmedFeedback {
  id: string
  noteId: string
  topic: string
  noteContext: {
    cue: string
    representationGoal: string
    relationship: FeedbackNoteRelationship
    reasoningEvidence: string
    propositionIds: string[]
  }
  selection: FeedbackSelection
  feedback: string
  createdAt: number
}

export interface FeedbackDraftInput {
  note: FeedbackNote
  selection: FeedbackSelection
  overviewImage?: Uint8Array
  selectionImage?: Uint8Array
}
