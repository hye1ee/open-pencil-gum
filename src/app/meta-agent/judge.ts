/**
 * The meta-agent: it reads the working agent's thinking as it arrives and says
 * where that thinking runs against what we know about the person whose canvas
 * it is.
 *
 * One call per chunk of reasoning, with two ordinary model tools available:
 * generate_mark and update_mark. There is deliberately no tool loop: chunks
 * land about every second, and a multi-round loop would spend the run answering
 * questions about thinking the working agent had already left.
 *
 * It answers in actions — generate, update — against marks that persist between
 * calls. The first version restated its whole judgment every time, which failed
 * in both directions at once: the agent states a decision in words exactly once
 * and then executes it silently for three more steps, so a mark that had to be
 * re-earned from the current sentence could not survive, and a mark that was
 * carried was carried without any text to justify it and froze into a copy of the
 * last answer. Persisting the mark and travelling its evidence with it is what
 * fixes both — the sentence that justified it comes along.
 *
 * There is no delete, and that is load-bearing rather than an omission — see
 * `tools.ts`. The one way a mark ends is `retireWarnings`, which the caller
 * fires when a change the mark warned about has been carried out and the person
 * did not answer the mark to stop it.
 *
 * No app imports and no provider SDK: the caller supplies `judge`, and
 * `prompt.ts` holds everything that knows this is a design tool.
 */

export interface Proposition {
  id: string
  text: string
  confidence: number
}

export interface MarkEvidence {
  /**
   * The proposition this rests on, or null when the agent is deciding something
   * we hold no belief about. Null is not a weaker version of a mismatch — it is
   * a different statement ("nothing we know covers this"), and it is shown and
   * retired differently.
   */
  fromUserModel: string | null
  /** The words in the thinking it rests on, quoted rather than summarised. */
  fromReasoning: string
}

export interface MarkNote {
  /** One line: what the agent is reaching for, and what this person does. */
  text: string
  evidence: MarkEvidence
}

export type MarkRelation = 'conflict' | 'unknown'

export interface Mark {
  id: string
  nodeId: string | null
  /** Conflict with a proposition, or a decision our user model does not cover. */
  relation: MarkRelation
  /**
   * Oldest first. An update appends rather than overwrites, so the earlier
   * wording travels forward with the newer one — the model can see how it has
   * already put this, and the hover card can show that it moved.
   */
  notes: MarkNote[]
  /** 1–10, the model's own call on how much this matters. */
  importance: number
}

/** Only an actual conflict is a warning. Merely citing a proposition is not. */
export function isWarning(mark: Mark): boolean {
  return mark.relation === 'conflict'
}

export type MarkAction =
  | {
      type: 'generate'
      nodeId: string | null
      relation: MarkRelation
      note: MarkNote
      importance: number
    }
  | {
      type: 'update'
      id: string
      nodeId?: string | null
      relation: MarkRelation
      note: MarkNote
      importance: number
    }

export interface MarkToolCall {
  toolName: 'generate_mark' | 'update_mark'
  input: unknown
}

export type AppliedMarkTool =
  | {
      toolName: 'generate_mark'
      id: string
      nodeId: string | null
      relation: MarkRelation
      importance: number
    }
  | {
      toolName: 'update_mark'
      id: string
      nodeId: string | null
      relation: MarkRelation
      importance: number
      revived: boolean
    }

/** A note the person answered, and what they said. */
export interface SettledNote {
  note: string
  reply: string
}

export interface JudgeInput {
  /** What the person asked for, in their words. Outranks the model. */
  request: string
  propositions: Proposition[]
  /** The canvas as text, with ids, so a mark can name a node. */
  canvas: string
  /** Everything the agent has thought this step, oldest first. */
  reasoning: string
  /** Mutating calls made so far this run. */
  actions: string[]
  /** The marks standing right now, with their evidence. */
  marks: Mark[]
  /**
   * Notes the person already answered earlier in this build, in their words.
   *
   * Survives the turn being restarted, which is what happens when they answer
   * one. Without it the redone step gets marked all over again for the thing
   * they just spoke to — the loudest possible way of showing you were not
   * listening.
   */
  settled: SettledNote[]
  /**
   * Warnings whose tool call has already landed and stood. Off the canvas, kept
   * here so a recurring concern updates and revives the same mark instead of
   * creating a duplicate with a new id.
   */
  retired: Mark[]
}

export interface MetaAgentDeps {
  judge(input: { system: string; prompt: string }): Promise<MarkToolCall[]>
  /** Renders `JudgeInput` into the user turn. Lives in the domain pack. */
  render(input: JudgeInput): string
  system: string
}

