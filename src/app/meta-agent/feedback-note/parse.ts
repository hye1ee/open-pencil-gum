import type {
  CodeVisualAlternative,
  CodeVisualBrief,
  FeedbackNote,
  FeedbackNoteCodeVisualType,
  FeedbackCueSegment,
  FeedbackNoteImageType,
  FeedbackNoteRelationship,
  FeedbackNoteRepresentation
} from '@/app/meta-agent/feedback-note/types'
import type { Proposition } from '@/app/meta-agent/core/types'

interface RawFeedbackNote {
  topic?: unknown
  representation_type?: unknown
  code_visual_type?: unknown
  code_visual_brief?: unknown
  image_type?: unknown
  representation_goal?: unknown
  cue_segments?: unknown
  image_prompt?: unknown
  node_id?: unknown
  evidence_from_reasoning?: unknown
  proposition_ids?: unknown
}

interface RawCodeVisualBrief {
  subject?: unknown
  decision?: unknown
  alternatives?: unknown
  must_show?: unknown
  format_hint?: unknown
}

interface RawCodeVisualAlternative {
  label?: unknown
  description?: unknown
}

interface RawFeedbackCueSegment {
  text?: unknown
  source?: unknown
  evidence_quote?: unknown
  proposition_id?: unknown
}

type RejectFeedbackNote = (reason: string) => null

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

const MARKDOWN_DECORATION_CHARACTERS = new Set(['*', '_', '`', '~'])

function recoverExactReasoningEvidence(reasoning: string, evidence: string): string {
  if (!evidence) return ''
  if (reasoning.includes(evidence)) return evidence

  const normalizedEvidence = [...evidence]
    .filter((character) => !MARKDOWN_DECORATION_CHARACTERS.has(character))
    .join('')
  if (!normalizedEvidence) return ''

  const normalizedReasoningCharacters: string[] = []
  const reasoningOffsets: number[] = []
  let offset = 0
  for (const character of reasoning) {
    if (!MARKDOWN_DECORATION_CHARACTERS.has(character)) {
      normalizedReasoningCharacters.push(character)
      reasoningOffsets.push(offset)
    }
    offset += character.length
  }

  const normalizedReasoning = normalizedReasoningCharacters.join('')
  const normalizedStart = normalizedReasoning.indexOf(normalizedEvidence)
  if (normalizedStart < 0) return ''
  const normalizedEnd = normalizedStart + normalizedEvidence.length - 1
  const originalStart = reasoningOffsets[normalizedStart]
  const originalEnd = reasoningOffsets[normalizedEnd]
  if (originalStart === undefined || originalEnd === undefined) return ''
  return reasoning.slice(originalStart, originalEnd + 1)
}

function readCodeVisualType(value: unknown): FeedbackNoteCodeVisualType | null {
  if (
    value === 'artifact' ||
    value === 'spectrum' ||
    value === 'flow' ||
    value === 'comparison' ||
    value === 'palette' ||
    value === 'wireframe'
  ) {
    return value
  }
  return null
}

function readImageType(value: unknown): FeedbackNoteImageType | null {
  if (
    value === 'illustration' ||
    value === 'scene' ||
    value === 'metaphor' ||
    value === 'texture' ||
    value === 'photographic-reference' ||
    value === 'expressive-style'
  ) {
    return value
  }
  return null
}

function readCodeVisualBrief(
  value: unknown,
  visualType: FeedbackNoteCodeVisualType
): CodeVisualBrief | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as RawCodeVisualBrief
  const subject = readString(row.subject).slice(0, 120)
  const decision = readString(row.decision).slice(0, 240)
  if (!subject || !decision || !Array.isArray(row.alternatives) || !Array.isArray(row.must_show)) {
    return null
  }
  const alternatives = row.alternatives.slice(0, 4).flatMap((value): CodeVisualAlternative[] => {
    if (typeof value !== 'object' || value === null) return []
    const alternative = value as RawCodeVisualAlternative
    const label = readString(alternative.label).slice(0, 40)
    const description = readString(alternative.description).slice(0, 160)
    return label && description ? [{ label, description }] : []
  })
  const mustShow = row.must_show
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 6)
  const needsMultipleAlternatives =
    visualType === 'comparison' || visualType === 'palette' || visualType === 'spectrum'
  if ((needsMultipleAlternatives && alternatives.length < 2) || mustShow.length === 0) return null
  const formatHint =
    row.format_hint === 'html' || row.format_hint === 'svg' ? row.format_hint : null
  return { subject, decision, alternatives, mustShow, formatHint }
}

function readRepresentation(
  row: RawFeedbackNote,
  reject: RejectFeedbackNote
): FeedbackNoteRepresentation | null {
  const codeVisualType = readCodeVisualType(row.code_visual_type)
  const imageType = readImageType(row.image_type)
  const imagePrompt = readString(row.image_prompt)
  if (row.representation_type === 'text') {
    if (codeVisualType || row.code_visual_brief !== null || imageType || imagePrompt) {
      return reject('text representation contains a non-null visual payload')
    }
    return { type: 'text' }
  }
  if (row.representation_type === 'code-visual') {
    if (!codeVisualType) return reject('code-visual representation has an invalid visual type')
    if (imageType || imagePrompt) {
      return reject('code-visual representation contains a non-null image payload')
    }
    const brief = readCodeVisualBrief(row.code_visual_brief, codeVisualType)
    return brief
      ? {
          type: 'code-visual',
          visualType: codeVisualType,
          brief,
          artifact: null,
          status: 'loading'
        }
      : reject('code-visual representation has an incomplete or inconsistent brief')
  }
  if (row.representation_type === 'image') {
    if (codeVisualType || row.code_visual_brief !== null) {
      return reject('image representation contains a non-null code-visual payload')
    }
    if (!imageType || !imagePrompt) {
      return reject('image representation is missing image_type or image_prompt')
    }
    return { type: 'image', imageType, prompt: imagePrompt, url: null, status: 'loading' }
  }
  return reject('representation_type is missing or invalid')
}

