/**
 * A general user model from screen captures, after Shaikh et al.
 * (arXiv:2505.10831). Per batch: PROPOSE, EMBED, RETRIEVE by cosine weighted by
 * staleness, then REVISE each candidate against its whole neighbourhood at once
 * rather than pairwise. Self-contained: no app imports and no provider SDK.
 */

import {
  FEEDBACK_SYSTEM_ASKUSER,
  RATIONALE_SYSTEM_ASKUSER,
  feedbackAskUserPrompt,
  rationaleAskUserPrompt
} from '@/app/user-model/ask-user/prompt'
import type { AskUserRetrievalTrace, UserModelAskUserBatch } from '@/app/user-model/ask-user/types'
import {
  FEEDBACK_SYSTEM,
  PROPOSE_SYSTEM,
  RATIONALE_SYSTEM,
  REVISE_SYSTEM,
  feedbackUserPrompt,
  rationaleUserPrompt,
  reviseUserPrompt
} from '@/app/user-model/prompt'
import type { ChangedProposition, ReviseNeighbour } from '@/app/user-model/prompt'

export interface Proposition {
  id: string
  /** Rewritten by every revision that touches it — this is not an append log. */
  text: string
  /** 0–1, from a 1–10 elicitation. 0 means retired; we keep it either way. */
  confidence: number
  /** 0–1 staleness rate. Higher decays faster. */
  decay: number
  reasoning: string
  /** Apart from `text` because the two answer to different evidence: the text is
   * fixed once written, the rationale is a reading of it and should improve. */
  rationale: string | null
  /** What the rationale was read off — which notes, and which other
   * propositions alongside them. Written together or not at all. */
  rationaleGrounds: string | null
  /** Ids of the propositions read alongside; may be empty. */
  rationaleFrom: string[]
  createdAt: string
  updatedAt: string
  /** How many batches have fed into it. */
  observations: number
  embedding: number[]
  /** The wording it was first created with, never overwritten. */
  originalText: string
  /** Its vector, so drift from the original costs no call to measure. */
  originalEmbedding: number[]
  /** How many times the text has actually been rewritten. */
  revisions: number
}

/** Drift tracking arrived after the first files were written, so those fields
 * may be absent rather than `load` pretending otherwise. */
export type SavedProposition = Omit<
  Proposition,
  | 'originalText'
  | 'originalEmbedding'
  | 'revisions'
  | 'rationale'
  | 'rationaleGrounds'
  | 'rationaleFrom'
> &
  Partial<
    Pick<
      Proposition,
      | 'originalText'
      | 'originalEmbedding'
      | 'revisions'
      | 'rationale'
      | 'rationaleGrounds'
      | 'rationaleFrom'
    >
  >

/** What the VLM returns before it has been placed in the model. */
interface CandidateProposition {
  text: string
  confidence: number
  reasoning: string
}

/** Passed out so the caller can route the two differently: a timer-driven read
 * and a person's own words are not worth the same money. */
export type RevisionPurpose = 'revise-from-frames' | 'revise-from-feedback' | 'revise-from-ask-user'

export interface UserModelDeps {
  /** Vision call over the frames. Returns the model's raw text. */
  propose(input: { system: string; images: Blob[]; instruction: string }): Promise<string>
  /** Text call. Returns the model's raw text. */
  revise(input: { system: string; prompt: string; purpose: RevisionPurpose }): Promise<string>
  /** One request for all the texts, in order. */
  embed(texts: string[]): Promise<number[][]>
}

export type UserModelFeedbackRelationship = 'alignment' | 'conflict' | 'uncovered'
export type UserModelFeedbackResolution = 'explicit-feedback' | 'implicitly-accepted'

export interface UserModelFeedbackPoint {
  x: number
  y: number
}

export interface UserModelFeedbackTarget {
  id: string
  label: string
}

interface TargetedUserModelFeedbackSelection {
  target?: UserModelFeedbackTarget
}

