/**
 * Reads the working agent's thinking as it arrives and marks where it runs
 * against what we know about the person. One call per chunk, no tool loop, and
 * marks persist between calls carrying the sentence that justified them. There
 * is no delete — see `tools.ts`. No app imports and no provider SDK.
 */

export interface Proposition {
  id: string
  text: string
  confidence: number
  /** A conflict is easier to get right against the purpose than the wording,
   * which breaks on cases the purpose covers fine. */
  rationale: string | null
  /** Handed it and following it is the agent reading its instructions. Reaching
   * for it unhanded is the only evidence the belief describes the person. */
  shownToAgent: boolean
}

export interface MarkEvidence {
  /** Null when the agent is deciding something we hold no belief about — a
   * different statement from a mismatch, shown and retired differently. */
  fromUserModel: string | null
  /** The words in the thinking it rests on, quoted rather than summarised. */
  fromReasoning: string
}

export interface MarkNote {
  /** One line: what the agent is reaching for, and what this person does. */
  text: string
  evidence: MarkEvidence
}

export type MarkRelation = 'conflict' | 'alignment' | 'unknown'

/**
 * One signed scale: conflict and alignment are two halves of the same question,
 * how well a decision fits what we know. `unknown` sits at zero, meaning off the
 * scale rather than the middle of it. The model cannot take a mark back — one
 * leaves when its change lands and stands, or when the person dismisses it.
 */
export const MAX_RATING = 5

export interface Mark {
  id: string
  nodeId: string | null
  /** Against a proposition, with one, or about ground the model does not cover. */
  relation: MarkRelation
  /** Oldest first. An update appends, so the model can see how it already put
   * this and the hover card can show that it moved. */
  notes: MarkNote[]
  /** Only a mark naming no node needs it: every other one retires when a change
   * lands on its node, and this gives that one the same window. */
  raisedInStep: number
  /** −5…−1 conflict, +1…+5 alignment, 0 for unknown. Built from the strength and
   * the relation, never asked for signed — see `readRating`. */
  rating: number
}

/** Only an actual conflict is a warning. Merely citing a proposition is not. */
export function isWarning(mark: Mark): boolean {
  return mark.relation === 'conflict'
}

/** `+4`, `-3`, and nothing for an unknown: a printed zero reads as the weakest
 * rating rather than as no rating. */
export function signed(rating: number): string {
  if (rating === 0) return ''
  return rating > 0 ? `+${rating}` : String(rating)
}

export type MarkAction =
  | {
      type: 'generate'
      nodeId: string | null
      relation: MarkRelation
      note: MarkNote
      rating: number
    }
  | {
      type: 'update'
      id: string
      nodeId?: string | null
      relation: MarkRelation
      note: MarkNote
      rating: number
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
      rating: number
    }
  | {
      toolName: 'update_mark'
      id: string
      nodeId: string | null
      relation: MarkRelation
      rating: number
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
  /**
   * The written directive the agent is building to, or null before the first
   * planning call.
   *
   * Here so that "did the agent decide this or was it told to?" is a comparison
   * rather than a guess. Measured without it: the agent wrote "labels should
   * always be lowercase, as it appears to be a stylistic requirement", which is
   * it saying out loud that it was told — and the judgment came back as the
   * proposition about lowercase labels holding up, because nothing in this input
   * could show that the agent had been handed it. `propositions` is the same
   * problem and the prompt names it: the list below is in the agent's own
   * instructions, and it can read it.
   */
  plan: string | null
  propositions: Proposition[]
  /** The canvas as text, with ids, so a mark can name a node. */
  canvas: string
  /** Everything the agent has thought this step, oldest first. */
  reasoning: string
  /** The prefix already judged in this step, retained only to understand what
   * the newly arrived text refers to. */
  reasoningContext: string
  /** Everything appended since the last judgment that actually ran. */
  newReasoning: string
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
  /** Off the canvas, kept so a recurring concern revives the same mark instead
   * of creating a duplicate under a new id. */
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
  /** `from` is the input the actions were read from, or null when nobody was
   * asked — a turn starting, a mark retiring. A logger has to tell them apart. */
  onChanged(marks: Mark[], from: JudgeInput | null): void
  onTools?(tools: AppliedMarkTool[], input: JudgeInput): void
  onRejectedTools?(tools: MarkToolCall[], input: JudgeInput): void
  onLifecycle?(event: string, marks: Mark[]): void
  onError?(error: unknown): void
  onSkipped?(reason: 'busy' | 'no-model', input: ConsiderInput): void
}

