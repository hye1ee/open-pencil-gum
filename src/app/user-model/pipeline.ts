/**
 * A general user model built from screen captures, after Shaikh et al.,
 * *Creating General User Models from Computer Use* (arXiv:2505.10831).
 *
 * Per batch of frames:
 *
 *   PROPOSE   a VLM reads the frames and states what the user is doing
 *   EMBED     the candidates, in one call
 *   RETRIEVE  the closest existing propositions — cosine, weighted by staleness
 *   REVISE    one call per candidate, given its neighbours and their metadata,
 *             which rewrites them: merging, sharpening, or contradicting
 *
 * The paper has no pairwise same/different judge, and neither does this. Asking
 * "are these two the same?" can only ever answer yes or no; handing the model a
 * candidate and its whole neighbourhood at once lets it merge, split, or lower
 * its confidence in something it now doubts — and, crucially, rewrite the text.
 * Without that last part a proposition is frozen at whatever the first
 * observation happened to say, and the model stops improving.
 *
 * Self-contained on purpose: no app imports and no provider SDK, so the folder
 * copies into another web project as-is. Everything domain-specific is in
 * `prompt.ts`; everything network-specific is injected as `deps`.
 */

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
  /**
   * Why this person wants what the proposition says they want — null until
   * something they said or let happen gives a reason to write one.
   *
   * Kept apart from `text` because the two answer to different evidence and
   * move on different schedules. The text is the falsifiable record and is
   * fixed once written; the rationale is a reading of it, and is meant to get
   * better. Only feedback writes it: a screenshot shows what someone did, never
   * what for.
   */
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

/**
 * A proposition as read back from disk. Drift tracking was added after the
 * first files were written, so those three fields may be absent — the type
 * says so rather than letting `load` pretend otherwise.
 */
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

/**
 * Which evidence a revision call is working from.
 *
 * Passed out to the caller so it can send the two down different models: one
 * reads screenshots on a timer, the other runs when a person has just said
 * something in their own words, and those are not worth the same money. Nothing
 * in this file behaves differently by it.
 */
export type RevisionPurpose = 'revise-from-frames' | 'revise-from-feedback'

export interface UserModelDeps {
  /** Vision call over the frames. Returns the model's raw text. */
  propose(input: {
    system: string
    images: Blob[]
    instruction: string
    /** What else was happening while these frames were taken, if anything. */
    context: string[]
  }): Promise<string>
  /** Text call. Returns the model's raw text. */
  revise(input: { system: string; prompt: string; purpose: RevisionPurpose }): Promise<string>
  /** One request for all the texts, in order. */
  embed(texts: string[]): Promise<number[][]>
}

/**
 * One note that was shown to the person, and what became of it.
 *
 * This is the shape the notes already have, carried through intact rather than
 * flattened into prose. `citedId` in particular: the note was raised *against*
 * a specific proposition, and that is the one thing a revision most needs to
 * know. Turning it into a sentence and then finding the proposition again by
 * embedding similarity is throwing away an exact answer to go and guess it.
 */
export type FeedbackRelation = 'conflict' | 'alignment' | 'unknown'

export interface FeedbackNote {
  /** What the person read, in the words they read it in. */
  note: string
  /** The agent's own words the note was drawn from. */
  quote: string
  /** The proposition the note rested on, or null if none covered it. */
  citedId: string | null
  /**
   * Whether the note said the agent was going against that proposition, going
   * along with it, or working somewhere the model is silent.
   *
   * Without this a note and a silence mean the wrong thing. Letting a conflict
   * stand is agreeing the belief failed; letting an alignment stand is agreeing
   * it held — opposite readings of the same absence of a reply.
   */
  relation: FeedbackRelation
  /** What they typed back, or null if they saw it and let it stand. */
  reply: string | null
}

