export type FeedbackNoteRelationship = 'alignment' | 'conflict' | 'uncovered'
export type FeedbackNoteMode = 'text' | 'visual'
export type FeedbackNoteVisualType = 'diagram' | 'artifact' | 'illustration'
export type FeedbackNoteImageStatus = 'none' | 'loading' | 'ready' | 'failed'
export type FeedbackNoteHistoryStatus = 'active' | 'continued' | 'answered'

export interface FeedbackNote {
  id: string
  originStep: number
  originChunk: number
  topic: string
  relationship: FeedbackNoteRelationship
  mode: FeedbackNoteMode
  visualType: FeedbackNoteVisualType | null
  representationGoal: string
  text: string
  imagePrompt: string | null
  imageUrl: string | null
  imageStatus: FeedbackNoteImageStatus
  annotationAffordance: string
  nodeId: string | null
  evidenceFromReasoning: string
  propositionIds: string[]
}

export interface FeedbackNoteHistoryItem {
  id: string
  originStep: number
  originChunk: number
  topic: string
  relationship: FeedbackNoteRelationship
  mode: FeedbackNoteMode
  visualType: FeedbackNoteVisualType | null
  representationGoal: string
  text: string
  annotationAffordance: string
  nodeId: string | null
  evidenceFromReasoning: string
  propositionIds: string[]
  status: FeedbackNoteHistoryStatus
}