export type ConsiderInput = Omit<
  JudgeInput,
  'marks' | 'retired' | 'reasoningContext' | 'newReasoning'
>

export interface MetaAgent {
  /** A new turn: nothing carries over, not even what was retired. */
  beginTurn(): void
  /** Marks survive a new step; a queued chunk from the old block does not, since
   * judging it now would answer the new thinking with the old text. */
  beginStep(): void
  /** `reasoning` is everything so far in this block, not the chunk: the answer
   * is about where the thought has got to. */
  consider(input: ConsiderInput): void
  /** The change landed unstopped, so those marks become memory. Unknowns stay:
   * the result is what makes a question about it answerable. */
  retireSettledMarks(nodeIds: readonly string[]): void
  /** Retires it for the reason a settled change does: shown, not objected to,
   * off the canvas. Filtering the canvas copy instead leaves the slot taken. */
  dismissMark(id: string): void
  /** A replace tool preserved the design role but assigned the node a new id. */
  remapNode(oldId: string, newId: string): void
  readonly marks: Mark[]
  /** The stream tap holds the tool call until the marks about it are on screen:
   * an answer takes ~4s and the beats before a call add up to less. */
  settled(): Promise<void>
  /** Standing plus retired. Letting a mark alone is agreement only if it was
   * there to be left alone, so nothing this agent dropped is counted. */
  readonly answerable: Mark[]
}

/** Beyond a few, questions about the design stop being a prompt and become
 * wallpaper. The model has to drop one to raise another. */
const MAX_OPEN_QUESTIONS = 3

/** Invariants a schema cannot enforce: the quote must really be in this
 * reasoning, and every cited id must name state we own. */
interface RawMarkInput {
  id?: unknown
  node_id?: unknown
  relation?: unknown
  text?: unknown
  evidence_from_reasoning?: unknown
  evidence_from_user_model?: unknown
  strength?: unknown
}

function asRawMarkInput(value: unknown): RawMarkInput | null {
  return typeof value === 'object' && value !== null ? (value as RawMarkInput) : null
}

/** The sign follows from the relation, never asked for: a signed number let the
 * two disagree. Missing strength is rejected rather than guessed at. */
function readRating(value: unknown, relation: MarkRelation): number | null {
  if (relation === 'unknown') return 0
  const raw = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(raw) || raw === 0) return null
  const strength = Math.min(MAX_RATING, Math.max(1, Math.round(Math.abs(raw))))
  return relation === 'conflict' ? -strength : strength
}

/** Whitespace-insensitive, because the model retypes a quote rather than
 * slicing it and a line break lands wherever the summary happened to wrap. */
function flatten(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim().toLowerCase()
}

/** A whole-paragraph quote is trivially present, so the in-the-text check passes
 * whatever the note claims. Both bounds: either alone has a hole. */
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

/** A note naming a proposition we do not have is the model reaching for a reason
 * after the fact, and a note may legitimately name none, so it is checked here. */
function readRelation(row: RawMarkInput, known: Set<string>): MarkRelation | null {
  if (row.relation === 'unknown') {
    const cited = row.evidence_from_user_model
    return cited === null || cited === undefined || cited === '' ? 'unknown' : null
  }
  // Both are claims about a particular belief, and one that cannot name the
  // belief is not a claim.
  if (row.relation !== 'conflict' && row.relation !== 'alignment') return null
  const cited = row.evidence_from_user_model
  return typeof cited === 'string' && cited !== '' && known.has(cited) ? row.relation : null
}

