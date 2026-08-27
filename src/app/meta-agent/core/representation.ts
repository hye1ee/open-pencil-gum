import type { CodeVisualArtifact, FeedbackNote } from '@/app/meta-agent/core/types'

export type FeedbackNoteRepresentationResult =
  | { type: 'text' }
  | { type: 'code-visual'; artifact: CodeVisualArtifact }
  | { type: 'image'; url: string }

export interface FeedbackNoteRepresentationProvider {
  materialize(note: FeedbackNote): Promise<FeedbackNoteRepresentationResult>
}
