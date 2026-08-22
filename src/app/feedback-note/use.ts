import { generateText } from 'ai'
import { reactive } from 'vue'

import { logFeedbackNoteImage } from '@/app/ai/chat/agent-log'
import { pauseTurn, resumeTurn } from '@/app/ai/chat/agent-turn'
import { createUntracedLanguageModel } from '@/app/ai/chat/model'
import { backgroundProviderOptions, modelConfigForSlot } from '@/app/ai/model-routing'
import { generateFeedbackNoteImage } from '@/app/feedback-note/image'
import { FEEDBACK_NOTE_SYSTEM, renderFeedbackNotePrompt } from '@/app/feedback-note/prompt'
import { FEEDBACK_NOTE_TOOLS } from '@/app/feedback-note/tools'
import type {
  FeedbackNote,
  FeedbackNoteHistoryItem,
  FeedbackNoteRelationship,
  FeedbackNoteVisualType
} from '@/app/feedback-note/types'
import type { Proposition } from '@/app/meta-agent/judge'

interface RawFeedbackNote {
  topic?: unknown
  mode?: unknown
  visual_type?: unknown
  representation_goal?: unknown
  text?: unknown
  image_prompt?: unknown
  annotation_affordance?: unknown
  node_id?: unknown
  evidence_from_reasoning?: unknown
  proposition_ids?: unknown
}

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

function relationship(toolName: string): FeedbackNoteRelationship | null {
  if (toolName === 'create_alignment_feedback_note') return 'alignment'
  if (toolName === 'create_conflict_feedback_note') return 'conflict'
  if (toolName === 'create_uncovered_feedback_note') return 'uncovered'
  return null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readVisualType(value: unknown): FeedbackNoteVisualType | null {
  if (value === 'diagram' || value === 'artifact' || value === 'illustration') return value
  return null
}

function readEvidence(value: unknown, reasoning: string): string {
  const evidence = readString(value)
  return evidence && reasoning.includes(evidence) ? evidence : reasoning.trim().slice(0, 200)
}

function readPropositionIds(value: unknown, propositions: Proposition[]): string[] {
  if (!Array.isArray(value)) return []
  const known = new Set(propositions.map((item) => item.id))
  return value.filter((id): id is string => typeof id === 'string' && known.has(id))
}

function readAffordance(value: unknown, mode: FeedbackNote['mode']): string {
  const affordance = readString(value).split(/\s+/).slice(0, 8).join(' ')
  if (mode === 'text' && /^(circle|connect|choose|select|rate|rank)\b/i.test(affordance)) {
    return 'Mark or say what you would change'
  }
  return affordance
}

function readNote(
  input: unknown,
  relation: FeedbackNoteRelationship,
  reasoning: string,
  propositions: Proposition[],
  originStep: number,
  originChunk: number
): FeedbackNote | null {
  if (typeof input !== 'object' || input === null) return null
  const row = input as RawFeedbackNote
  const topic = readString(row.topic)
  if (topic === '') return null
  const mode = row.mode === 'visual' ? 'visual' : 'text'
  const visualType = readVisualType(row.visual_type)
  const imagePrompt = mode === 'visual' ? readString(row.image_prompt) : null
  if (mode === 'visual' && (!visualType || !imagePrompt)) return null
  const representationGoal = readString(row.representation_goal)
  if (representationGoal === '') return null
  const rawText = readString(row.text)
  const text = rawText.split(/\s+/).slice(0, 8).join(' ')
  const annotationAffordance = readAffordance(row.annotation_affordance, mode)
  if (annotationAffordance === '') return null
  const propositionIds = readPropositionIds(row.proposition_ids, propositions)
  if (relation === 'uncovered' ? propositionIds.length > 0 : propositionIds.length === 0)
    return null
  return {
    id: `n${nextId++}`,
    originStep,
    originChunk,
    topic,
    relationship: relation,
    mode,
    visualType: mode === 'visual' ? visualType : null,
    representationGoal,
    text: text || 'What should guide this decision?',
    imagePrompt,
    imageUrl: null,
    imageStatus: mode === 'visual' ? 'loading' : 'none',
    annotationAffordance,
    nodeId: typeof row.node_id === 'string' && row.node_id !== '' ? row.node_id : null,
    evidenceFromReasoning: readEvidence(row.evidence_from_reasoning, reasoning),
    propositionIds
  }
}

function rememberNote(note: FeedbackNote): void {
  feedbackNoteHistory.push({
    id: note.id,
    originStep: note.originStep,
    originChunk: note.originChunk,
    topic: note.topic,
    relationship: note.relationship,
    mode: note.mode,
    visualType: note.visualType,
    representationGoal: note.representationGoal,
    text: note.text,
    annotationAffordance: note.annotationAffordance,
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
  feedbackNoteState.pending = true
  try {
    const result = await generateText({
      model: createUntracedLanguageModel(modelConfigForSlot('meta-agent')),
      system: FEEDBACK_NOTE_SYSTEM,
      prompt: renderFeedbackNotePrompt({ ...input, previousNotes: feedbackNoteHistory }),
      maxOutputTokens: 1024,
      providerOptions: backgroundProviderOptions('meta-agent'),
      tools: FEEDBACK_NOTE_TOOLS,
      toolChoice: 'auto'
    })
    const knownTopics = new Set(feedbackNoteHistory.map((note) => note.topic.toLowerCase()))
    const queriedPropositions = new Set(feedbackNoteHistory.flatMap((note) => note.propositionIds))
    const notes = result.staticToolCalls.slice(0, 1).flatMap((call) => {
      const relation = relationship(call.toolName)
      if (!relation) return []
      const note = readNote(
        call.input,
        relation,
        input.reasoning,
        input.propositions,
        input.originStep,
        input.originChunk
      )
      if (
        !note ||
        knownTopics.has(note.topic.toLowerCase()) ||
        note.propositionIds.some((id) => queriedPropositions.has(id))
      ) {
        return []
      }
      knownTopics.add(note.topic.toLowerCase())
      for (const id of note.propositionIds) queriedPropositions.add(id)
      return [note]
    })
    const storedNotes = notes.flatMap((note) => {
      const index = feedbackNoteState.notes.push(note) - 1
      const storedNote = feedbackNoteState.notes[index]
      rememberNote(storedNote)
      if (storedNote.mode === 'visual' && storedNote.imagePrompt) void fillImage(storedNote)
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
  }
}

async function fillImage(note: FeedbackNote): Promise<void> {
  if (!note.imagePrompt || !note.visualType) return
  try {
    note.imageUrl = await generateFeedbackNoteImage(
      note.imagePrompt,
      note.annotationAffordance,
      note.visualType,
      note.representationGoal
    )
    note.imageStatus = 'ready'
    logFeedbackNoteImage(note.id, 'ready')
  } catch (error) {
    console.warn('[feedback-note] image generation failed:', error)
    note.imageStatus = 'failed'
    logFeedbackNoteImage(note.id, 'failed')
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
