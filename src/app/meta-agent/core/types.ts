/** The stable user-model view consumed by every Meta Agent host. */
export interface Proposition {
  id: string
  text: string
  confidence: number
  rationale: string | null
  /** Whether the Task Agent received this proposition for the current run. */
  shownToAgent: boolean
}

export type FeedbackNoteRelationship = 'alignment' | 'conflict' | 'uncovered'
export type FeedbackNoteImageStatus = 'loading' | 'ready' | 'failed'
export type FeedbackNoteCodeVisualType =
  | 'artifact'
  | 'spectrum'
  | 'flow'
  | 'comparison'
  | 'palette'
  | 'wireframe'
export type FeedbackNoteCodeVisualStatus = 'loading' | 'ready' | 'failed'
export type FeedbackNoteHistoryStatus = 'active' | 'continued' | 'answered'
export type FeedbackNoteHistoryResolution = 'implicitly-accepted' | 'explicit-feedback'
export type FeedbackNoteImageType =
  | 'illustration'
  | 'scene'
  | 'metaphor'
  | 'texture'
  | 'photographic-reference'
  | 'expressive-style'

export type FeedbackNoteRepresentation =
  | { type: 'text' }
  | {
      type: 'code-visual'
      visualType: FeedbackNoteCodeVisualType
      brief: CodeVisualBrief
      artifact: CodeVisualArtifact | null
      status: FeedbackNoteCodeVisualStatus
    }
  | {
      type: 'image'
      imageType: FeedbackNoteImageType
      prompt: string
      url: string | null
      status: FeedbackNoteImageStatus
    }

export interface CodeVisualAlternative {
  label: string
  description: string
}

export interface CodeVisualBrief {
  subject: string
  decision: string
  alternatives: CodeVisualAlternative[]
  mustShow: string[]
  formatHint: 'html' | 'svg' | null
}

export interface CodeVisualTarget {
  id: string
  label: string
}

export interface CodeVisualArtifact {
  format: 'html' | 'svg'
  srcdoc: string
  targets: CodeVisualTarget[]
}

export type FeedbackCueSegment =
  | {
      text: string
      source: 'neutral'
    }
  | {
      text: string
      source: 'reasoning'
      evidenceQuote: string
    }
  | {
      text: string
      source: 'proposition'
      propositionId: string
      propositionText: string
      propositionConfidence: number
      propositionRationale: string | null
    }

export interface FeedbackNote {
  id: string
  originStep: number
  originChunk: number
  topic: string
  relationship: FeedbackNoteRelationship
  representation: FeedbackNoteRepresentation
  representationGoal: string
  text: string
  cueSegments: FeedbackCueSegment[]
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
  representationType: FeedbackNoteRepresentation['type']
  representationSubtype: FeedbackNoteCodeVisualType | FeedbackNoteImageType | null
  representationGoal: string
  text: string
  nodeId: string | null
  evidenceFromReasoning: string
  propositionIds: string[]
  status: FeedbackNoteHistoryStatus
  outcome: {
    resolution: FeedbackNoteHistoryResolution
    selections: string[]
    feedback: string[]
  } | null
}