export type UserModelFeedbackSelection =
  | { type: 'none' }
  | ({
      type: 'region'
      x: number
      y: number
      width: number
      height: number
    } & TargetedUserModelFeedbackSelection)
  | ({ type: 'point'; x: number; y: number } & TargetedUserModelFeedbackSelection)
  | ({
      type: 'arrow'
      start: UserModelFeedbackPoint
      end: UserModelFeedbackPoint
    } & TargetedUserModelFeedbackSelection)
  | ({ type: 'sequence'; points: UserModelFeedbackPoint[] } & TargetedUserModelFeedbackSelection)
  | ({ type: 'freehand'; points: UserModelFeedbackPoint[] } & TargetedUserModelFeedbackSelection)
  | {
      type: 'text'
      text: string
      source: 'cue' | 'reasoning' | 'proposition' | 'proposition-rationale'
      start: number
      end: number
    }

export interface UserModelFeedbackItem {
  id: string
  selection: UserModelFeedbackSelection
  feedback: string
  createdAt: number
}

export interface UserModelFeedbackNote {
  noteId: string
  chunk: number
  topic: string
  cue: string
  representationGoal: string
  relationship: UserModelFeedbackRelationship
  reasoningEvidence: string
  propositionIds: string[]
  resolution: UserModelFeedbackResolution
  feedbackItems: UserModelFeedbackItem[]
}

/** One reviewed step. Notes and the multiple feedback items attached to each
 * note stay nested so the revision model does not mistake one gesture for
 * agreement with every other part of the note. */
export interface UserModelFeedbackBatch {
  step: number | null
  notes: UserModelFeedbackNote[]
}

export interface FeedbackRetrievalCandidate {
  id: string
  score: number
}

export interface FeedbackRetrievalNote {
  noteId: string
  directIds: string[]
  embedding: FeedbackRetrievalCandidate[]
}

export interface FeedbackRetrievalTrace {
  notes: FeedbackRetrievalNote[]
  shownIds: string[]
}

export interface UserModelOptions {
  deps: UserModelDeps
  /** Frames per batch. Six at a five-second cadence is half a minute of work. */
  batchSize?: number
  /** Called after every batch that changed something. */
  onChange: (propositions: Proposition[]) => void
  /** Per revision, not per batch: the state is a file overwritten in place, so
   * without this all anyone sees later is where it ended up. */
  onRevision?: (change: {
    id: string
    before: { text: string; confidence: number } | null
    after: { text: string; confidence: number }
  }) => void
  /** The grounds go out here because a rationale drawn from a proposition no
   * note touched is where invention shows up first. */
  onRationale?: (change: {
    text: string
    before: string | null
    after: string
    grounds: string
    readWith: string[]
  }) => void
  /** Otherwise a batch where three of five were refused looks like one that
   * wrote two, and a bad prompt cannot be told from a strict guard. */
  onRationaleDropped?: (reason: string) => void
  /** What was read out of an observation, before any of it was applied. */
  onCandidates?: (candidates: CandidateProposition[]) => void
  /** Direct citations and embedding neighbours shown to FEEDBACK_SYSTEM. */
  onFeedbackRetrieval?: (trace: FeedbackRetrievalTrace) => void
  /** Embedding neighbours shown to FEEDBACK_SYSTEM_ASKUSER. */
  onAskUserRetrieval?: (trace: AskUserRetrievalTrace) => void
  onStage?: (stage: PipelineStage) => void
  /** A batch dropped because the screen had not moved, with how far it did. */
  onIdle?: (pixelChange: number) => void
  onError?: (error: unknown) => void
}

export type PipelineStage = 'idle' | 'proposing' | 'revising' | 'reasoning'

export interface FrameMeta {
  /** Supplying it lets an unchanged batch be dropped before any model call. */
  greyscaleThumbnail?: Uint8Array
}

