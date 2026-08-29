export interface UserModelReasoningFeedbackItem {
  reviewId: string
  chunkIndex: number
  reasoningChunk: string
  reasoningSoFar: string
  selectedReasoning: string | null
  feedback: string
}

/** Explicit reasoning feedback collected before one request/step is replayed. */
export interface UserModelReasoningFeedbackBatch {
  requestId: string
  request: string
  step: number | null
  items: UserModelReasoningFeedbackItem[]
}

export interface UserInitiatedRetrievalCandidate {
  id: string
  score: number
}

export interface UserInitiatedRetrievalItem {
  reviewId: string
  embedding: UserInitiatedRetrievalCandidate[]
}

export interface UserInitiatedRetrievalTrace {
  items: UserInitiatedRetrievalItem[]
  shownIds: string[]
}
