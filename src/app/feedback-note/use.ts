import { reactive } from 'vue'

import { beginMetaAgentActivity } from '@/app/ai/chat/agent-activity'
import { logFeedbackNoteCode, logFeedbackNoteImage, logFeedbackStep } from '@/app/ai/chat/agent-log'
import { pauseTurn, resumeTurn } from '@/app/ai/chat/agent-turn'
import { feedbackSelectionLabel } from '@/app/feedback-note/draft/selection'
import type { ConfirmedFeedback } from '@/app/feedback-note/draft/types'
import { openPencilFeedbackHistory } from '@/app/feedback-note/hosts/open-pencil/history'
import { readFeedbackNote } from '@/app/feedback-note/parse'
import {
  recordFeedbackOutcome,
  resetStepFeedbackSession,
  submitStepFeedback,
  takeStepFeedbackResult
} from '@/app/feedback-note/session'
import type { FeedbackNote, FeedbackNoteHistoryItem } from '@/app/feedback-note/types'
import type { FeedbackNoteRepresentationProvider } from '@/app/meta-agent/core/representation'
import { runMetaAgent } from '@/app/meta-agent/core/runtime'
import {
  DESIGN_FEEDBACK_NOTE_SYSTEM,
  renderDesignFeedbackNotePrompt
} from '@/app/meta-agent/domains/design/prompt'
import type { OpenPencilFeedbackNoteInput } from '@/app/meta-agent/hosts/open-pencil/input'

export const feedbackNoteState = reactive<{
  notes: FeedbackNote[]
  activeId: string | null
  pending: boolean
}>({
  notes: [],
  activeId: null,
  pending: false
})

let nextId = 1
const NOTE_HISTORY_LIMIT = 15
let feedbackNoteHistory: FeedbackNoteHistoryItem[] = []
let generation = 1
const openFeedbackNoteSteps = new Map<number, number>()

export function currentFeedbackNoteGeneration(): number {
  return generation
}

// A visible Note can precede later Notes from the same reasoning block.
export function beginFeedbackNoteStep(originStep: number, generationAtStart: number): void {
  if (isCurrentGeneration(generationAtStart)) {
    openFeedbackNoteSteps.set(originStep, generationAtStart)
  }
}

function isCurrentGeneration(value: number): boolean {
  return value === generation
}

function rememberNote(note: FeedbackNote): void {
  let subtype: FeedbackNoteHistoryItem['representationSubtype'] = null
  if (note.representation.type === 'code-visual') subtype = note.representation.visualType
  if (note.representation.type === 'image') subtype = note.representation.imageType
  feedbackNoteHistory.push({
    id: note.id,
    originStep: note.originStep,
    originChunk: note.originChunk,
    topic: note.topic,
    relationship: note.relationship,
    representationType: note.representation.type,
    representationSubtype: subtype,
    representationGoal: note.representationGoal,
    text: note.text,
    nodeId: note.nodeId,
    evidenceFromReasoning: note.evidenceFromReasoning,
    propositionIds: [...note.propositionIds],
    status: 'active',
    outcome: null
  })
  feedbackNoteHistory = feedbackNoteHistory.slice(-NOTE_HISTORY_LIMIT)
}

function setHistoryStatus(id: string, status: FeedbackNoteHistoryItem['status']): void {
  const item = feedbackNoteHistory.find((candidate) => candidate.id === id)
  if (item) item.status = status
}

function setHistoryOutcome(id: string, feedbackItems: readonly ConfirmedFeedback[]): void {
  const item = feedbackNoteHistory.find((candidate) => candidate.id === id)
  if (!item) return
  item.outcome = {
    resolution: feedbackItems.length > 0 ? 'explicit-feedback' : 'implicitly-accepted',
    selections: feedbackItems.map((feedback) => feedbackSelectionLabel(feedback.selection)),
    feedback: feedbackItems.map((feedback) => feedback.feedback)
  }
}

export function resetFeedbackNoteHistory(): void {
  feedbackNoteHistory = []
  openPencilFeedbackHistory.reset()
  resetStepFeedbackSession()
}

export function resetFeedbackNotes(): void {
  generation++
  openFeedbackNoteSteps.clear()
  for (const note of feedbackNoteState.notes) setHistoryStatus(note.id, 'continued')
  feedbackNoteState.notes = []
  feedbackNoteState.activeId = null
  feedbackNoteState.pending = false
  resumeTurn('feedback-note')
}

export async function settleFeedbackNoteStep(
  originStep: number,
  generationAtStart: number,
  generationTask: Promise<void>
): Promise<void> {
  if (!isCurrentGeneration(generationAtStart)) return
  pauseTurn('feedback-note')
  try {
    await generationTask
  } finally {
    if (isCurrentGeneration(generationAtStart)) {
      if (openFeedbackNoteSteps.get(originStep) === generationAtStart) {
        openFeedbackNoteSteps.delete(originStep)
      }
      await finalizeFeedbackNoteStep(originStep)
    }
  }
}