function readPropositionIds(value: unknown, propositions: Proposition[]): string[] {
  if (!Array.isArray(value)) return []
  const known = new Set(propositions.map((item) => item.id))
  return value.filter((id): id is string => typeof id === 'string' && known.has(id))
}

function readCueSegments(input: {
  value: unknown
  relation: FeedbackNoteRelationship
  reasoning: string
  propositions: Proposition[]
  propositionIds: string[]
  fallbackReasoningEvidence: string
  reject: RejectFeedbackNote
}): FeedbackCueSegment[] | null {
  if (!Array.isArray(input.value) || input.value.length === 0 || input.value.length > 8) {
    return input.reject('cue_segments must contain between one and eight segments')
  }
  const propositions = new Map(input.propositions.map((item) => [item.id, item]))
  const cited = new Set(input.propositionIds)
  const segments: FeedbackCueSegment[] = []
  for (const [index, value] of input.value.entries()) {
    if (typeof value !== 'object' || value === null) {
      return input.reject(`cue_segments[${index}] is not an object`)
    }
    const row = value as RawFeedbackCueSegment
    const text = readString(row.text).slice(0, 160)
    if (!text) return input.reject(`cue_segments[${index}] has no text`)
    if (row.source === 'neutral') {
      if (row.evidence_quote !== null || row.proposition_id !== null) {
        return input.reject(`cue_segments[${index}] neutral provenance is not null`)
      }
      segments.push({ text, source: 'neutral' })
      continue
    }
    if (row.source === 'reasoning') {
      const evidenceQuote = readString(row.evidence_quote)
      const exactEvidence =
        recoverExactReasoningEvidence(input.reasoning, evidenceQuote) ||
        input.fallbackReasoningEvidence
      if (!exactEvidence) {
        return input.reject(
          `cue_segments[${index}] reasoning evidence is not an exact reasoning substring`
        )
      }
      if (row.proposition_id !== null) {
        return input.reject(`cue_segments[${index}] reasoning proposition_id is not null`)
      }
      segments.push({ text, source: 'reasoning', evidenceQuote: exactEvidence })
      continue
    }
    if (row.source === 'proposition') {
      const propositionId = readString(row.proposition_id)
      const proposition = propositions.get(propositionId)
      if (!proposition || !cited.has(propositionId)) {
        return input.reject(
          `cue_segments[${index}] proposition_id is unknown or absent from proposition_ids`
        )
      }
      if (row.evidence_quote !== null) {
        return input.reject(`cue_segments[${index}] proposition evidence_quote is not null`)
      }
      segments.push({
        text,
        source: 'proposition',
        propositionId,
        propositionText: proposition.text,
        propositionConfidence: proposition.confidence,
        propositionRationale: proposition.rationale || null
      })
      continue
    }
    return input.reject(`cue_segments[${index}] has an invalid source`)
  }
  if (!segments.some((segment) => segment.source === 'reasoning')) {
    return input.reject('cue_segments contains no reasoning segment')
  }
  const hasPropositionSegment = segments.some((segment) => segment.source === 'proposition')
  if (input.relation === 'uncovered' ? hasPropositionSegment : !hasPropositionSegment) {
    return input.reject(
      input.relation === 'uncovered'
        ? 'uncovered note contains a proposition segment'
        : `${input.relation} note contains no proposition segment`
    )
  }
  return segments
}

export function readFeedbackNote(input: {
  id: string
  value: unknown
  relation: FeedbackNoteRelationship
  reasoning: string
  propositions: Proposition[]
  originStep: number
  originChunk: number
  onInvalid?: (reason: string) => void
}): FeedbackNote | null {
  const reject: RejectFeedbackNote = (reason) => {
    input.onInvalid?.(reason)
    return null
  }
  if (typeof input.value !== 'object' || input.value === null) {
    return reject('tool payload is not an object')
  }
  const row = input.value as RawFeedbackNote
  const topic = readString(row.topic)
  const representation = readRepresentation(row, reject)
  const representationGoal = readString(row.representation_goal)
  if (!topic) return reject('topic is missing')
  if (!representation) return null
  if (!representationGoal) return reject('representation_goal is missing')
  const propositionIds = readPropositionIds(row.proposition_ids, input.propositions)
  if (input.relation === 'uncovered' ? propositionIds.length > 0 : propositionIds.length === 0) {
    return reject(
      input.relation === 'uncovered'
        ? 'uncovered note cites a known proposition'
        : `${input.relation} note cites no known proposition`
    )
  }
  const requestedEvidence = readString(row.evidence_from_reasoning)
  const exactRequestedEvidence = recoverExactReasoningEvidence(input.reasoning, requestedEvidence)
  const cueSegments = readCueSegments({
    value: row.cue_segments,
    relation: input.relation,
    reasoning: input.reasoning,
    propositions: input.propositions,
    propositionIds,
    fallbackReasoningEvidence: exactRequestedEvidence,
    reject
  })
  if (!cueSegments) return null
  return {
    id: input.id,
    originStep: input.originStep,
    originChunk: input.originChunk,
    topic,
    relationship: input.relation,
    representation,
    representationGoal,
    text: cueSegments.map((segment) => segment.text).join(' '),
    cueSegments,
    nodeId: typeof row.node_id === 'string' && row.node_id !== '' ? row.node_id : null,
    evidenceFromReasoning: exactRequestedEvidence || input.reasoning.trim().slice(0, 200),
    propositionIds
  }
}
