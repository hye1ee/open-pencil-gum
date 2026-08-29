import type {
  AskUserInput,
  AskUserLifecycleEvent,
  AskUserLifecycleListener,
  AskUserQuestion,
  AskUserResult,
  AskUserSessionListener,
  AskUserSessionSnapshot
} from '@/app/study/ask-user/types'

interface PendingQuestion {
  question: AskUserQuestion
  resolve(result: AskUserResult): void
}

interface AskUserSessionOptions {
  onEvent?: AskUserLifecycleListener
}

function cleanText(value: string): string {
  return value.trim().replaceAll(/\s+/g, ' ')
}

function uniqueOptions(options: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of options) {
    const clean = cleanText(value)
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    result.push(clean)
  }
  return result
}

function copyQuestion(question: AskUserQuestion): AskUserQuestion {
  return { ...question, options: [...question.options] }
}

/**
 * Shared blocking state for the ask_user tool.
 *
 * A request may contain multiple sequential questions. Hosts own presentation;
 * this class owns the lifecycle and the promise that pauses the tool loop.
 */
export class AskUserSession {
  private readonly listeners = new Set<AskUserSessionListener>()
  private readonly onEvent: AskUserLifecycleListener | undefined
  private activeRequestId: string | null = null
  private nextSequence = 0
  private pending: PendingQuestion | null = null

  constructor(options: AskUserSessionOptions = {}) {
    this.onEvent = options.onEvent
  }

  beginRequest(requestId: string): void {
    const cleanRequestId = cleanText(requestId)
    if (!cleanRequestId) throw new Error('ask_user requires a request id')
    if (this.activeRequestId === cleanRequestId) return
    this.cancel('request-replaced')
    this.activeRequestId = cleanRequestId
    this.nextSequence = 0
    this.emit({ type: 'request-started', requestId: cleanRequestId })
    this.notify()
  }

  ask(input: AskUserInput): Promise<AskUserResult> {
    const requestId = this.activeRequestId
    if (!requestId) throw new Error('ask_user cannot run without an active request')
    if (this.pending) {
      const reason = 'another ask_user question is still waiting for an answer'
      this.emit({ type: 'question-rejected', requestId, reason })
      throw new Error(reason)
    }
    const questionText = cleanText(input.question)
    if (!questionText) throw new Error('ask_user requires one non-empty question')
    const options = uniqueOptions(input.options)
    if (options.length !== 3) {
      throw new Error('ask_user requires exactly three distinct answer options')
    }
    const question: AskUserQuestion = {
      id: crypto.randomUUID(),
      requestId,
      sequence: ++this.nextSequence,
      question: questionText,
      options,
      createdAt: Date.now()
    }

    const result = new Promise<AskUserResult>((resolve) => {
      this.pending = { question, resolve }
    })
    this.emit({ type: 'question-asked', question: copyQuestion(question) })
    this.notify()
    return result
  }

  answer(answer: string, selectedOption: string | null = null): boolean {
    const pending = this.pending
    if (!pending) return false
    const cleanAnswer = cleanText(answer)
    const cleanSelection = selectedOption ? cleanText(selectedOption) : null
    if (!cleanAnswer) return false
    if (cleanSelection && !pending.question.options.includes(cleanSelection)) return false

    this.pending = null
    pending.resolve({
      status: 'answered',
      questionId: pending.question.id,
      answer: cleanAnswer,
      selectedOption: cleanSelection
    })
    this.emit({
      type: 'question-answered',
      question: copyQuestion(pending.question),
      answer: cleanAnswer
    })
    this.notify()
    return true
  }

  cancel(reason = 'cancelled'): boolean {
    const pending = this.pending
    if (!pending) return false
    this.pending = null
    pending.resolve({ status: 'cancelled', questionId: pending.question.id, reason })
    this.emit({
      type: 'question-cancelled',
      question: copyQuestion(pending.question),
      reason
    })
    this.notify()
    return true
  }

  endRequest(reason = 'request-ended'): void {
    this.cancel(reason)
    this.activeRequestId = null
    this.nextSequence = 0
    this.notify()
  }

  snapshot(): AskUserSessionSnapshot {
    return {
      requestId: this.activeRequestId,
      pendingQuestion: this.pending ? copyQuestion(this.pending.question) : null
    }
  }

  subscribe(listener: AskUserSessionListener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  private emit(event: AskUserLifecycleEvent): void {
    this.onEvent?.(event)
  }

  private notify(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}