export interface UserModelOptions {
  deps: UserModelDeps
  /** Frames per batch. Six at a five-second cadence is half a minute of work. */
  batchSize?: number
  /** Called after every batch that changed something. */
  onChange: (propositions: Proposition[]) => void
  /**
   * One proposition, before and after. `before` is null for a new one.
   *
   * Fired per revision rather than once per batch because the state this
   * pipeline keeps is a file overwritten in place: without a running account of
   * what changed and why, all anyone can see later is where it ended up.
   */
  onRevision?: (change: {
    id: string
    before: { text: string; confidence: number } | null
    after: { text: string; confidence: number }
  }) => void
  /**
   * One rationale, with what it was read off.
   *
   * The grounds go out here rather than only into the file because they are the
   * instrument for judging this stage. A rationale drawn from a proposition no
   * note touched is where invention would show up first, and `readWith` is what
   * makes that visible without opening the model.
   */
  onRationale?: (change: {
    text: string
    before: string | null
    after: string
    grounds: string
    readWith: string[]
  }) => void
  /**
   * A rationale the model asked for and did not get, with the reason.
   *
   * Everything the guard drops is invisible otherwise: a batch where the model
   * wrote five and three were refused looks identical to one where it wrote
   * two. Which end is at fault — a prompt that is not landing, or a guard that
   * is too strict — cannot be told apart without this.
   */
  onRationaleDropped?: (reason: string) => void
  /** What was read out of an observation, before any of it was applied. */
  onCandidates?: (candidates: CandidateProposition[]) => void
  onStage?: (stage: PipelineStage) => void
  /** A batch dropped because the screen had not moved, with how far it did. */
  onIdle?: (pixelChange: number) => void
  onError?: (error: unknown) => void
}

export type PipelineStage = 'idle' | 'proposing' | 'revising' | 'reasoning'

export interface FrameMeta {
  /**
   * A small greyscale thumbnail of the frame (see `page-capture`). Supplying it
   * lets a batch where nothing moved be dropped before any model call; without
   * it every batch runs.
   */
  greyscaleThumbnail?: Uint8Array
  /**
   * Anything the caller knows about this moment that the pixels do not say —
   * above all, whether something other than the user was driving. Screenshots
   * cannot tell "the user did this" from "the user watched this happen", and
   * a user model built without that distinction learns the wrong person.
   */
  note?: string
}

export interface UserModel {
  addFrame(frame: Blob, meta?: FrameMeta): void
  /**
   * The notes shown to the person during one build, and what became of each.
   * Revised in straight away rather than batched: batching exists because
   * frames arrive every five seconds whether or not anything happened, and this
   * arrives because they answered something.
   */
  observe(notes: FeedbackNote[]): Promise<void>
  /** Seed from disk. Replaces whatever is held. */
  load(propositions: SavedProposition[]): void
  clear(): void
  readonly propositions: Proposition[]
}

const DEFAULT_BATCH_SIZE = 6

/** §5.4: γ = exp(−α·k·age), k = 2, age in days. */
const DECAY_K = 2
/**
 * What one unit of `age` means. The paper uses days, which makes decay a no-op
 * inside a single sitting and only meaningful once observations span days —
 * which is the point. Shorten it to watch decay work in a single session.
 */
const AGE_UNIT_MS = 24 * 60 * 60 * 1000

/** Below this a neighbour is unrelated; showing it to Revise only adds noise. */
const SIMILARITY_FLOOR = 0.3
const MAX_NEIGHBOURS = 5

/**
 * Mean per-pixel greyscale difference below which a batch counts as "nothing
 * happened". Measured on a real session: batches where the user was working
 * scored 1.3–64, batches where they sat watching scored 0.17–1.41. A model
 * asked what changed when nothing did will invent an answer, so this is the
 * difference between revision and paraphrase.
 */
const IDLE_PIXEL_DIFFERENCE = 1.0

const PROPOSE_INSTRUCTION =
  'These are consecutive screenshots of one session, in order. Say what the user is doing.'

// ---------------------------------------------------------------- parsing

/**
 * Models wrap JSON in fences often enough that not handling it is a bug.
 *
 * The opening fence can also arrive without its closing one, because on a
 * reasoning model the thinking comes out of the same output budget as the
 * answer: think for long enough and the JSON is cut off mid-object. So rather
 * than trusting the fence, take everything between the first `[` and the last
 * `]`. A reply too truncated to contain both yields nothing and the batch is
 * dropped — the next one is thirty seconds away.
 */