export interface UserModel {
  addFrame(frame: Blob, meta?: FrameMeta): void
  /** Interactive Feedback Notes in their current Step → Note → item shape. */
  observeFeedback(batch: UserModelFeedbackBatch): Promise<void>
  /** Explicit Q&A collected by the ask_user condition during one request. */
  observeAskUser(batch: UserModelAskUserBatch): Promise<void>
  /** Seed from disk. Replaces whatever is held. */
  load(propositions: SavedProposition[]): void
  clear(): void
  readonly propositions: Proposition[]
}

const DEFAULT_BATCH_SIZE = 6

/** §5.4: γ = exp(−α·k·age), k = 2, age in days. */
const DECAY_K = 2
/** The paper uses days, so decay is a no-op inside one sitting. Shorten it to
 * watch decay work in a single session. */
const AGE_UNIT_MS = 24 * 60 * 60 * 1000

/** Below this a neighbour is unrelated; showing it to Revise only adds noise. */
const SIMILARITY_FLOOR = 0.3
const MAX_NEIGHBOURS = 5

/** Measured: working batches scored 1.3–64, watching batches 0.17–1.41. A model
 * asked what changed when nothing did invents an answer. */
const IDLE_PIXEL_DIFFERENCE = 1.0

const PROPOSE_INSTRUCTION =
  'These are consecutive screenshots of one session, in order. Say what the user is doing.'

// ---------------------------------------------------------------- parsing

/** Fences arrive often, and sometimes unclosed because thinking ate the output
 * budget, so take everything between the first `[` and the last `]`. */
