export type HandsOffAnnotationPolarity = 'liked' | 'disliked'

export type HandsOffAnnotationPhase = 'reasoning' | 'final-output'

/**
 * One drag-selected span the participant marked while reviewing a hands-off
 * run. Annotations are experiment measurements only: they never reach the
 * task agent and never update the user model.
 */
export interface HandsOffTextSelectionAnnotation {
  id: string
  phase: HandsOffAnnotationPhase
  streamId: number
  chunkIndex: number
  /** LenCanvas only; LenChat annotations carry null. */
  stepNumber: number | null
  selectedText: string
  startOffset: number
  endOffset: number
  polarity: HandsOffAnnotationPolarity
  createdAt: number
}

/**
 * The participant's verdict on one executed LenCanvas step. Step number 0
 * stands for the final text response, which executes no tools.
 */
export interface HandsOffStepActionAnnotation {
  stepNumber: number
  executedToolNames: readonly string[]
  targetNodeIds: readonly string[]
  polarity: HandsOffAnnotationPolarity | 'skipped'
  createdAt: number
}

export function describeTextSelectionAnnotationForLog(
  annotation: HandsOffTextSelectionAnnotation
): string {
  const step = annotation.stepNumber === null ? '' : ` step=${annotation.stepNumber}`
  return (
    `phase=${annotation.phase} stream=${annotation.streamId} chunk=${annotation.chunkIndex}` +
    `${step} polarity=${annotation.polarity}` +
    ` offsets=${annotation.startOffset}-${annotation.endOffset}` +
    ` text="${annotation.selectedText}"`
  )
}

export function describeStepActionAnnotationForLog(
  annotation: HandsOffStepActionAnnotation
): string {
  return (
    `phase=step-action step=${annotation.stepNumber} polarity=${annotation.polarity}` +
    ` tools=${annotation.executedToolNames.join(',') || '(none)'}` +
    ` targets=${annotation.targetNodeIds.join(',') || '(none)'}`
  )
}

export function countAnnotationsByPolarity(
  annotations: readonly HandsOffTextSelectionAnnotation[],
  phase: HandsOffAnnotationPhase
): { liked: number; disliked: number } {
  const matching = annotations.filter((annotation) => annotation.phase === phase)
  return {
    liked: matching.filter((annotation) => annotation.polarity === 'liked').length,
    disliked: matching.filter((annotation) => annotation.polarity === 'disliked').length
  }
}
