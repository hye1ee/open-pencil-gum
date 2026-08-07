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

import { PROPOSE_SYSTEM, REVISE_SYSTEM, reviseUserPrompt } from '@/app/user-model/prompt'

export interface Proposition {
  id: string
  /** Rewritten by every revision that touches it — this is not an append log. */
  text: string
  /** 0–1, from a 1–10 elicitation. 0 means retired; we keep it either way. */
  confidence: number
  /** 0–1 staleness rate. Higher decays faster. */
  decay: number
  reasoning: string
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
  'originalText' | 'originalEmbedding' | 'revisions'
> &
  Partial<Pick<Proposition, 'originalText' | 'originalEmbedding' | 'revisions'>>

/** What the VLM returns before it has been placed in the model. */
interface Candidate {
  text: string
  confidence: number
  reasoning: string
}

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
  revise(input: { system: string; prompt: string }): Promise<string>
  /** One request for all the texts, in order. */
  embed(texts: string[]): Promise<number[][]>
}

export interface UserModelOptions {
  deps: UserModelDeps
  /** Frames per batch. Six at a five-second cadence is half a minute of work. */
  batchSize?: number
  /** Called after every batch that changed something. */
  onChange: (propositions: Proposition[]) => void
  onStage?: (stage: PipelineStage) => void
  /** A batch dropped because the screen had not moved, with how far it moved. */
  onIdle?: (movement: number) => void
  onError?: (error: unknown) => void
}

export type PipelineStage = 'idle' | 'proposing' | 'revising'

