import { logFeedbackReplay, logFeedbackStep } from '@/app/ai/chat/agent-log'
import type { ConfirmedFeedback } from '@/app/feedback-note/draft/types'
import type { FeedbackNote } from '@/app/feedback-note/types'
import { resetObservedFeedbackNotes } from '@/app/feedback-note/user-model'

export type FeedbackNoteResolution = 'implicitly-accepted' | 'explicit-feedback'

export interface StepFeedbackOutcome {
  note: FeedbackNote
  resolution: FeedbackNoteResolution
  feedbackItems: ConfirmedFeedback[]
}

export interface StepFeedbackResult {
  step: number
  reasoningChunks: Array<{ chunk: number; text: string }>
  outcomes: StepFeedbackOutcome[]
}

type StepFeedbackHandler = (result: StepFeedbackResult) => Promise<void>

const reasoningByStep = new Map<number, Map<number, string>>()
const outcomesByStep = new Map<number, StepFeedbackOutcome[]>()
let resolutionHandler: StepFeedbackHandler | null = null
let replayStep: number | null = null

export function recordFeedbackReasoning(step: number, chunk: number, text: string): boolean {
  if (replayStep !== null) return false
  const chunks = reasoningByStep.get(step) ?? new Map<number, string>()
  chunks.set(chunk, text)
  reasoningByStep.set(step, chunks)
  return true
}

export function recordFeedbackOutcome(
  note: FeedbackNote,
  feedbackItems: ConfirmedFeedback[]
): void {
  const outcomes = outcomesByStep.get(note.originStep) ?? []
  const resolution = feedbackItems.length > 0 ? 'explicit-feedback' : 'implicitly-accepted'
  outcomes.push({
    note,
    resolution,
    feedbackItems: [...feedbackItems]
  })
  outcomesByStep.set(note.originStep, outcomes)
  logFeedbackStep(
    note.originStep,
    'note',
    `${note.id} chunk=${note.originChunk} ${resolution} feedback-items=${feedbackItems.length}`
  )
}

export function takeStepFeedbackResult(step: number): StepFeedbackResult {
  const reasoningChunks = [...(reasoningByStep.get(step) ?? new Map()).entries()]
    .sort(([a], [b]) => a - b)
    .map(([chunk, text]) => ({ chunk, text }))
  const outcomes = outcomesByStep.get(step) ?? []
  reasoningByStep.delete(step)
  outcomesByStep.delete(step)
  return { step, reasoningChunks, outcomes }
}

export function hasExplicitStepFeedback(result: StepFeedbackResult): boolean {
  return result.outcomes.some((outcome) => outcome.resolution === 'explicit-feedback')
}

export function setStepFeedbackHandler(handler: StepFeedbackHandler | null): void {
  resolutionHandler = handler
}

export async function submitStepFeedback(result: StepFeedbackResult): Promise<boolean> {
  if (!resolutionHandler) return false
  await resolutionHandler(result)
  return true
}

export function beginFeedbackReplay(step: number): void {
  replayStep = step
  logFeedbackReplay(
    step,
    'started',
    'interactive notes suppressed until the retried step completes its first tool action'
  )
}

export function interactiveFeedbackStep(step: number): number | null {
  return replayStep === null ? step : null
}

export function currentFeedbackReplayStep(): number | null {
  return replayStep
}

export function completeFeedbackReplay(): number | null {
  const completedStep = replayStep
  replayStep = null
  return completedStep
}

export function resetStepFeedbackSession(): void {
  reasoningByStep.clear()
  outcomesByStep.clear()
  replayStep = null
  resetObservedFeedbackNotes()
}