function readNote(row: RawMarkInput, relation: MarkRelation, quote: string): MarkNote | null {
  if (typeof row.text !== 'string' || row.text.trim() === '') return null
  const cited = row.evidence_from_user_model
  const fromUserModel = relation !== 'unknown' && typeof cited === 'string' ? cited : null
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
  const rating = readRating(row.strength, relation)
  if (rating === null) return null

  if (call.toolName === 'update_mark') {
    const id = readId(row, markIds)
    if (id === null) return null
    let nodeId: string | null | undefined
    if (row.node_id !== undefined) {
      nodeId = typeof row.node_id === 'string' && row.node_id !== '' ? row.node_id : null
    }
    return { type: 'update', id, nodeId, relation, note, rating }
  }
  const nodeId = typeof row.node_id === 'string' && row.node_id !== '' ? row.node_id : null
  return { type: 'generate', nodeId, relation, note, rating }
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
  /** Which step of the turn we are in, counted from `beginStep`. Only used to
   * give a warning that names no node a window of its own. */
  let step = 0
  let busy = false
  /** Full reasoning prefix consumed by the last judgment in this step. */
  let judgedReasoning = ''
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

  /** Ours, not the model's: an invented id collides or changes shape between
   * calls, and every update is aimed by it. */
  function mint(): string {
    return `m${nextId++}`
  }

  /** A backstop under the prompt rule, not a replacement. Newest wins: a question
   * about the sentence being thought now beats one the thinking left behind. */
  function capOpenQuestions(): void {
    const questions = marks.filter((mark) => mark.relation === 'unknown')
    if (questions.length <= MAX_OPEN_QUESTIONS) return
    const dropped = new Set(
      questions.slice(0, questions.length - MAX_OPEN_QUESTIONS).map((mark) => mark.id)
    )
    marks = marks.filter((mark) => !dropped.has(mark.id))
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
          raisedInStep: step,
          rating: action.rating
        }
        marks.push(mark)
        applied.push({
          toolName: 'generate_mark',
          id,
          nodeId: action.nodeId,
          relation: action.relation,
          rating: action.rating
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
        // Back on the canvas is back at the start, with the same reading window.
        mark.raisedInStep = step
        marks.push(mark)
      }
      if (action.nodeId !== undefined) mark.nodeId = action.nodeId
      mark.relation = action.relation
      // Only when the wording moved. Appending on a node or rating change puts
      // the same sentence in the card twice, once struck through.
      if (mark.notes.at(-1)?.text !== action.note.text) mark.notes.push(action.note)
      mark.rating = action.rating
      applied.push({
        toolName: 'update_mark',
        id: action.id,
        nodeId: mark.nodeId,
        relation: mark.relation,
        rating: mark.rating,
        revived: wasRetired
      })
    }
    capOpenQuestions()
    return applied
  }

  async function run(input: ConsiderInput): Promise<void> {
    const known = new Set(input.propositions.map((p) => p.id))
    const extendsJudged = input.reasoning.startsWith(judgedReasoning)
    const reasoningContext = extendsJudged ? judgedReasoning : ''
    const newReasoning = extendsJudged
      ? input.reasoning.slice(reasoningContext.length)
      : input.reasoning
    const full: JudgeInput = { ...input, reasoningContext, newReasoning, marks, retired }
    const calls = await deps.judge({ system: deps.system, prompt: deps.render(full) })
    judgedReasoning = input.reasoning
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
        // Whatever arrived while that ran, on the fullest text there is.
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
      step = 0
      pending = null
      judgedReasoning = ''
      marks = []
      if (hadState) {
        options.onLifecycle?.('turn reset', marks)
        options.onChanged(marks, null)
      }
    },

    beginStep() {
      step += 1
      pending = null
      judgedReasoning = ''
      // Dropping the queued chunk can leave nothing in flight, and an unwoken
      // waiter holds the run for good.
      wakeSettlers()
    },

    consider(input) {
      // Nothing to compare against: every call would be invented.
      if (input.propositions.length === 0) return

      // One at a time, but queued rather than dropped: an answer takes about as
      // long as the gap between chunks, so the finished thought was never read.
      if (busy) {
        pending = input
        options.onSkipped?.('busy', input)
        return
      }
      start(input)
    },

    retireSettledMarks(nodeIds) {
      const targets = new Set(nodeIds)
      const settledMarks = marks.filter((mark) => {
        // Both are claims about the change that just landed, and both have said
        // what they had to once it stands.
        if (mark.relation === 'unknown') return false
        // No node means no change can ever match it, so it would stay all build.
        // Its window is the step it was raised in plus the next change.
        if (mark.nodeId === null) return mark.raisedInStep < step
        return targets.has(mark.nodeId)
      })
      if (settledMarks.length === 0) return
      retired = [...retired, ...settledMarks]
      const retiredIds = new Set(settledMarks.map((mark) => mark.id))
      marks = marks.filter((mark) => !retiredIds.has(mark.id))
      options.onLifecycle?.(`retired ${settledMarks.map((mark) => mark.id).join(', ')}`, marks)
      options.onChanged(marks, null)
    },

    dismissMark(id) {
      const mark = marks.find((candidate) => candidate.id === id)
      if (!mark) return
      retired = [...retired, mark]
      marks = marks.filter((candidate) => candidate.id !== id)
      options.onLifecycle?.(`dismissed ${id}`, marks)
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