export interface MetaAgentOptions {
  deps: MetaAgentDeps
  /**
   * The standing marks changed. `from` is the input the actions were read from,
   * or null when they changed without anyone being asked — a turn starting, a
   * warning retiring. A caller that logs has to tell those apart.
   */
  onChanged(marks: Mark[], from: JudgeInput | null): void
  onTools?(tools: AppliedMarkTool[], input: JudgeInput): void
  onRejectedTools?(tools: MarkToolCall[], input: JudgeInput): void
  onLifecycle?(event: string, marks: Mark[]): void
  onError?(error: unknown): void
  onSkipped?(reason: 'busy' | 'no-model', input: ConsiderInput): void
}

export type ConsiderInput = Omit<JudgeInput, 'marks' | 'retired'>

export interface MetaAgent {
  /** A new turn: nothing carries over, not even what was retired. */
  beginTurn(): void
  /**
   * A fresh block of thinking. Marks survive it — a new step is the next part
   * of the same plan, not a new mind. What does not survive is a chunk still
   * queued from the block that just ended: judged now it would answer the new
   * thinking with the old text.
   */
  beginStep(): void
  /**
   * A chunk of reasoning arrived. `reasoning` is everything so far in this
   * block, not the chunk — the answer is about where the thought has got to.
   */
  consider(input: ConsiderInput): void
  /**
   * The change the standing warnings were about has landed and the person did
   * not stop it. They come off the canvas and become memory. Marks resting on
   * nothing we believe stay: they are questions about the result, and the
   * result is what makes them answerable.
   */
  retireWarnings(nodeIds: readonly string[]): void
  /** A replace tool preserved the design role but assigned the node a new id. */
  remapNode(oldId: string, newId: string): void
  readonly marks: Mark[]
  /**
   * Resolves once nothing is in flight and nothing is queued.
   *
   * The caller is the stream tap, which holds the agent's tool call until the
   * marks about the thinking that led to it are on screen. Without it the two
   * race: an answer takes about four seconds and the beats before a tool call
   * add up to less, so the change can land before the mark warning about it
   * appears, and a mark that arrives after the fact is a different thing from
   * a mark that arrives before.
   */
  settled(): Promise<void>
  /**
   * The marks the person could have answered: standing, plus those that retired
   * because the change they warned about landed and was not stopped.
   *
   * Not the ones this agent deleted. Letting a mark alone is agreement, but
   * only if it was there to be left alone — a mark withdrawn after three
   * seconds was never the person's to accept, and reporting it as accepted
   * builds agreement out of something they may never have seen.
   */
  readonly answerable: Mark[]
}

/** Beyond a few, questions about the design stop being a prompt and become
 * wallpaper. The model has to drop one to raise another. */
const MAX_OPEN_QUESTIONS = 3

/**
 * Tool schemas reject malformed provider output before it gets here. These
 * checks enforce the invariants schemas cannot: quoted evidence must really be
 * in this reasoning, proposition ids must exist, and update/delete ids must
 * name state the meta-agent actually owns.
 */
interface RawMarkInput {
  id?: unknown
  node_id?: unknown
  relation?: unknown
  text?: unknown
  evidence_from_reasoning?: unknown
  evidence_from_user_model?: unknown
  importance?: unknown
}

function asRawMarkInput(value: unknown): RawMarkInput | null {
  return typeof value === 'object' && value !== null ? (value as RawMarkInput) : null
}

function clampImportance(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 1
  return Math.min(10, Math.max(1, Math.round(n)))
}

/** Whitespace-insensitive, because the model retypes a quote rather than
 * slicing it and a line break lands wherever the summary happened to wrap. */