function parseJsonArray(raw: string): unknown[] {
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)```/.exec(raw)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start === -1 || end < start) return []
  const parsed: unknown = JSON.parse(body.slice(start, end + 1))
  return Array.isArray(parsed) ? parsed : []
}

/**
 * One entry of the JSON array a model returned, before any of it is trusted.
 *
 * The keys are spelled the way the two prompts ask for them, plus the ones
 * models reach for anyway when asked for a proposition: `proposition` is what
 * Propose is told to send and `text` is what Revise is told to send, and either
 * turns up in either answer. `what` is the third spelling seen in practice.
 * Reading all three costs nothing; dropping a whole batch over the key it chose
 * costs a batch.
 */
interface RawReplyItem {
  id?: unknown
  proposition?: unknown
  text?: unknown
  what?: unknown
  confidence?: unknown
  decay?: unknown
  reasoning?: unknown
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

/**
 * One rationale, as asked for. `grounds` is required and not decoration: it is
 * the only thing standing between a reading of scarce evidence and a guess
 * dressed up as knowledge, and a model that cannot write it has not got one.
 */
interface RequestedRationale {
  id: string
  rationale: string
  grounds: string
  from: string[]
}

interface RawRationaleItem {
  id?: unknown
  rationale?: unknown
  rationale_grounds?: unknown
  rationale_from?: unknown
}

function readRequestedRationales(raw: string): RequestedRationale[] {
  return parseJsonArray(raw)
    .map((item): RequestedRationale | null => {
      if (typeof item !== 'object' || item === null) return null
      const row = item as RawRationaleItem
      const id = readString(row.id)
      const rationale = readString(row.rationale)
      const grounds = readString(row.rationale_grounds)
      if (!id || !rationale || !grounds) return null
      const from = Array.isArray(row.rationale_from)
        ? row.rationale_from.map(readString).filter(Boolean)
        : []
      return { id, rationale, grounds, from }
    })
    .filter((op): op is RequestedRationale => op !== null)
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
}

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
        reasoning: readString(item.reasoning)
      }
    })
    .filter((op): op is RequestedRevision => op !== null)
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

/**
 * How far two frames are apart, as the mean absolute difference between their
 * thumbnails. Missing or mismatched thumbnails read as "it moved", so a batch is
 * never skipped blind.
 *
 * Named for what it measures rather than "drift", which in this folder already
 * means how far a proposition's wording has travelled from the one it was
 * written with — a different thing, on a different clock.
 */
function meanPixelDifference(earlier: Uint8Array, later: Uint8Array): number {
  if (earlier.length === 0 || earlier.length !== later.length) return Number.POSITIVE_INFINITY
  let sum = 0
  for (const [i, value] of earlier.entries()) sum += Math.abs(value - later[i])
  return sum / earlier.length
}

/**
 * The largest single step across the batch, measured from the last batch we
 * actually looked at. Chaining from there rather than from the batch's own
 * first frame means a slow creep still eventually trips the threshold instead
 * of slipping past it one imperceptible batch at a time.
 */
function largestFrameChange(thumbnails: Uint8Array[], sinceThumbnail: Uint8Array | null): number {
  // Nothing to compare against: either this is the first batch — still the
  // first thing we know about the session — or the caller supplied no
  // thumbnails, in which case we have no grounds to skip anything.
  if (!sinceThumbnail || thumbnails.length === 0) return Number.POSITIVE_INFINITY
  const chain = [sinceThumbnail, ...thumbnails]
  let most = 0
  for (let i = 1; i < chain.length; i++) {
    most = Math.max(most, meanPixelDifference(chain[i - 1], chain[i]))
  }
  return most
}

/**
 * How old a timestamp is, in whatever `AGE_UNIT_MS` calls a unit. Only decay
 * consumes it, which is what fixes the unit — the paper measures age in days
 * and `AGE_UNIT_MS` is where that is set.
 */
export function ageInDecayUnits(isoTimestamp: string, now: number): number {
  const at = Date.parse(isoTimestamp)
  return Number.isNaN(at) ? 0 : Math.max(0, (now - at) / AGE_UNIT_MS)
}

/**
 * The closest propositions, discounted by how stale each one expects to be. A
 * durable observation stays retrievable for weeks; "is aligning a row of cards"
 * drops out of contention within a day, so tomorrow's candidate is compared
 * against what actually persists rather than against yesterday's noise.
 */
function nearestPropositions(
  embedding: number[],
  propositions: Proposition[],
  now: number
): Proposition[] {
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
    .map((scored) => scored.proposition)
}

// ---------------------------------------------------------------- pipeline

export function createUserModel(options: UserModelOptions): UserModel {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const { deps } = options

  let propositions: Proposition[] = []
  let buffer: Blob[] = []
  let thumbnails: Uint8Array[] = []
  let notes: string[] = []
  /** Thumbnail of the last frame we actually spent a model call on. */
  let lastFrameReasonedAbout: Uint8Array | null = null
  /** One batch at a time: revisions mutate the same set, so they cannot race. */
  let running = false

  function stage(next: PipelineStage): void {
    options.onStage?.(next)
  }

  /**
   * On the feedback path a proposition that is already held keeps its wording,
   * whatever the model asked for. Only its confidence moves.
   *
   * The sentence is what made the mark fire, so a belief that fails and is then
   * reworded loses the very clause it failed on. Measured: "near-monochrome
   * greys with one warm accent, never a default blue or indigo" became
   * "near-monochrome with one warm accent" on the evidence of a terracotta
   * gradient — and indigo, which nothing had been observed about, stopped being
   * detectable. Nothing is lost by holding the wording, because what the person
   * actually accepted is written down as its own new proposition either way.
   *
   * Only here. The frame path revises from what a screenshot shows, where
   * rewriting a sentence is the whole point.
   */
  function keepWordingOfStanding(revisions: RequestedRevision[]): RequestedRevision[] {
    return revisions.map((op) => {
      const held = op.id === null ? undefined : propositions.find((p) => p.id === op.id)
      return held ? { ...op, text: held.text } : op
    })
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
        // An id we don't know means the model invented one; treat it as new
        // rather than dropping the revision on the floor.
        const created: Proposition = {
          id: crypto.randomUUID(),
          text: op.text,
          confidence: op.confidence,
          decay: op.decay,
          reasoning: op.reasoning,
          // Never set here. A proposition is born from what someone did; the
          // why comes later, from the call that reads feedback.
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

  /**
   * The second half of the pipeline, from candidates to a revised model.
   *
   * Split out because candidates do not only come from screenshots. When the
   * person answers a note about the agent's thinking, that is an observation
   * too — a better one, since they said it rather than us inferring it from a
   * picture — and it should go through the same retrieval and revision rather
   * than getting a shortcut of its own.
   */
  /** A proposition as the revision prompts want to see it, drift and all. */
  /**
   * The why, written from feedback and nothing else.
   *
   * Separate from `applyRevisions` because the permissions are opposite. There,
   * an existing proposition's wording is fixed and only its confidence moves;
   * here, only the rationale moves and the wording and confidence are not even
   * read. A proposition may appear in both lists in the same batch without the
   * two treading on each other.
   *
   * A rationale is allowed on any proposition, including ones no note touched —
   * finding the reason three unexplained propositions have in common is the
   * whole point of showing the model all of them. What is checked is that the
   * ids are real and the grounds were written: the guard is against invention,
   * not against reach.
   */
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

  /** What the revision call just did to one proposition, for the call that
   * writes the why. Read after the change, so `wasNew` is the only part that
   * cannot be recovered from the proposition itself. */
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
      // How much of the first wording survives. Measured here, judged by the
      // model — the code offers the number, not a veto.
      cosineToOriginalText: cosine(proposition.embedding, proposition.originalEmbedding)
    }
  }

  /** Only what was rewritten needs a new vector, and it goes in one request. */
  async function reEmbed(changed: Proposition[]): Promise<void> {
    if (changed.length === 0) return
    const vectors = await deps.embed(changed.map((p) => p.text))
    for (const [i, proposition] of changed.entries()) {
      // `.at` rather than an index: a provider that returns fewer vectors
      // than we asked for should leave the old one alone, not clear it.
      const vector = vectors.at(i)
      if (!vector) continue
      proposition.embedding = vector
      // Pinned the first time we manage to embed it, so later revisions
      // always have something to be measured against.
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

    // Sequential: each revision changes what the next one retrieves, and two
    // candidates from the same batch are often about the same thing.
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

  async function run(frames: Blob[], context: string[]): Promise<void> {
    running = true
    try {
      stage('proposing')
      const candidates = readCandidatePropositions(
        await deps.propose({
          system: PROPOSE_SYSTEM,
          images: frames,
          instruction: PROPOSE_INSTRUCTION,
          context
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

  /**
   * The notes shown during one build, revised in directly.
   *
   * One model call, not the propose-then-revise pair the frame path uses, and
   * no retrieval for anything the notes already name. A note raised against a
   * proposition carries that proposition's id: it is the exact answer to "which
   * belief is this about", and the only reason to drop it and search by
   * embedding similarity instead would be not having it.
   *
   * Retrieval still runs for the notes that cite nothing. Those are the ones
   * raised where the model was blank, and without neighbours the revision has
   * no way to see it is about to write a near-duplicate of something already
   * held.
   */
  async function observe(notes: FeedbackNote[]): Promise<void> {
    if (running || notes.length === 0) return
    running = true
    try {
      stage('revising')
      const now = Date.now()
      const shown = new Map<string, Proposition>()

      for (const cited of notes.map((note) => note.citedId)) {
        if (cited === null) continue
        const held = propositions.find((p) => p.id === cited)
        if (held) shown.set(held.id, held)
      }

      const uncited = notes.filter((note) => note.citedId === null)
      if (uncited.length > 0) {
        const vectors = await deps.embed(uncited.map((note) => note.note))
        for (const [i] of uncited.entries()) {
          for (const near of nearestPropositions(vectors[i] ?? [], propositions, now)) {
            shown.set(near.id, near)
          }
        }
      }

      const raw = await deps.revise({
        system: FEEDBACK_SYSTEM,
        purpose: 'revise-from-feedback',
        prompt: feedbackUserPrompt(
          notes,
          [...shown.values()].map((p) => describe(p, now))
        )
      })
      const stamp = new Date(now).toISOString()
      const asked = keepWordingOfStanding(readRequestedRevisions(raw))
      const changed = applyRevisions(asked, stamp)
      if (changed.length > 0) await reEmbed(changed)

      // A second call, not a second half of the first. What changed and why
      // this person wanted it are different questions from different evidence,
      // and the why is answered better knowing the answer to the what: a belief
      // that just died and a belief whose reason turned out narrower look the
      // same in the notes and different in `changed`. Rationales are also
      // written across the whole model, so folding them in would have meant
      // handing the first call every proposition it has no business touching.
      stage('reasoning')
      const rawRationales = await deps.revise({
        system: RATIONALE_SYSTEM,
        purpose: 'revise-from-feedback',
        prompt: rationaleUserPrompt(notes, changed.map(describeChange), propositions)
      })
      const askedRationales = readRequestedRationales(rawRationales)
      // Counted rather than inspected: an entry missing an id, a rationale or
      // its grounds is dropped before `applyRationales` can name it, and the
      // difference is the only sign the prompt is not landing.
      const malformed = parseJsonArray(rawRationales).length - askedRationales.length
      if (malformed > 0) {
        options.onRationaleDropped?.(`${malformed} entries missing an id, a rationale or grounds`)
      }
      const rationales = applyRationales(askedRationales, stamp)

      // `reEmbed` saves as a side effect of embedding, and a rationale changes
      // no wording, so a batch that only wrote rationales would otherwise be
      // computed and thrown away.
      if (rationales.length > 0) options.onChange([...propositions])
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

    observe,

    load(saved) {
      // A file written before drift was tracked has no original to compare
      // against; treat whatever it says now as where it started, so the note
      // reads "never rewritten" rather than "unrecognisably changed".
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
      notes = []
      lastFrameReasonedAbout = null
    },

    addFrame(frame, meta) {
      buffer.push(frame)
      if (meta?.greyscaleThumbnail) thumbnails.push(meta.greyscaleThumbnail)
      if (meta?.note) notes.push(meta.note)
      if (buffer.length < batchSize) return
      if (running) {
        // Drop the oldest instead of queueing: falling behind should cost
        // history, not memory, and the recent frames are the relevant ones.
        buffer = buffer.slice(-batchSize)
        thumbnails = thumbnails.slice(-batchSize)
        notes = notes.slice(-batchSize)
        return
      }

      const batch = buffer
      const batchThumbnails = thumbnails
      // The same note repeats across a batch — the agent does not start and
      // stop between frames — so it is the distinct ones that carry meaning.
      const batchNotes = [...new Set(notes)]
      buffer = []
      thumbnails = []
      notes = []

      // A batch only partly covered by thumbnails is not evidence of stillness
      // — the frames we cannot see might be the ones that moved.
      const pixelChange =
        batchThumbnails.length === batch.length
          ? largestFrameChange(batchThumbnails, lastFrameReasonedAbout)
          : Number.POSITIVE_INFINITY
      if (pixelChange < IDLE_PIXEL_DIFFERENCE) {
        // Deliberately does not advance `lastFrameReasonedAbout`: the comparison
        // stays anchored to the last frame we actually reasoned about.
        options.onIdle?.(pixelChange)
        return
      }
      lastFrameReasonedAbout = batchThumbnails.at(-1) ?? lastFrameReasonedAbout
      void run(batch, batchNotes)
    }
  }
}
