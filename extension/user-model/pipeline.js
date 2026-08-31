/**
 * Ported from src/app/user-model/pipeline.ts, algorithm unchanged.
 *
 * A general user model from screen captures, after Shaikh et al.
 * (arXiv:2505.10831). Per batch: PROPOSE, EMBED, RETRIEVE by cosine weighted by
 * staleness, then REVISE each candidate against its whole neighbourhood at once
 * rather than pairwise. Self-contained: no app imports and no provider SDK.
 *
 * `observeFeedback`/`observe` are carried over for fidelity with the source but
 * are not called from this extension yet — there is no meta-agent here to
 * produce Interactive Feedback Notes.
 */

import {
  feedbackSystem,
  feedbackUserPrompt,
  proposeSystem,
  rationaleSystem,
  rationaleUserPrompt,
  reviseSystem,
  reviseUserPrompt
} from './prompt.js'

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
function parseJsonArray(raw) {
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)```/.exec(raw)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start === -1 || end < start) return []
  const parsed = JSON.parse(body.slice(start, end + 1))
  return Array.isArray(parsed) ? parsed : []
}

function isRawReplyItem(item) {
  return typeof item === 'object' && item !== null
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 1–10 as asked for, mapped to 0–1 so that 1/10 lands on zero — the paper's
 * retired-but-retained state — and 10/10 on full belief. */
function readScore(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, (n - 1) / 9))
}

function readRequestedRationales(raw, feedback) {
  const explicitFeedback = feedback.notes.flatMap((note) =>
    note.feedbackItems.map((item) => item.feedback)
  )
  const accepted = []
  const rejected = []
  for (const [index, item] of parseJsonArray(raw).entries()) {
    if (typeof item !== 'object' || item === null) {
      rejected.push(`entry ${index + 1}: not an object`)
      continue
    }
    const row = item
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
    if (!explicitFeedback.some((text) => text.includes(purposeEvidenceQuote))) {
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

function readCandidatePropositions(raw) {
  return parseJsonArray(raw)
    .map((item) => {
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
    .filter((c) => c !== null)
}

const FEEDBACK_CLAIM_RELATIONS = new Set([
  'confirmation',
  'same_claim_refinement',
  'contextual_exception',
  'contradiction',
  'new_claim'
])

function readRequestedRevisions(raw) {
  return parseJsonArray(raw)
    .map((item) => {
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
        relation: FEEDBACK_CLAIM_RELATIONS.has(readString(item.relation))
          ? readString(item.relation)
          : undefined
      }
    })
    .filter((op) => op !== null)
}

function validFeedbackRevision(revision, propositions) {
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

export function cosine(a, b) {
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
function meanPixelDifference(earlier, later) {
  if (earlier.length === 0 || earlier.length !== later.length) return Number.POSITIVE_INFINITY
  let sum = 0
  for (const [i, value] of earlier.entries()) sum += Math.abs(value - later[i])
  return sum / earlier.length
}

/** Measured from the last batch we actually looked at, so a slow creep trips the
 * threshold instead of slipping past one imperceptible batch at a time. */
function largestFrameChange(thumbnails, sinceThumbnail) {
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
export function ageInDecayUnits(isoTimestamp, now) {
  const at = Date.parse(isoTimestamp)
  return Number.isNaN(at) ? 0 : Math.max(0, (now - at) / AGE_UNIT_MS)
}

/** Every proposition scored, best first, nothing dropped — the raw cosine and
 * the staleness-discounted score both kept so a trace can show how far below
 * (or above) the floor each pair landed. */
function allPropositionScores(embedding, propositions, now) {
  return propositions
    .map((proposition) => {
      const cosineSimilarity = cosine(embedding, proposition.embedding)
      return {
        proposition,
        cosineSimilarity,
        score:
          cosineSimilarity *
          Math.exp(-proposition.decay * DECAY_K * ageInDecayUnits(proposition.updatedAt, now))
      }
    })
    .sort((a, b) => b.score - a.score)
}

/** Discounted by how stale each expects to be, so tomorrow's candidate is
 * compared against what persists rather than against yesterday's noise. */
function nearestPropositionScores(embedding, propositions, now) {
  return allPropositionScores(embedding, propositions, now)
    .filter((scored) => scored.score >= SIMILARITY_FLOOR)
    .slice(0, MAX_NEIGHBOURS)
}

// ---------------------------------------------------------------- pipeline

export function createUserModel(options) {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const { deps } = options
  /** Which language the model calls write in — fixed for the model's lifetime
   * so one model never mixes languages (that breaks embedding retrieval). */
  const language = options.language ?? 'english'

  let propositions = []
  let buffer = []
  let thumbnails = []
  let notes = []
  /** Thumbnail of the last frame we actually spent a model call on. */
  let lastFrameReasonedAbout = null
  /** One batch at a time: revisions mutate the same set, so they cannot race. */
  let running = false
  let frameRun = null

  function stage(next) {
    options.onStage?.(next)
  }

  function applyRevisions(revisions, now) {
    const touched = []
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
        const created = {
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

  function applyRationales(asked, now) {
    const known = new Map(propositions.map((p) => [p.id, p]))
    const touched = []
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
  function describeChange(proposition) {
    return {
      text: proposition.text,
      confidence: proposition.confidence,
      reasoning: proposition.reasoning,
      wasNew: proposition.observations === 1
    }
  }

  function describe(proposition, now) {
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
  async function reEmbed(changed) {
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
  async function revise(candidates) {
    options.onCandidates?.(candidates)
    stage('revising')
    const embeddings = await deps.embed(candidates.map((c) => c.text))
    const now = Date.now()
    const stamp = new Date(now).toISOString()
    const changed = []

    // Sequential: each revision changes what the next one retrieves.
    for (const [i, candidate] of candidates.entries()) {
      const scored = allPropositionScores(embeddings[i] ?? [], propositions, now)
      const neighbours = scored
        .filter((entry) => entry.score >= SIMILARITY_FLOOR)
        .slice(0, MAX_NEIGHBOURS)
        .map((entry) => entry.proposition)
      options.onRetrieval?.({
        candidate: { text: candidate.text, confidence: candidate.confidence },
        floor: SIMILARITY_FLOOR,
        scored: scored.map((entry) => ({
          id: entry.proposition.id,
          text: entry.proposition.text,
          cosineSimilarity: entry.cosineSimilarity,
          score: entry.score,
          retrieved: neighbours.includes(entry.proposition)
        }))
      })
      const raw = await deps.revise({
        system: reviseSystem(language),
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

  async function run(frames, context) {
    running = true
    try {
      stage('proposing')
      const candidates = readCandidatePropositions(
        await deps.propose({
          system: proposeSystem(language),
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

  /** One call, no propose step. Directly cited propositions establish why a
   * note was created, while embedding neighbours expose adjacent claims that
   * may also need refinement and prevent near-duplicate creation. Not called
   * from this extension yet — there is no meta-agent here to produce the
   * Interactive Feedback Notes this expects. Carried over for fidelity. */
  async function observeFeedback(batch) {
    if (batch.notes.length === 0) return
    // Direct user evidence must not disappear because a timer-driven frame
    // batch happened to start first.
    if (frameRun) await frameRun
    if (running) return
    running = true
    try {
      stage('revising')
      const now = Date.now()
      const shown = new Map()
      const retrievalNotes = batch.notes.map((note) => ({
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

      const raw = await deps.revise({
        system: feedbackSystem(language),
        purpose: 'revise-from-feedback',
        prompt: feedbackUserPrompt(
          batch,
          [...shown.values()].map((p) => describe(p, now))
        )
      })
      const stamp = new Date(now).toISOString()
      // Explicit feedback may refine the scope or conditions of an existing
      // proposition. FEEDBACK_SYSTEM keeps implicit acceptance and mere
      // paraphrases from rewriting it.
      const asked = readRequestedRevisions(raw).filter((revision) =>
        validFeedbackRevision(revision, propositions)
      )
      const changed = applyRevisions(asked, stamp)
      if (changed.length > 0) await reEmbed(changed)

      // A second call: the why is answered better knowing the what, and it is
      // written across the whole model, which the first call must not see.
      stage('reasoning')
      const rawRationales = await deps.revise({
        system: rationaleSystem(language),
        purpose: 'revise-from-feedback',
        prompt: rationaleUserPrompt(batch, changed.map(describeChange), propositions)
      })
      const rationaleResult = readRequestedRationales(rawRationales, batch)
      for (const reason of rationaleResult.rejected) options.onRationaleDropped?.(reason)
      const rationales = applyRationales(rationaleResult.accepted, stamp)

      // `reEmbed` is what normally saves, and a rationale changes no wording.
      if (rationales.length > 0) options.onChange([...propositions])
    } catch (error) {
      options.onError?.(error)
    } finally {
      running = false
      stage('idle')
    }
  }

  /** Legacy shape, carried over for fidelity. Not called from this extension. */
  async function observe(notes) {
    const batch = {
      step: null,
      notes: notes.map((note, index) => ({
        noteId: `legacy-${index + 1}`,
        chunk: 0,
        topic: 'legacy-marker-feedback',
        cue: note.note,
        representationGoal: '',
        relationship: note.relation === 'unknown' ? 'uncovered' : note.relation,
        reasoningEvidence: note.quote,
        propositionIds: note.citedId === null ? [] : [note.citedId],
        resolution: note.reply === null ? 'implicitly-accepted' : 'explicit-feedback',
        feedbackItems:
          note.reply === null
            ? []
            : [
                {
                  id: `legacy-${index + 1}-reply`,
                  selection: { type: 'none' },
                  feedback: note.reply,
                  createdAt: Date.now()
                }
              ]
      }))
    }
    await observeFeedback(batch)
  }

  return {
    get propositions() {
      return propositions
    },

    observe,
    observeFeedback,

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
      notes = []
      lastFrameReasonedAbout = null
    },

    addFrame(frame, meta) {
      buffer.push(frame)
      if (meta?.greyscaleThumbnail) thumbnails.push(meta.greyscaleThumbnail)
      if (meta?.note) notes.push(meta.note)
      if (buffer.length < batchSize) return
      if (running) {
        // Falling behind should cost history, not memory.
        buffer = buffer.slice(-batchSize)
        thumbnails = thumbnails.slice(-batchSize)
        notes = notes.slice(-batchSize)
        return
      }

      const batch = buffer
      const batchThumbnails = thumbnails
      // The same note repeats across a batch, so only distinct ones carry meaning.
      const batchNotes = [...new Set(notes)]
      buffer = []
      thumbnails = []
      notes = []

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
      const task = run(batch, batchNotes)
      frameRun = task
      void task.finally(() => {
        if (frameRun === task) frameRun = null
      })
    }
  }
}