async function finalizeFeedbackNoteStep(originStep: number): Promise<void> {
  if (openFeedbackNoteSteps.has(originStep)) {
    logFeedbackStep(
      originStep,
      'waiting',
      'visible notes resolved, but later reasoning chunks are still being reviewed'
    )
    return
  }
  if (feedbackNoteState.notes.some((note) => note.originStep === originStep)) return

  const result = takeStepFeedbackResult(originStep)
  if (result.outcomes.length === 0) {
    resumeTurn('feedback-note')
    return
  }
  const handled = await submitStepFeedback(result)
  if (!handled) resumeTurn('feedback-note')
}

export async function createFeedbackNotes(
  input: OpenPencilFeedbackNoteInput,
  representationProvider: FeedbackNoteRepresentationProvider
): Promise<FeedbackNote[]> {
  if (input.reasoning.trim() === '' || !isCurrentGeneration(input.generation)) return []
  const finishActivity = beginMetaAgentActivity()
  feedbackNoteState.pending = true
  try {
    const decisions = await runMetaAgent({
      system: DESIGN_FEEDBACK_NOTE_SYSTEM,
      prompt: renderDesignFeedbackNotePrompt({ ...input, previousNotes: feedbackNoteHistory })
    })
    if (!isCurrentGeneration(input.generation)) return []
    const knownTopics = new Set(feedbackNoteHistory.map((note) => note.topic.toLowerCase()))
    const notes = decisions.flatMap((decision) => {
      const note = readFeedbackNote({
        id: `n${nextId++}`,
        value: decision.payload,
        relation: decision.relationship,
        reasoning: input.reasoning,
        propositions: input.propositions,
        originStep: input.originStep,
        originChunk: input.originChunk
      })
      if (!note || knownTopics.has(note.topic.toLowerCase())) {
        return []
      }
      knownTopics.add(note.topic.toLowerCase())
      return [note]
    })
    const storedNotes = notes.flatMap((note) => {
      const index = feedbackNoteState.notes.push(note) - 1
      const storedNote = feedbackNoteState.notes[index]
      rememberNote(storedNote)
      void fillRepresentation(storedNote, representationProvider)
      return [storedNote]
    })
    if (storedNotes.length > 0) {
      feedbackNoteState.activeId ??= storedNotes[0]?.id ?? null
    }
    return storedNotes
  } catch (error) {
    console.warn('[feedback-note] generation failed:', error)
    return []
  } finally {
    if (isCurrentGeneration(input.generation)) feedbackNoteState.pending = false
    finishActivity()
  }
}

async function fillRepresentation(
  note: FeedbackNote,
  provider: FeedbackNoteRepresentationProvider
): Promise<void> {
  try {
    const result = await provider.materialize(note)
    if (result.type === 'text') {
      if (note.representation.type !== 'text') throw new Error('Representation provider mismatch')
      return
    }
    if (result.type === 'code-visual') {
      if (note.representation.type !== 'code-visual') {
        throw new Error('Representation provider mismatch')
      }
      note.representation.artifact = result.artifact
      note.representation.status = 'ready'
      logFeedbackNoteCode(note.id, result.artifact.format)
      return
    }
    if (note.representation.type !== 'image') throw new Error('Representation provider mismatch')
    note.representation.url = result.url
    note.representation.status = 'ready'
    logFeedbackNoteImage(note.id, 'ready')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    if (note.representation.type === 'code-visual') {
      console.warn('[feedback-note] code visual generation failed:', error)
      note.representation.status = 'failed'
      logFeedbackNoteCode(note.id, 'failed', message)
    } else if (note.representation.type === 'image') {
      console.warn('[feedback-note] image generation failed:', error)
      note.representation.status = 'failed'
      logFeedbackNoteImage(note.id, 'failed', message)
    } else {
      console.warn('[feedback-note] text representation failed:', error)
    }
  }
}

export function openFeedbackNote(id: string): void {
  feedbackNoteState.activeId = id
}

export async function resolveFeedbackNote(id: string): Promise<void> {
  const note = feedbackNoteState.notes.find((candidate) => candidate.id === id)
  if (!note) return
  const feedbackItems = openPencilFeedbackHistory.forNote(id)
  recordFeedbackOutcome(note, feedbackItems)
  setHistoryStatus(id, feedbackItems.length > 0 ? 'answered' : 'continued')
  setHistoryOutcome(id, feedbackItems)
  const wasActive = feedbackNoteState.activeId === id
  feedbackNoteState.notes = feedbackNoteState.notes.filter((note) => note.id !== id)
  if (wasActive) feedbackNoteState.activeId = feedbackNoteState.notes[0]?.id ?? null
  await finalizeFeedbackNoteStep(note.originStep)
}
