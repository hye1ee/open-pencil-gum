import type {
  CodeVisualAlternative,
  CodeVisualBrief,
  FeedbackNote,
  FeedbackNoteCodeVisualType,
  FeedbackCueSegment,
  FeedbackNoteImageType,
  FeedbackNoteRelationship,
  FeedbackNoteRepresentation
} from '@/app/feedback-note/types'
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

export function feedbackNoteRelationship(toolName: string): FeedbackNoteRelationship | null {
  if (toolName === 'create_alignment_feedback_note') return 'alignment'
  if (toolName === 'create_conflict_feedback_note') return 'conflict'
  if (toolName === 'create_uncovered_feedback_note') return 'uncovered'
  return null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

function readRepresentation(row: RawFeedbackNote): FeedbackNoteRepresentation | null {
  const codeVisualType = readCodeVisualType(row.code_visual_type)
  const imageType = readImageType(row.image_type)
  const imagePrompt = readString(row.image_prompt)
  if (row.representation_type === 'text') {
    if (codeVisualType || row.code_visual_brief !== null || imageType || imagePrompt) return null
    return { type: 'text' }
  }
  if (row.representation_type === 'code-visual') {
    if (!codeVisualType || imageType || imagePrompt) return null
    const brief = readCodeVisualBrief(row.code_visual_brief, codeVisualType)
    return brief
      ? {
          type: 'code-visual',
          visualType: codeVisualType,
          brief,
          artifact: null,
          status: 'loading'
        }
      : null
  }
  if (row.representation_type === 'image') {
    if (codeVisualType || row.code_visual_brief !== null || !imageType || !imagePrompt) return null
    return { type: 'image', imageType, prompt: imagePrompt, url: null, status: 'loading' }
  }
  return null
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
}): FeedbackCueSegment[] | null {
  if (!Array.isArray(input.value) || input.value.length === 0 || input.value.length > 8) return null
  const propositions = new Map(input.propositions.map((item) => [item.id, item]))
  const cited = new Set(input.propositionIds)
  const segments = input.value.flatMap((value): FeedbackCueSegment[] => {
    if (typeof value !== 'object' || value === null) return []
    const row = value as RawFeedbackCueSegment
    const text = readString(row.text).slice(0, 160)
    if (!text) return []
    if (row.source === 'neutral') {
      return row.evidence_quote === null && row.proposition_id === null
        ? [{ text, source: 'neutral' }]
        : []
    }
    if (row.source === 'reasoning') {
      const evidenceQuote = readString(row.evidence_quote)
      return evidenceQuote && input.reasoning.includes(evidenceQuote) && row.proposition_id === null
        ? [{ text, source: 'reasoning', evidenceQuote }]
        : []
    }
    if (row.source === 'proposition') {
      const propositionId = readString(row.proposition_id)
      const proposition = propositions.get(propositionId)
      return proposition && cited.has(propositionId) && row.evidence_quote === null
        ? [
            {
              text,
              source: 'proposition',
              propositionId,
              propositionText: proposition.text,
              propositionConfidence: proposition.confidence,
              propositionRationale: proposition.rationale || null
            }
          ]
        : []
    }
    return []
  })
  if (segments.length !== input.value.length) return null
  if (!segments.some((segment) => segment.source === 'reasoning')) return null
  const hasPropositionSegment = segments.some((segment) => segment.source === 'proposition')
  if (input.relation === 'uncovered' ? hasPropositionSegment : !hasPropositionSegment) return null
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
}): FeedbackNote | null {
  if (typeof input.value !== 'object' || input.value === null) return null
  const row = input.value as RawFeedbackNote
  const topic = readString(row.topic)
  const representation = readRepresentation(row)
  const representationGoal = readString(row.representation_goal)
  if (!topic || !representation || !representationGoal) return null
  const propositionIds = readPropositionIds(row.proposition_ids, input.propositions)
  if (input.relation === 'uncovered' ? propositionIds.length > 0 : propositionIds.length === 0) {
    return null
  }
  const cueSegments = readCueSegments({
    value: row.cue_segments,
    relation: input.relation,
    reasoning: input.reasoning,
    propositions: input.propositions,
    propositionIds
  })
  if (!cueSegments) return null
  const evidence = readString(row.evidence_from_reasoning)
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
    evidenceFromReasoning:
      evidence && input.reasoning.includes(evidence)
        ? evidence
        : input.reasoning.trim().slice(0, 200),
    propositionIds
  }
}
