import type { AskUserAnswer } from '@/app/study/ask-user'

/** All explicit answers collected during one Task Agent request. */
export interface UserModelAskUserBatch {
  requestId: string
  request: string
  answers: AskUserAnswer[]
}

export interface AskUserRetrievalCandidate {
  id: string
  score: number
}

export interface AskUserRetrievalQuestion {
  questionId: string
  embedding: AskUserRetrievalCandidate[]
}

export interface AskUserRetrievalTrace {
  questions: AskUserRetrievalQuestion[]
  shownIds: string[]
}
