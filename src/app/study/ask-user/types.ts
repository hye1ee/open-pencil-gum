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
  | { type: 'question-answered'; question: AskUserQuestion; answer: string }
  | { type: 'question-cancelled'; question: AskUserQuestion; reason: string }
  | { type: 'question-rejected'; requestId: string; reason: string }

export interface AskUserSessionSnapshot {
  requestId: string | null
  pendingQuestion: AskUserQuestion | null
}

export type AskUserLifecycleListener = (event: AskUserLifecycleEvent) => void
export type AskUserSessionListener = (snapshot: AskUserSessionSnapshot) => void