function flatten(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Two bounds on how much of the thinking a mark may cite.
 *
 * Checking that the quote is really in the thinking is the only thing standing
 * between "the agent said this" and the model's own opinion, and it is worth
 * nothing against a quote that is the whole paragraph: a paragraph is trivially
 * present, so it passes whatever the note claims about it. One measured run had a
 * mark citing 258 of the 320 characters the agent had thought, and the note
 * described something those 320 characters never mentioned.
 *
 * Both bounds, because either alone has a hole — a long block of thinking makes
 * any absolute cap generous, a short one makes any ratio generous.
 */
const MAX_QUOTE_CHARS = 200
const MAX_QUOTE_SHARE = 0.5

/** In the thinking, and narrow enough to point at something in it. */
function readQuote(row: RawMarkInput, haystack: string): string | null {
  const quote = typeof row.evidence_from_reasoning === 'string' ? row.evidence_from_reasoning : ''
  if (quote === '') return null
  const flat = flatten(quote)
  if (!haystack.includes(flat)) return null
  if (flat.length > MAX_QUOTE_CHARS || flat.length > haystack.length * MAX_QUOTE_SHARE) return null
  return quote
}

/**
 * A cited proposition has to exist. A note naming one we do not have is the
 * model reaching for a reason after the fact — and since a note may legitimately
 * name none at all, this is the only place that distinction can be enforced.
 */
function readRelation(row: RawMarkInput, known: Set<string>): MarkRelation | null {
  if (row.relation === 'unknown') {
    const cited = row.evidence_from_user_model
    return cited === null || cited === undefined || cited === '' ? 'unknown' : null
  }
  if (row.relation !== 'conflict') return null
  const cited = row.evidence_from_user_model
  return typeof cited === 'string' && cited !== '' && known.has(cited) ? 'conflict' : null
}

function readNote(row: RawMarkInput, relation: MarkRelation, quote: string): MarkNote | null {
  if (typeof row.text !== 'string' || row.text.trim() === '') return null
  const cited = row.evidence_from_user_model
  const fromUserModel = relation === 'conflict' && typeof cited === 'string' ? cited : null
  return { text: row.text, evidence: { fromUserModel, fromReasoning: quote } }
}

/** An id only means anything if it names a live or retired mark we own. */
function readId(row: RawMarkInput, knownIds: Set<string>): string | null {
  return typeof row.id === 'string' && knownIds.has(row.id) ? row.id : null
}

function readAction(
  call: MarkToolCall,
  known: Set<string>,
  haystack: string,
  markIds: Set<string>
): MarkAction | null {
  const row = asRawMarkInput(call.input)
  if (!row) return null
  const quote = readQuote(row, haystack)
  if (quote === null) return null

  const relation = readRelation(row, known)
  if (!relation) return null
  const note = readNote(row, relation, quote)
  if (!note) return null
  const importance = clampImportance(row.importance)

  if (call.toolName === 'update_mark') {
    const id = readId(row, markIds)
    if (id === null) return null
    let nodeId: string | null | undefined
    if (row.node_id !== undefined) {
      nodeId = typeof row.node_id === 'string' && row.node_id !== '' ? row.node_id : null
    }
    return { type: 'update', id, nodeId, relation, note, importance }
  }
  const nodeId = typeof row.node_id === 'string' && row.node_id !== '' ? row.node_id : null
  return { type: 'generate', nodeId, relation, note, importance }
}

function readActions(
  calls: MarkToolCall[],
  known: Set<string>,
  reasoning: string,
  markIds: Set<string>
): { actions: MarkAction[]; rejected: MarkToolCall[] } {
  const haystack = flatten(reasoning)
  const actions: MarkAction[] = []
  const rejected: MarkToolCall[] = []
  for (const call of calls) {
    const action = readAction(call, known, haystack, markIds)
    if (action) actions.push(action)
    else rejected.push(call)
  }
  return { actions, rejected }
}

export function createMetaAgent(options: MetaAgentOptions): MetaAgent {
  const { deps } = options
  /** On the canvas. */
  let marks: Mark[] = []
  /** Warned, landed, stood. Available for update, revival, or deletion. */
  let retired: Mark[] = []
  let nextId = 1
  let busy = false
  /** Arrived while an answer was in flight; run once that one lands. */
  let pending: ConsiderInput | null = null
  /** Woken when `busy` clears with nothing queued behind it. */
  let settlers: Array<() => void> = []

  function wakeSettlers(): void {
    if (busy || pending) return
    const waiting = settlers
    settlers = []
    for (const resolve of waiting) resolve()
  }

  /** Ours, not the model's: an id it invents collides or changes shape between
   * calls, and every update and delete is aimed by it. */
  function mint(): string {
    return `m${nextId++}`
  }

  /**
   * Keeps the highest-importance few of the marks that rest on nothing we
   * believe. A backstop under the prompt rule, not a replacement for it: the
   * model is told to drop one itself, and dropping by importance here at least
   * loses the least useful question rather than the oldest.
   */
  function capOpenQuestions(): void {
    const questions = marks.filter((mark) => mark.relation === 'unknown')
    if (questions.length <= MAX_OPEN_QUESTIONS) return
    const keep = new Set(
      [...questions]
        .sort((a, b) => b.importance - a.importance)
        .slice(0, MAX_OPEN_QUESTIONS)
        .map((mark) => mark.id)
    )
    marks = marks.filter((mark) => mark.relation === 'conflict' || keep.has(mark.id))
  }

  function apply(actions: MarkAction[]): AppliedMarkTool[] {
    const applied: AppliedMarkTool[] = []
    for (const action of actions) {
      if (action.type === 'generate') {
        const id = mint()
        const mark: Mark = {
          id,
          nodeId: action.nodeId,
          relation: action.relation,
          notes: [action.note],
          importance: action.importance
        }
        marks.push(mark)
        applied.push({
          toolName: 'generate_mark',
          id,
          nodeId: action.nodeId,
          relation: action.relation,
          importance: action.importance
        })
        continue
      }
      let mark = marks.find((candidate) => candidate.id === action.id)
      const retiredIndex = retired.findIndex((candidate) => candidate.id === action.id)
      const wasRetired = !mark && retiredIndex !== -1
      if (!mark && retiredIndex !== -1) mark = retired[retiredIndex]
      if (!mark) continue
      if (wasRetired) {
        retired = retired.filter((candidate) => candidate.id !== action.id)
        marks.push(mark)
      }
      if (action.nodeId !== undefined) mark.nodeId = action.nodeId
      mark.relation = action.relation
      mark.notes.push(action.note)
      mark.importance = action.importance
      applied.push({
        toolName: 'update_mark',
        id: action.id,
        nodeId: mark.nodeId,
        relation: mark.relation,
        importance: mark.importance,
        revived: wasRetired
      })
    }
    capOpenQuestions()
    return applied
  }

  async function run(input: ConsiderInput): Promise<void> {
    const known = new Set(input.propositions.map((p) => p.id))
    const full: JudgeInput = { ...input, marks, retired }
    const calls = await deps.judge({ system: deps.system, prompt: deps.render(full) })
    const markIds = new Set([...marks, ...retired].map((mark) => mark.id))
    const { actions, rejected } = readActions(calls, known, input.reasoning, markIds)
    if (rejected.length > 0) options.onRejectedTools?.(rejected, full)
    const applied = apply(actions)
    if (applied.length > 0) options.onTools?.(applied, full)
    options.onChanged(marks, full)
  }

  function start(input: ConsiderInput): void {
    busy = true
    run(input)
      .catch((error: unknown) => {
        options.onError?.(error)
      })
      .finally(() => {
        busy = false
        // Whatever arrived while that was running, answered now on the fullest
        // text there is — this is what guarantees the last word gets read.
        const next = pending
        pending = null
        if (next) start(next)
        else wakeSettlers()
      })
  }

  return {
    settled() {
      if (!busy && !pending) return Promise.resolve()
      return new Promise((resolve) => {
        settlers.push(resolve)
      })
    },

    get answerable() {
      return [...marks, ...retired]
    },

    beginTurn() {
      const hadState = marks.length > 0 || retired.length > 0
      retired = []
      pending = null
      marks = []
      if (hadState) {
        options.onLifecycle?.('turn reset', marks)
        options.onChanged(marks, null)
      }
    },

    beginStep() {
      pending = null
      // Dropping the queued chunk can be the thing that leaves nothing in
      // flight, and a waiter that is not woken here holds the run for good.
      wakeSettlers()
    },

    consider(input) {
      // Nothing to compare against: every call would be the model inventing a
      // reason to speak.
      if (input.propositions.length === 0) return

      // One answer at a time — two in flight would race over the marks. But
      // dropping the chunk was wrong: a block arrives in one or two chunks and
      // an answer takes about as long as the gap between them, so the second
      // chunk was landing mid-call and being thrown away, and the finished
      // thought was never read. `reasoning` is cumulative, so holding only the
      // newest loses nothing.
      if (busy) {
        pending = input
        options.onSkipped?.('busy', input)
        return
      }
      start(input)
    },

    retireWarnings(nodeIds) {
      const targets = new Set(nodeIds)
      const warnings = marks.filter(
        (mark) => isWarning(mark) && mark.nodeId !== null && targets.has(mark.nodeId)
      )
      if (warnings.length === 0) return
      retired = [...retired, ...warnings]
      const retiredIds = new Set(warnings.map((mark) => mark.id))
      marks = marks.filter((mark) => !retiredIds.has(mark.id))
      options.onLifecycle?.(`retired ${warnings.map((mark) => mark.id).join(', ')}`, marks)
      options.onChanged(marks, null)
    },

    remapNode(oldId, newId) {
      let changed = false
      for (const mark of [...marks, ...retired]) {
        if (mark.nodeId !== oldId) continue
        mark.nodeId = newId
        changed = true
      }
      if (!changed) return
      options.onLifecycle?.(`remapped ${oldId} → ${newId}`, marks)
      options.onChanged(marks, null)
    },

    get marks() {
      return marks
    }
  }
}
