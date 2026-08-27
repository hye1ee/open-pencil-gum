import { composeCodeVisual } from '@/app/feedback-note/code-visual/use'
import { generateFeedbackNoteImage } from '@/app/feedback-note/image'
import type {
  FeedbackNoteRepresentationProvider,
  FeedbackNoteRepresentationResult
} from '@/app/meta-agent/core/representation'
import type { FeedbackNote } from '@/app/meta-agent/core/types'

interface OpenPencilRepresentationDependencies {
  composeCodeVisual: typeof composeCodeVisual
  generateImage: typeof generateFeedbackNoteImage
}

const DEFAULT_DEPENDENCIES: OpenPencilRepresentationDependencies = {
  composeCodeVisual,
  generateImage: generateFeedbackNoteImage
}

export function createOpenPencilRepresentationProvider(
  dependencies: OpenPencilRepresentationDependencies = DEFAULT_DEPENDENCIES
): FeedbackNoteRepresentationProvider {
  return {
    async materialize(note: FeedbackNote): Promise<FeedbackNoteRepresentationResult> {
      if (note.representation.type === 'text') return { type: 'text' }
      if (note.representation.type === 'code-visual') {
        return {
          type: 'code-visual',
          artifact: await dependencies.composeCodeVisual(note)
        }
      }
      return {
        type: 'image',
        url: await dependencies.generateImage(
          note.representation.prompt,
          note.representation.imageType,
          note.representationGoal
        )
      }
    }
  }
}

export const OPEN_PENCIL_REPRESENTATION_PROVIDER = createOpenPencilRepresentationProvider()