function parseJsonArray(raw: string): unknown[] {
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)```/.exec(raw)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start === -1 || end < start) return []
  const parsed: unknown = JSON.parse(body.slice(start, end + 1))
  return Array.isArray(parsed) ? parsed : []
}

/** Three spellings because models mix `proposition`, `text` and `what` whatever
 * the prompt asked for, and dropping a batch over the key costs a batch. */
interface RawReplyItem {
  id?: unknown
  proposition?: unknown
  text?: unknown
  what?: unknown
  confidence?: unknown
  decay?: unknown
  reasoning?: unknown
  relation?: unknown
}

function isRawReplyItem(item: unknown): item is RawReplyItem {
  return typeof item === 'object' && item !== null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 1–10 as asked for, mapped to 0–1 so that 1/10 lands on zero — the paper's
 * retired-but-retained state — and 10/10 on full belief. */
function readScore(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, (n - 1) / 9))
}

/** `grounds` is required: it is the only thing between a reading of scarce
 * evidence and a guess, and a model that cannot write it has not got one. */
interface RequestedRationale {
  id: string
  rationale: string
  grounds: string
  from: string[]
}

interface RawRationaleItem {
  id?: unknown
  rationale?: unknown
  purpose_evidence_quote?: unknown
  rationale_grounds?: unknown
  rationale_from?: unknown
}

interface RequestedRationaleResult {
  accepted: RequestedRationale[]
  rejected: string[]
}

function readRequestedRationales(
  raw: string,
  evidenceTexts: readonly string[]
): RequestedRationaleResult {
  const accepted: RequestedRationale[] = []
  const rejected: string[] = []
  for (const [index, item] of parseJsonArray(raw).entries()) {
    if (typeof item !== 'object' || item === null) {
      rejected.push(`entry ${index + 1}: not an object`)
      continue
    }
    const row = item as RawRationaleItem
    const id = readString(row.id)
    const rationale = readString(row.rationale)
    const purposeEvidenceQuote = readString(row.purpose_evidence_quote)
    const grounds = readString(row.rationale_grounds)
    const missing = [
      !id ? 'id' : '',
      !rationale ? 'rationale' : '',
      !purposeEvidenceQuote ? 'purpose_evidence_quote' : '',
      !grounds ? 'rationale_grounds' : ''
    ].filter(Boolean)
    if (missing.length > 0) {
      rejected.push(`entry ${index + 1}: missing ${missing.join(', ')}`)
      continue
    }
    if (!evidenceTexts.some((text) => text.includes(purposeEvidenceQuote))) {
      rejected.push(`entry ${index + 1}: purpose quote is not an exact feedback substring`)
      continue
    }
    const from = Array.isArray(row.rationale_from)
      ? row.rationale_from.map(readString).filter(Boolean)
      : []
    accepted.push({ id, rationale, grounds, from })
  }
  return { accepted, rejected }
}

function readCandidatePropositions(raw: string): CandidateProposition[] {
  return parseJsonArray(raw)
    .map((item): CandidateProposition | null => {
      if (typeof item === 'string') {
        return item.trim() ? { text: item.trim(), confidence: 0.5, reasoning: '' } : null
      }
      if (!isRawReplyItem(item)) return null
      const text = readString(item.proposition) || readString(item.text) || readString(item.what)
      if (!text) return null
      return {
        text,
        confidence: readScore(item.confidence, 0.5),
        reasoning: readString(item.reasoning)
      }
    })
    .filter((c): c is CandidateProposition => c !== null)
}

/** One revision. A null id means "create". */
interface RequestedRevision {
  id: string | null
  text: string
  confidence: number
  decay: number
  reasoning: string
  relation?: FeedbackClaimRelation
}

type FeedbackClaimRelation =
  | 'confirmation'
  | 'same_claim_refinement'
  | 'contextual_exception'
  | 'contradiction'
  | 'new_claim'

const FEEDBACK_CLAIM_RELATIONS = new Set<FeedbackClaimRelation>([
  'confirmation',
  'same_claim_refinement',
  'contextual_exception',
  'contradiction',
  'new_claim'
])

function readRequestedRevisions(raw: string): RequestedRevision[] {
  return parseJsonArray(raw)
    .map((item): RequestedRevision | null => {
      if (!isRawReplyItem(item)) return null
      const text = readString(item.text) || readString(item.proposition)
      if (!text) return null
      const id = readString(item.id)
      return {
        id: id && id !== 'null' ? id : null,
        text,
        confidence: readScore(item.confidence, 0.5),
        decay: readScore(item.decay, 0.5),
        reasoning: readString(item.reasoning),
        relation: FEEDBACK_CLAIM_RELATIONS.has(readString(item.relation) as FeedbackClaimRelation)
          ? (readString(item.relation) as FeedbackClaimRelation)
          : undefined
      }
    })
    .filter((op): op is RequestedRevision => op !== null)
}

function validFeedbackRevision(revision: RequestedRevision, propositions: Proposition[]): boolean {
  const relation = revision.relation
  if (!relation) return false
  const existing = revision.id === null ? undefined : propositions.find((p) => p.id === revision.id)
  if (revision.id !== null && !existing) return false
  if (relation === 'confirmation') {
    return existing?.text === revision.text
  }
  if (relation === 'same_claim_refinement') return existing !== undefined
  if (relation === 'new_claim') return revision.id === null
  if (relation === 'contextual_exception') return revision.id === null
  return true
}

// ---------------------------------------------------------------- retrieval

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (const [i, value] of a.entries()) {
    dot += value * b[i]
    normA += value * value
    normB += b[i] * b[i]
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dot / denominator
}

/** Mean absolute difference between thumbnails. Missing ones read as "it moved",
 * so a batch is never skipped blind. Not called drift, which is taken. */
function meanPixelDifference(earlier: Uint8Array, later: Uint8Array): number {
  if (earlier.length === 0 || earlier.length !== later.length) return Number.POSITIVE_INFINITY
  let sum = 0
  for (const [i, value] of earlier.entries()) sum += Math.abs(value - later[i])
  return sum / earlier.length
}

/** Measured from the last batch we actually looked at, so a slow creep trips the
 * threshold instead of slipping past one imperceptible batch at a time. */
function largestFrameChange(thumbnails: Uint8Array[], sinceThumbnail: Uint8Array | null): number {
  // First batch, or no thumbnails supplied: no grounds to skip anything.
  if (!sinceThumbnail || thumbnails.length === 0) return Number.POSITIVE_INFINITY
  const chain = [sinceThumbnail, ...thumbnails]
  let most = 0
  for (let i = 1; i < chain.length; i++) {
    most = Math.max(most, meanPixelDifference(chain[i - 1], chain[i]))
  }
  return most
}

/** In whatever `AGE_UNIT_MS` calls a unit. Only decay consumes it. */
export function ageInDecayUnits(isoTimestamp: string, now: number): number {
  const at = Date.parse(isoTimestamp)
  return Number.isNaN(at) ? 0 : Math.max(0, (now - at) / AGE_UNIT_MS)
}

/** Discounted by how stale each expects to be, so tomorrow's candidate is
 * compared against what persists rather than against yesterday's noise. */
interface ScoredProposition {
  proposition: Proposition
  score: number
}

function nearestPropositionScores(
  embedding: number[],
  propositions: Proposition[],
  now: number
): ScoredProposition[] {
  return propositions
    .map((proposition) => ({
      proposition,
      score:
        cosine(embedding, proposition.embedding) *
        Math.exp(-proposition.decay * DECAY_K * ageInDecayUnits(proposition.updatedAt, now))
    }))
    .filter((scored) => scored.score >= SIMILARITY_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_NEIGHBOURS)
}

function nearestPropositions(
  embedding: number[],
  propositions: Proposition[],
  now: number
): Proposition[] {
  return nearestPropositionScores(embedding, propositions, now).map((scored) => scored.proposition)
}

// ---------------------------------------------------------------- pipeline

export function createUserModel(options: UserModelOptions): UserModel {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const { deps } = options

  let propositions: Proposition[] = []
  let buffer: Blob[] = []
  let thumbnails: Uint8Array[] = []
  /** Thumbnail of the last frame we actually spent a model call on. */
  let lastFrameReasonedAbout: Uint8Array | null = null
  /** One batch at a time: revisions mutate the same set, so they cannot race. */
  let running = false
  let frameRun: Promise<void> | null = null

  function stage(next: PipelineStage): void {
    options.onStage?.(next)
  }

  function applyRevisions(revisions: RequestedRevision[], now: string): Proposition[] {
    const touched: Proposition[] = []
    for (const op of revisions) {
      const existing = op.id === null ? undefined : propositions.find((p) => p.id === op.id)
      if (existing) {
        options.onRevision?.({
          id: existing.id,
          before: { text: existing.text, confidence: existing.confidence },
          after: { text: op.text, confidence: op.confidence }
        })
        if (op.text !== existing.text) existing.revisions += 1
        existing.text = op.text
        existing.confidence = op.confidence
        existing.decay = op.decay
        existing.reasoning = op.reasoning
        existing.updatedAt = now
        existing.observations += 1
        touched.push(existing)
      } else {
        // An invented id is treated as new rather than dropped.
        const created: Proposition = {
          id: crypto.randomUUID(),
          text: op.text,
          confidence: op.confidence,
          decay: op.decay,
          reasoning: op.reasoning,
          // The why comes later, from the call that reads feedback.
          rationale: null,
          rationaleGrounds: null,
          rationaleFrom: [],
          createdAt: now,
          updatedAt: now,
          observations: 1,
          embedding: [],
          originalText: op.text,
          originalEmbedding: [],
          revisions: 0
        }
        options.onRevision?.({
          id: created.id,
          before: null,
          after: { text: created.text, confidence: created.confidence }
        })
        propositions.push(created)
        touched.push(created)
      }
    }
    return touched
  }

  /** Candidates to a revised model. Split out because an answered note is an
   * observation too, and takes the same retrieval and revision. */
  /** A proposition as the revision prompts want to see it, drift and all. */
  /** Opposite permissions to `applyRevisions`: only the rationale moves here, so
   * a proposition can appear in both lists without the two colliding. Any
   * proposition may get one — the guard is against invention, not reach. */
  function applyRationales(asked: RequestedRationale[], now: string): Proposition[] {
    const known = new Map(propositions.map((p) => [p.id, p]))
    const touched: Proposition[] = []
    for (const op of asked) {
      const target = known.get(op.id)
      if (!target) {
        options.onRationaleDropped?.(`no proposition with id ${op.id}: "${op.rationale}"`)
        continue
      }
      const unknownIds = op.from.filter((id) => !known.has(id))
      if (unknownIds.length > 0) {
        options.onRationaleDropped?.(
          `read-with ids do not exist (${unknownIds.join(', ')}) on "${target.text}"`
        )
        continue
      }
      options.onRationale?.({
        text: target.text,
        before: target.rationale,
        after: op.rationale,
        grounds: op.grounds,
        readWith: op.from.map((id) => known.get(id)?.text ?? id)
      })
      target.rationale = op.rationale
      target.rationaleGrounds = op.grounds
      target.rationaleFrom = op.from
      target.updatedAt = now
      touched.push(target)
    }
    return touched
  }

  /** Read after the change, so `wasNew` is the only part that cannot be
   * recovered from the proposition itself. */
  function describeChange(proposition: Proposition): ChangedProposition {
    return {
      text: proposition.text,
      confidence: proposition.confidence,
      reasoning: proposition.reasoning,
      wasNew: proposition.observations === 1
    }
  }

  function describe(proposition: Proposition, now: number): ReviseNeighbour {
    return {
      id: proposition.id,
      text: proposition.text,
      confidence: proposition.confidence,
      decay: proposition.decay,
      ageDays: ageInDecayUnits(proposition.updatedAt, now),
      revisions: proposition.revisions,
      originalText: proposition.originalText,
      // Measured here, judged by the model: a number, not a veto.
      cosineToOriginalText: cosine(proposition.embedding, proposition.originalEmbedding)
    }
  }

  /** Only what was rewritten needs a new vector, and it goes in one request. */
  async function reEmbed(changed: Proposition[]): Promise<void> {
    if (changed.length === 0) return
    const vectors = await deps.embed(changed.map((p) => p.text))
    for (const [i, proposition] of changed.entries()) {
      // `.at`, so a short reply leaves the old vector alone rather than clearing it.
      const vector = vectors.at(i)
      if (!vector) continue
      proposition.embedding = vector
      // Pinned on first success, so later revisions have a baseline.
      if (proposition.originalEmbedding.length === 0) proposition.originalEmbedding = vector
    }
    options.onChange([...propositions])
  }

  /** From candidates read off screenshots to a revised model. */
  async function revise(candidates: CandidateProposition[]): Promise<void> {
    options.onCandidates?.(candidates)
    stage('revising')
    const embeddings = await deps.embed(candidates.map((c) => c.text))
    const now = Date.now()
    const stamp = new Date(now).toISOString()
    const changed: Proposition[] = []

    // Sequential: each revision changes what the next one retrieves.
    for (const [i, candidate] of candidates.entries()) {
      const neighbours = nearestPropositions(embeddings[i] ?? [], propositions, now)
      const raw = await deps.revise({
        system: REVISE_SYSTEM,
        purpose: 'revise-from-frames',
        prompt: reviseUserPrompt(
          candidate,
          neighbours.map((n) => describe(n, now))
        )
      })
      changed.push(...applyRevisions(readRequestedRevisions(raw), stamp))
    }

    await reEmbed(changed)
  }

  async function run(frames: Blob[]): Promise<void> {
    running = true
    try {
      stage('proposing')
      const candidates = readCandidatePropositions(
        await deps.propose({
          system: PROPOSE_SYSTEM,
          images: frames,
          instruction: PROPOSE_INSTRUCTION
        })
      )
      if (candidates.length > 0) await revise(candidates)
    } catch (error) {
      options.onError?.(error)
    } finally {
      running = false
      stage('idle')
    }
  }

  interface ExplicitEvidenceRevision {
    propositionSystem: string
    propositionPrompt: string
    rationaleSystem: string
    rationalePrompt(changed: ChangedProposition[]): string
    evidenceTexts: readonly string[]
    purpose: Extract<RevisionPurpose, 'revise-from-feedback' | 'revise-from-ask-user'>
    stamp: string
  }

  /** Feedback Notes and ask_user answers have different evidence semantics and
   * prompts, but once a model requests operations they share the same guarded
   * proposition and rationale application machinery. */
  async function reviseFromExplicitEvidence(input: ExplicitEvidenceRevision): Promise<void> {
    const raw = await deps.revise({
      system: input.propositionSystem,
      purpose: input.purpose,
      prompt: input.propositionPrompt
    })
    const asked = readRequestedRevisions(raw).filter((revision) =>
      validFeedbackRevision(revision, propositions)
    )
    const changed = applyRevisions(asked, input.stamp)
    if (changed.length > 0) await reEmbed(changed)

    stage('reasoning')
    const rawRationales = await deps.revise({
      system: input.rationaleSystem,
      purpose: input.purpose,
      prompt: input.rationalePrompt(changed.map(describeChange))
    })
    const rationaleResult = readRequestedRationales(rawRationales, input.evidenceTexts)
    for (const reason of rationaleResult.rejected) options.onRationaleDropped?.(reason)
    const rationales = applyRationales(rationaleResult.accepted, input.stamp)

    // `reEmbed` is what normally saves, and a rationale changes no wording.
    if (rationales.length > 0) options.onChange([...propositions])
  }

  /** One call, no propose step. Directly cited propositions establish why a
   * note was created, while embedding neighbours expose adjacent claims that
   * may also need refinement and prevent near-duplicate creation. */
  async function observeFeedback(batch: UserModelFeedbackBatch): Promise<void> {
    if (batch.notes.length === 0) return
    // Direct user evidence must not disappear because a timer-driven frame
    // batch happened to start first.
    if (frameRun) await frameRun
    if (running) return
    running = true
    try {
      stage('revising')
      const now = Date.now()
      const shown = new Map<string, Proposition>()
      const retrievalNotes: FeedbackRetrievalNote[] = batch.notes.map((note) => ({
        noteId: note.noteId,
        directIds: [],
        embedding: []
      }))

      for (const [index, note] of batch.notes.entries()) {
        const trace = retrievalNotes[index]
        if (!trace) continue
        for (const cited of note.propositionIds) {
          const held = propositions.find((p) => p.id === cited)
          if (!held) continue
          shown.set(held.id, held)
          trace.directIds.push(held.id)
        }
      }

      const vectors = await deps.embed(
        batch.notes.map((note) => {
          const feedback = note.feedbackItems.map((item) => item.feedback).join('\n')
          return [note.topic, note.cue, note.reasoningEvidence, feedback].filter(Boolean).join('\n')
        })
      )
      for (const [i] of batch.notes.entries()) {
        const trace = retrievalNotes[i]
        if (!trace) continue
        for (const near of nearestPropositionScores(vectors[i] ?? [], propositions, now)) {
          shown.set(near.proposition.id, near.proposition)
          trace.embedding.push({ id: near.proposition.id, score: near.score })
        }
      }
      options.onFeedbackRetrieval?.({ notes: retrievalNotes, shownIds: [...shown.keys()] })

      const stamp = new Date(now).toISOString()
      await reviseFromExplicitEvidence({
        propositionSystem: FEEDBACK_SYSTEM,
        propositionPrompt: feedbackUserPrompt(
          batch,
          [...shown.values()].map((p) => describe(p, now))
        ),
        rationaleSystem: RATIONALE_SYSTEM,
        rationalePrompt: (changed) => rationaleUserPrompt(batch, changed, propositions),
        evidenceTexts: batch.notes.flatMap((note) =>
          note.feedbackItems.map((item) => item.feedback)
        ),
        purpose: 'revise-from-feedback',
        stamp
      })
    } catch (error) {
      options.onError?.(error)
    } finally {
      running = false
      stage('idle')
    }
  }

  /** Ask User has no directly linked proposition ids. Each explicit answer is
   * embedded independently, then the union of related propositions is shown to
   * one request-level update call alongside every question and option. */
  async function observeAskUser(batch: UserModelAskUserBatch): Promise<void> {
    if (batch.answers.length === 0) return
    if (frameRun) await frameRun
    if (running) return
    running = true
    try {
      stage('revising')
      const now = Date.now()
      const shown = new Map<string, Proposition>()
      const vectors = await deps.embed(
        batch.answers.map((entry) =>
          [
            `Question: ${entry.question.question}`,
            entry.selectedOption ? `Selected option: ${entry.selectedOption}` : '',
            `Final answer: ${entry.answer}`
          ]
            .filter(Boolean)
            .join('\n')
        )
      )
      const questions = batch.answers.map((entry, index) => {
        const embedding = nearestPropositionScores(vectors[index] ?? [], propositions, now).map(
          (near) => {
            shown.set(near.proposition.id, near.proposition)
            return { id: near.proposition.id, score: near.score }
          }
        )
        return { questionId: entry.question.id, embedding }
      })
      options.onAskUserRetrieval?.({ questions, shownIds: [...shown.keys()] })

      const stamp = new Date(now).toISOString()
      await reviseFromExplicitEvidence({
        propositionSystem: FEEDBACK_SYSTEM_ASKUSER,
        propositionPrompt: feedbackAskUserPrompt(
          batch,
          [...shown.values()].map((proposition) => describe(proposition, now))
        ),
        rationaleSystem: RATIONALE_SYSTEM_ASKUSER,
        rationalePrompt: (changed) => rationaleAskUserPrompt(batch, changed, propositions),
        evidenceTexts: batch.answers.map((entry) => entry.answer),
        purpose: 'revise-from-ask-user',
        stamp
      })
    } catch (error) {
      options.onError?.(error)
    } finally {
      running = false
      stage('idle')
    }
  }

  return {
    get propositions() {
      return propositions
    },

    observeFeedback,
    observeAskUser,

    load(saved) {
      // A file predating drift tracking has no original, so take where it is
      // now as where it started.
      propositions = saved.map((p) => ({
        ...p,
        originalText: p.originalText || p.text,
        originalEmbedding: p.originalEmbedding?.length ? p.originalEmbedding : p.embedding,
        revisions: p.revisions ?? 0,
        // Written before rationales existed, or never given one.
        rationale: p.rationale ?? null,
        rationaleGrounds: p.rationaleGrounds ?? null,
        rationaleFrom: p.rationaleFrom ?? []
      }))
    },

    clear() {
      propositions = []
      buffer = []
      thumbnails = []
      lastFrameReasonedAbout = null
    },

    addFrame(frame, meta) {
      buffer.push(frame)
      if (meta?.greyscaleThumbnail) thumbnails.push(meta.greyscaleThumbnail)
      if (buffer.length < batchSize) return
      if (running) {
        // Falling behind should cost history, not memory.
        buffer = buffer.slice(-batchSize)
        thumbnails = thumbnails.slice(-batchSize)
        return
      }

      const batch = buffer
      const batchThumbnails = thumbnails
      buffer = []
      thumbnails = []

      // Partly-covered batches are not evidence of stillness.
      const pixelChange =
        batchThumbnails.length === batch.length
          ? largestFrameChange(batchThumbnails, lastFrameReasonedAbout)
          : Number.POSITIVE_INFINITY
      if (pixelChange < IDLE_PIXEL_DIFFERENCE) {
        // Does not advance `lastFrameReasonedAbout`, so the comparison stays
        // anchored to the last frame we spent a call on.
        options.onIdle?.(pixelChange)
        return
      }
      lastFrameReasonedAbout = batchThumbnails.at(-1) ?? lastFrameReasonedAbout
      const task = run(batch)
      frameRun = task
      void task.finally(() => {
        if (frameRun === task) frameRun = null
      })
    }
  }
}
