export interface AskUserInput {
  question: string
  options: readonly string[]
}

export interface AskUserQuestion {
  id: string
  requestId: string
  sequence: number
  question: string
  options: string[]
  createdAt: number
}

/** One completed ask_user exchange. The final answer stays separate from the
 * selected suggestion because the user may choose an option and then qualify
 * or rewrite it before submitting. */
export interface AskUserAnswer {
  question: AskUserQuestion
  answer: string
  selectedOption: string | null
  answeredAt: number
}

export type AskUserResult =
  | {
      status: 'answered'
      questionId: string
      answer: string
      selectedOption: string | null
    }
  | {
      status: 'cancelled'
      questionId: string
      reason: string
    }

export type AskUserLifecycleEvent =
  | { type: 'request-started'; requestId: string }
  | { type: 'question-asked'; question: AskUserQuestion }
  | {
      type: 'question-answered'
      question: AskUserQuestion
      answer: string
      selectedOption: string | null
    }
  | { type: 'question-cancelled'; question: AskUserQuestion; reason: string }
  | { type: 'question-rejected'; requestId: string; reason: string }

export interface AskUserSessionSnapshot {
  requestId: string | null
  pendingQuestion: AskUserQuestion | null
}

export type AskUserLifecycleListener = (event: AskUserLifecycleEvent) => void
export type AskUserSessionListener = (snapshot: AskUserSessionSnapshot) => void
