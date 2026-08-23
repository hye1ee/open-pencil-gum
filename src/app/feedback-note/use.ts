import { generateText } from 'ai'
import { reactive } from 'vue'

import { beginMetaAgentActivity } from '@/app/ai/chat/agent-activity'
import { logFeedbackNoteCode, logFeedbackNoteImage } from '@/app/ai/chat/agent-log'
import { pauseTurn, resumeTurn } from '@/app/ai/chat/agent-turn'
import { createUntracedLanguageModel } from '@/app/ai/chat/model'
import { backgroundProviderOptions, modelConfigForSlot } from '@/app/ai/model-routing'
import { composeCodeVisual } from '@/app/feedback-note/code-visual/use'
import { resetConfirmedFeedbackHistory } from '@/app/feedback-note/draft/history'
import { generateFeedbackNoteImage } from '@/app/feedback-note/image'
import { feedbackNoteRelationship, readFeedbackNote } from '@/app/feedback-note/parse'
import { FEEDBACK_NOTE_SYSTEM, renderFeedbackNotePrompt } from '@/app/feedback-note/prompt'
import { FEEDBACK_NOTE_TOOLS } from '@/app/feedback-note/tools'
import type { FeedbackNote, FeedbackNoteHistoryItem } from '@/app/feedback-note/types'
import type { Proposition } from '@/app/meta-agent/judge'

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
    status: 'active'
  })
  feedbackNoteHistory = feedbackNoteHistory.slice(-NOTE_HISTORY_LIMIT)
}

function setHistoryStatus(id: string, status: FeedbackNoteHistoryItem['status']): void {
  const item = feedbackNoteHistory.find((candidate) => candidate.id === id)
  if (item) item.status = status
}

export function resetFeedbackNoteHistory(): void {
  feedbackNoteHistory = []
  resetConfirmedFeedbackHistory()
}

export function resetFeedbackNotes(): void {
  for (const note of feedbackNoteState.notes) setHistoryStatus(note.id, 'continued')
  feedbackNoteState.notes = []
  feedbackNoteState.activeId = null
  feedbackNoteState.pending = false
  resumeTurn('feedback-note')
}

export async function settleFeedbackNoteStep(
  originStep: number,
  generation: Promise<void>
): Promise<void> {
  pauseTurn('feedback-note')
  try {
    await generation
  } finally {
    const hasStepNote = feedbackNoteState.notes.some((note) => note.originStep === originStep)
    if (!hasStepNote && feedbackNoteState.notes.length === 0) resumeTurn('feedback-note')
  }
}

export async function createFeedbackNotes(input: {
  request: string
  plan: string | null
  reasoning: string
  originStep: number
  originChunk: number
  propositions: Proposition[]
  canvas: string
  actions: string[]
}): Promise<FeedbackNote[]> {
  if (input.reasoning.trim() === '') return []
  const finishActivity = beginMetaAgentActivity()
  feedbackNoteState.pending = true
  try {
    const result = await generateText({
      model: createUntracedLanguageModel(modelConfigForSlot('meta-agent')),
      system: FEEDBACK_NOTE_SYSTEM,
      prompt: renderFeedbackNotePrompt({ ...input, previousNotes: feedbackNoteHistory }),
      maxOutputTokens: 2048,
      providerOptions: backgroundProviderOptions('meta-agent'),
      tools: FEEDBACK_NOTE_TOOLS,
      toolChoice: 'auto'
    })
    const knownTopics = new Set(feedbackNoteHistory.map((note) => note.topic.toLowerCase()))
    const notes = result.staticToolCalls.slice(0, 1).flatMap((call) => {
      const relation = feedbackNoteRelationship(call.toolName)
      if (!relation) return []
      const note = readFeedbackNote({
        id: `n${nextId++}`,
        value: call.input,
        relation,
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
      if (storedNote.representation.type === 'code-visual') void fillCodeVisual(storedNote)
      if (storedNote.representation.type === 'image') void fillImage(storedNote)
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
    feedbackNoteState.pending = false
    finishActivity()
  }
}

async function fillCodeVisual(note: FeedbackNote): Promise<void> {
  if (note.representation.type !== 'code-visual') return
  const representation = note.representation
  try {
    representation.artifact = await composeCodeVisual(note)
    representation.status = 'ready'
    logFeedbackNoteCode(note.id, representation.artifact.format)
  } catch (error) {
    console.warn('[feedback-note] code visual generation failed:', error)
    representation.status = 'failed'
    logFeedbackNoteCode(note.id, 'failed', error instanceof Error ? error.message : 'unknown error')
  }
}

async function fillImage(note: FeedbackNote): Promise<void> {
  if (note.representation.type !== 'image') return
  const representation = note.representation
  try {
    representation.url = await generateFeedbackNoteImage(
      representation.prompt,
      representation.imageType,
      note.representationGoal
    )
    representation.status = 'ready'
    logFeedbackNoteImage(note.id, 'ready')
  } catch (error) {
    console.warn('[feedback-note] image generation failed:', error)
    representation.status = 'failed'
    logFeedbackNoteImage(
      note.id,
      'failed',
      error instanceof Error ? error.message : 'unknown error'
    )
  }
}

export function openFeedbackNote(id: string): void {
  feedbackNoteState.activeId = id
}

export function dismissFeedbackNote(id: string): void {
  setHistoryStatus(id, 'continued')
  const wasActive = feedbackNoteState.activeId === id
  feedbackNoteState.notes = feedbackNoteState.notes.filter((note) => note.id !== id)
  if (wasActive) feedbackNoteState.activeId = feedbackNoteState.notes[0]?.id ?? null
  if (feedbackNoteState.notes.length === 0) resumeTurn('feedback-note')
}
