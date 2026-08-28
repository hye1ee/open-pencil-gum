import type { FeedbackNote, FeedbackNoteRelationship } from '@/app/feedback-note/types'

export interface FeedbackPoint {
  x: number
  y: number
}

export interface FeedbackVisualTarget {
  id: string
  label: string
}

interface TargetedVisualSelection {
  target?: FeedbackVisualTarget
}

export type FeedbackSelection =
  | { type: 'none' }
  | ({
      type: 'region'
      x: number
      y: number
      width: number
      height: number
    } & TargetedVisualSelection)
  | ({ type: 'point'; x: number; y: number } & TargetedVisualSelection)
  | ({ type: 'arrow'; start: FeedbackPoint; end: FeedbackPoint } & TargetedVisualSelection)
  | ({ type: 'sequence'; points: FeedbackPoint[] } & TargetedVisualSelection)
  | ({ type: 'freehand'; points: FeedbackPoint[] } & TargetedVisualSelection)
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
  annotatedImage?: Uint8Array
}

/** The common generator needs only the proposition fields it can cite. Hosts
 * can supply propositions from separate User Model instances. */
export interface FeedbackDraftProposition {
  id: string
  text: string
  confidence: number
  rationale: string | null
}

export interface FeedbackDraftRequest extends FeedbackDraftInput {
  propositions: readonly FeedbackDraftProposition[]
  previousFeedback: readonly ConfirmedFeedback[]
}