export interface FrameMeta {
  /**
   * A small greyscale thumbnail (see `page-capture`). Supplying it lets a batch
   * where nothing moved be dropped before any model call; without it every
   * batch runs.
   */
  signature?: Uint8Array
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
const TOP_K = 5

/**
 * Mean per-pixel greyscale difference below which a batch counts as "nothing
 * happened". Measured on a real session: batches where the user was working
 * scored 1.3–64, batches where they sat watching scored 0.17–1.41. A model
 * asked what changed when nothing did will invent an answer, so this is the
 * difference between revision and paraphrase.
 */
const IDLE_MOVEMENT = 1.0

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

interface Reply {
  id?: unknown
  proposition?: unknown
  text?: unknown
  what?: unknown
  confidence?: unknown
  decay?: unknown
  reasoning?: unknown
}

function isReply(item: unknown): item is Reply {
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

function readCandidates(raw: string): Candidate[] {
  return parseJsonArray(raw)
    .map((item): Candidate | null => {
      if (typeof item === 'string') {
        return item.trim() ? { text: item.trim(), confidence: 0.5, reasoning: '' } : null
      }
      if (!isReply(item)) return null
      const text = readString(item.proposition) || readString(item.text) || readString(item.what)
      if (!text) return null
      return {
        text,
        confidence: readScore(item.confidence, 0.5),
        reasoning: readString(item.reasoning)
      }
    })
    .filter((c): c is Candidate => c !== null)
}

/** One revision. A null id means "create". */
interface ReviseOp {
  id: string | null
  text: string
  confidence: number
  decay: number
  reasoning: string
}

function readOps(raw: string): ReviseOp[] {
  return parseJsonArray(raw)
    .map((item): ReviseOp | null => {
      if (!isReply(item)) return null
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
    .filter((op): op is ReviseOp => op !== null)
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

/** Unknown or mismatched signatures read as "it moved", so we never skip blind. */
function drift(a: Uint8Array, b: Uint8Array): number {
  if (a.length === 0 || a.length !== b.length) return Number.POSITIVE_INFINITY
  let sum = 0
  for (const [i, value] of a.entries()) sum += Math.abs(value - b[i])
  return sum / a.length
}

/**
 * The largest single step across the batch, measured from the last batch we
 * actually looked at. Chaining from there rather than from the batch's own
 * first frame means a slow drift still eventually trips the threshold instead
 * of creeping past it one imperceptible batch at a time.
 */
function movementOf(signatures: Uint8Array[], since: Uint8Array | null): number {
  // Nothing to compare against: either this is the first batch — still the
  // first thing we know about the session — or the caller supplied no
  // signatures, in which case we have no grounds to skip anything.
  if (!since || signatures.length === 0) return Number.POSITIVE_INFINITY
  const chain = [since, ...signatures]
  let most = 0
  for (let i = 1; i < chain.length; i++) most = Math.max(most, drift(chain[i - 1], chain[i]))
  return most
}

export function ageIn(units: string, now: number): number {
  const at = Date.parse(units)
  return Number.isNaN(at) ? 0 : Math.max(0, (now - at) / AGE_UNIT_MS)
}

/**
 * The closest propositions, discounted by how stale each one expects to be. A
 * durable observation stays retrievable for weeks; "is aligning a row of cards"
 * drops out of contention within a day, so tomorrow's candidate is compared
 * against what actually persists rather than against yesterday's noise.
 */
function retrieve(embedding: number[], propositions: Proposition[], now: number): Proposition[] {
  return propositions
    .map((proposition) => ({
      proposition,
      score:
        cosine(embedding, proposition.embedding) *
        Math.exp(-proposition.decay * DECAY_K * ageIn(proposition.updatedAt, now))
    }))
    .filter((scored) => scored.score >= SIMILARITY_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K)
    .map((scored) => scored.proposition)
}

// ---------------------------------------------------------------- pipeline

export function createUserModel(options: UserModelOptions): UserModel {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const { deps } = options

  let propositions: Proposition[] = []
  let buffer: Blob[] = []
  let signatures: Uint8Array[] = []
  let notes: string[] = []
  /** The last frame we actually spent a model call on. */
  let lastLooked: Uint8Array | null = null
  /** One batch at a time: revisions mutate the same set, so they cannot race. */
  let running = false

  function stage(next: PipelineStage): void {
    options.onStage?.(next)
  }

  function apply(ops: ReviseOp[], now: string): Proposition[] {
    const touched: Proposition[] = []
    for (const op of ops) {
      const existing = op.id === null ? undefined : propositions.find((p) => p.id === op.id)
      if (existing) {
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
          createdAt: now,
          updatedAt: now,
          observations: 1,
          embedding: [],
          originalText: op.text,
          originalEmbedding: [],
          revisions: 0
        }
        propositions.push(created)
        touched.push(created)
      }
    }
    return touched
  }

  async function run(frames: Blob[], context: string[]): Promise<void> {
    running = true
    try {
      stage('proposing')
      const candidates = readCandidates(
        await deps.propose({
          system: PROPOSE_SYSTEM,
          images: frames,
          instruction: PROPOSE_INSTRUCTION,
          context
        })
      )
      if (candidates.length === 0) return

      stage('revising')
      const embeddings = await deps.embed(candidates.map((c) => c.text))
      const now = Date.now()
      const stamp = new Date(now).toISOString()
      const changed: Proposition[] = []

      // Sequential: each revision changes what the next one retrieves, and two
      // candidates from the same batch are often about the same thing.
      for (const [i, candidate] of candidates.entries()) {
        const neighbours = retrieve(embeddings[i] ?? [], propositions, now)
        const raw = await deps.revise({
          system: REVISE_SYSTEM,
          prompt: reviseUserPrompt(
            candidate,
            neighbours.map((n) => ({
              id: n.id,
              text: n.text,
              confidence: n.confidence,
              decay: n.decay,
              ageDays: ageIn(n.updatedAt, now),
              revisions: n.revisions,
              originalText: n.originalText,
              // How much of the first wording survives. Measured here, judged
              // by the model — the code offers the number, not a veto.
              likeToOriginal: cosine(n.embedding, n.originalEmbedding)
            }))
          )
        })
        changed.push(...apply(readOps(raw), stamp))
      }

      // Only what was rewritten needs a new vector, and it goes in one request.
      if (changed.length > 0) {
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

    load(saved) {
      // A file written before drift was tracked has no original to compare
      // against; treat whatever it says now as where it started, so the note
      // reads "never rewritten" rather than "unrecognisably changed".
      propositions = saved.map((p) => ({
        ...p,
        originalText: p.originalText || p.text,
        originalEmbedding: p.originalEmbedding?.length ? p.originalEmbedding : p.embedding,
        revisions: p.revisions ?? 0
      }))
    },

    clear() {
      propositions = []
      buffer = []
      signatures = []
      notes = []
      lastLooked = null
    },

    addFrame(frame, meta) {
      buffer.push(frame)
      if (meta?.signature) signatures.push(meta.signature)
      if (meta?.note) notes.push(meta.note)
      if (buffer.length < batchSize) return
      if (running) {
        // Drop the oldest instead of queueing: falling behind should cost
        // history, not memory, and the recent frames are the relevant ones.
        buffer = buffer.slice(-batchSize)
        signatures = signatures.slice(-batchSize)
        notes = notes.slice(-batchSize)
        return
      }

      const batch = buffer
      const batchSignatures = signatures
      // The same note repeats across a batch — the agent does not start and
      // stop between frames — so it is the distinct ones that carry meaning.
      const batchNotes = [...new Set(notes)]
      buffer = []
      signatures = []
      notes = []

      // A partly-signed batch is not evidence of stillness — the frames we
      // cannot see might be the ones that moved.
      const movement =
        batchSignatures.length === batch.length
          ? movementOf(batchSignatures, lastLooked)
          : Number.POSITIVE_INFINITY
      if (movement < IDLE_MOVEMENT) {
        // Deliberately does not advance `lastLooked`: the comparison stays
        // anchored to the last frame we reasoned about.
        options.onIdle?.(movement)
        return
      }
      lastLooked = batchSignatures.at(-1) ?? lastLooked
      void run(batch, batchNotes)
    }
  }
}
