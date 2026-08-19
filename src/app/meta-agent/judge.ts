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
  /** Whether a decision speaks to a belief is easier to see against its purpose
   * than its wording, which breaks on cases the purpose covers fine. */
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

/**
 * Where a decision should land between the agent's own reasoning and what we
 * believe about the person. Ordered, and the order is the only number there is:
 * nothing stores an index, so the scale can be renamed or resized here alone.
 *
 * The model never picks a step. It writes one instruction for each, and the
 * person chooses. A mark opens at `halfway`, and leaving it there is what
 * happens anyway — the agent carries out what it reasoned.
 */
export const SPECTRUM = [
  'as_reasoned',
  'mostly_reasoned',
  'halfway',
  'mostly_user_model',
  'as_user_model'
] as const
export type SpectrumStep = (typeof SPECTRUM)[number]
export type MarkFeedbackContents = Record<SpectrumStep, string>

export const OPENING_STEP: SpectrumStep = 'halfway'

export function isSpectrumStep(value: unknown): value is SpectrumStep {
  return typeof value === 'string' && SPECTRUM.includes(value as SpectrumStep)
}

export interface Mark {
  id: string
  /** Stable when feedback restarts the same decision under a new mark id. */
  lineageId: string
  nodeId: string | null
  /** Short, user-visible name for the decision this mark concerns. */
  topic: string
  /** Oldest first. An update appends, so the model can see how it already put
   * this and the hover card can show that it moved. */
  notes: MarkNote[]
  /** Only a mark naming no node needs it: every other one retires when a change
   * lands on its node, and this gives that one the same window. */
  raisedInStep: number
  /** Creation order inside the step. Updates keep the same timeline slot. */
  raisedOrder: number
  /** Latest generate/update event, used by the timeline without moving the original event. */
  changedInStep: number
  changedOrder: number
  /** Where the person has put it, `null` on a mark no proposition covers: with
   * one end of the scale missing there is nothing to slide between. */
  position: SpectrumStep | null
  feedbackContents?: MarkFeedbackContents | null
  suggestedFeedback?: string | null
}

/** No proposition covers the decision, so the mark carries one suggestion rather
 * than a scale. Having nowhere to sit on the scale is what says so — nothing
 * labels it. Read off `position` and not `feedbackContents`, because the
 * timeline keeps slimmed copies that drop the instructions but keep the seat. */
export function isUnrelated(mark: Mark): boolean {
  return mark.position === null
}

export type MarkAction =
  | {
      type: 'generate'
      nodeId: string | null
      topic: string
      note: MarkNote
      feedbackContents: MarkFeedbackContents | null
      suggestedFeedback: string | null
    }
  | {
      type: 'update'
      id: string
      nodeId?: string | null
      topic: string
      note: MarkNote
      feedbackContents: MarkFeedbackContents | null
      suggestedFeedback: string | null
    }

export type MarkToolName = 'generate_related_mark' | 'generate_unrelated_mark' | 'update_mark'

export interface MarkToolCall {
  toolName: MarkToolName
  input: unknown
}

export interface RejectedMarkTool {
  call: MarkToolCall
  reason: string
}

export interface AppliedMarkTool {
  toolName: MarkToolName
  id: string
  nodeId: string | null
  position: SpectrumStep | null
  /** Carried out for the run log: what the person is about to be offered is not
   * recoverable from anything else, and an update overwrites it in place. */
  feedbackContents: MarkFeedbackContents | null
  /** Only ever true on an update that brought a retired mark back. */
  revived?: boolean
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
   * asked — a turn starting, a mark retiring. A logger has to tell them apart.
   * `retired` rides along because a mark that has left the canvas is still shown,
   * faintly, where it stood. */
  onChanged(marks: Mark[], retired: Mark[], from: JudgeInput | null): void
  onTools?(tools: AppliedMarkTool[], input: JudgeInput): void
  onRejectedTools?(tools: RejectedMarkTool[], input: JudgeInput): void
  onLifecycle?(event: string, marks: Mark[]): void
  onError?(error: unknown): void
  onSkipped?(reason: 'busy' | 'no-model', input: ConsiderInput): void
}

export type ConsiderInput = Omit<JudgeInput, 'marks' | 'retired'>

export interface MetaAgent {
  /** A new turn: nothing carries over, not even what was retired. */
  beginTurn(): void
  /** Stop accepting judgments as soon as feedback is confirmed. */
  suspend(): void
  /** Marks survive a new step; a queued chunk from the old block does not, since
   * judging it now would answer the new thinking with the old text. */
  beginStep(step?: number): void
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
  /** A dragged mark belongs to the person until they cancel or submit it. */
  lockMark(id: string): void
  unlockMark(id: string): void
  readonly marks: Mark[]
  /** The stream tap holds the tool call until the marks about it are on screen:
   * an answer takes ~4s and the beats before a call add up to less. */
  settled(): Promise<void>
  /** Standing plus retired. Letting a mark alone is agreement only if it was
   * there to be left alone, so nothing this agent dropped is counted. */
  readonly answerable: Mark[]
  /** The latest complete context sent to the judge for the current step. */
  readonly currentInput: JudgeInput | null
}

const MAX_OPEN_QUESTIONS = 3

interface RawMarkInput {
  id?: unknown
  node_id?: unknown
  topic?: unknown
  text?: unknown
  evidence_from_reasoning?: unknown
  evidence_from_user_model?: unknown
  feedback_contents?: unknown
  suggested_feedback?: unknown
}

/** Which of the two a call is about. The generate tools say it by name; an
 * update says it by which of the two payloads it carries, so a decision that
 * grows a proposition can cross over without a second update tool. */
type MarkKind = 'related' | 'unrelated'

function readFeedbackContents(value: unknown): MarkFeedbackContents | null {
  if (typeof value !== 'object' || value === null) return null
  const result: Partial<MarkFeedbackContents> = {}
  const distinct = new Set<string>()
  for (const step of SPECTRUM) {
    const text = Reflect.get(value, step)
    if (typeof text !== 'string' || text.trim() === '') return null
    const trimmed = text.trim()
    result[step] = trimmed
    distinct.add(flatten(trimmed))
  }
  if (distinct.size !== SPECTRUM.length) return null
  return result as MarkFeedbackContents
}

function asRawMarkInput(value: unknown): RawMarkInput | null {
  return typeof value === 'object' && value !== null ? (value as RawMarkInput) : null
}

function readKind(call: MarkToolCall, row: RawMarkInput): MarkKind {
  if (call.toolName === 'generate_related_mark') return 'related'
  if (call.toolName === 'generate_unrelated_mark') return 'unrelated'
  return readFeedbackContents(row.feedback_contents) === null ? 'unrelated' : 'related'
}

function flatten(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim().toLowerCase()
}

/** A whole-paragraph quote is trivially present, so the in-the-text check passes
 * whatever the note claims. Both bounds: either alone has a hole. */
const MAX_QUOTE_CHARS = 200
const MAX_QUOTE_SHARE = 0.5

function readQuote(row: RawMarkInput, haystack: string): string | null {
  const quote = typeof row.evidence_from_reasoning === 'string' ? row.evidence_from_reasoning : ''
  if (quote === '') return null
  const flat = flatten(quote)
  if (!haystack.includes(flat)) return null
  if (flat.length > MAX_QUOTE_CHARS || flat.length > haystack.length * MAX_QUOTE_SHARE) return null
  return quote
}

function citedId(row: RawMarkInput, kind: MarkKind): string | null {
  const cited = row.evidence_from_user_model
  if (kind === 'unrelated' || typeof cited !== 'string' || cited === '') return null
  return cited
}

/** A related mark naming a proposition we do not have is the model reaching for
 * a reason after the fact; an unrelated one naming any is the wrong tool. */
function citedIsValid(row: RawMarkInput, known: Set<string>, kind: MarkKind): boolean {
  const cited = row.evidence_from_user_model
  if (kind === 'unrelated') return cited === null || cited === undefined || cited === ''
  return typeof cited === 'string' && known.has(cited)
}

function readNote(row: RawMarkInput, kind: MarkKind, quote: string): MarkNote | null {
  if (typeof row.text !== 'string' || row.text.trim() === '') return null
  return {
    text: row.text,
    evidence: { fromUserModel: citedId(row, kind), fromReasoning: quote }
  }
}

function readTopic(row: RawMarkInput): string | null {
  if (typeof row.topic !== 'string') return null
  const topic = row.topic.trim()
  return topic !== '' && topic.length <= 48 ? topic : null
}

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

  const kind = readKind(call, row)
  if (!citedIsValid(row, known, kind)) return null
  const topic = readTopic(row)
  if (!topic) return null
  const note = readNote(row, kind, quote)
  if (!note) return null
  const feedbackContents = kind === 'related' ? readFeedbackContents(row.feedback_contents) : null
  if (kind === 'related' && feedbackContents === null) return null
  // Not required: a mark with no draft opens an empty box, which is what it did
  // before. Dropping it instead loses the question altogether.
  const suggestedFeedback =
    kind === 'unrelated' &&
    typeof row.suggested_feedback === 'string' &&
    row.suggested_feedback.trim() !== ''
      ? row.suggested_feedback.trim()
      : null

  if (call.toolName === 'update_mark') {
    const id = readId(row, markIds)
    if (id === null) return null
    let nodeId: string | null | undefined
    if (row.node_id !== undefined) {
      nodeId = typeof row.node_id === 'string' && row.node_id !== '' ? row.node_id : null
    }
    return { type: 'update', id, nodeId, topic, note, feedbackContents, suggestedFeedback }
  }
  const nodeId = typeof row.node_id === 'string' && row.node_id !== '' ? row.node_id : null
  return { type: 'generate', nodeId, topic, note, feedbackContents, suggestedFeedback }
}

function readActions(
  calls: MarkToolCall[],
  known: Set<string>,
  reasoning: string,
  markIds: Set<string>
): { actions: MarkAction[]; rejected: RejectedMarkTool[] } {
  const haystack = flatten(reasoning)
  const actions: MarkAction[] = []
  const rejected: RejectedMarkTool[] = []
  for (const call of calls) {
    const action = readAction(call, known, haystack, markIds)
    if (action) actions.push(action)
    else rejected.push({ call, reason: rejectionReason(call, known, haystack, markIds) })
  }
  return { actions, rejected }
}

function rejectionReason(
  call: MarkToolCall,
  known: Set<string>,
  haystack: string,
  markIds: Set<string>
): string {
  const row = asRawMarkInput(call.input)
  if (!row) return 'invalid input'
  if (readQuote(row, haystack) === null) return 'reasoning quote did not match'
  const kind = readKind(call, row)
  if (!citedIsValid(row, known, kind)) return 'invalid proposition id for the tool used'
  if (readTopic(row) === null) return 'missing or invalid topic'
  if (!readNote(row, kind, 'valid')) return 'missing note'
  if (kind === 'related' && readFeedbackContents(row.feedback_contents) === null) {
    return 'incomplete feedback contents'
  }
  if (call.toolName === 'update_mark' && readId(row, markIds) === null) return 'unknown mark id'
  return 'invalid fields'
}

export function createMetaAgent(options: MetaAgentOptions): MetaAgent {
  const { deps } = options
  let marks: Mark[] = []
  let retired: Mark[] = []
  let nextId = 1
  let step = 1
  let nextOrder = 0
  let busy = false
  let pending: ConsiderInput | null = null
  let settlers: Array<() => void> = []
  let generation = 0
  let currentInput: JudgeInput | null = null
  let suspended = false
  const locked = new Set<string>()

  function wakeSettlers(): void {
    if (busy || pending) return
    const waiting = settlers
    settlers = []
    for (const resolve of waiting) resolve()
  }

  function mint(): string {
    return `m${nextId++}`
  }
  function capOpenQuestions(): void {
    const questions = marks.filter(isUnrelated)
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
        const sameDecision = [...marks, ...retired].find((mark) => {
          const latest = mark.notes.at(-1)
          return (
            mark.nodeId === action.nodeId &&
            flatten(latest?.evidence.fromReasoning ?? '') ===
              flatten(action.note.evidence.fromReasoning)
          )
        })
        if (sameDecision) {
          const updated = apply([
            {
              ...action,
              type: 'update',
              id: sameDecision.id
            }
          ])
          applied.push(...updated)
          continue
        }
        const id = mint()
        const position = action.feedbackContents ? OPENING_STEP : null
        const mark: Mark = {
          id,
          lineageId: id,
          nodeId: action.nodeId,
          topic: action.topic,
          notes: [action.note],
          raisedInStep: step,
          raisedOrder: nextOrder++,
          changedInStep: step,
          changedOrder: nextOrder - 1,
          position,
          feedbackContents: action.feedbackContents,
          suggestedFeedback: action.suggestedFeedback
        }
        marks.push(mark)
        applied.push({
          toolName: action.feedbackContents ? 'generate_related_mark' : 'generate_unrelated_mark',
          id,
          nodeId: action.nodeId,
          position,
          feedbackContents: action.feedbackContents
        })
        continue
      }
      if (locked.has(action.id)) continue
      let mark = marks.find((candidate) => candidate.id === action.id)
      const retiredIndex = retired.findIndex((candidate) => candidate.id === action.id)
      const wasRetired = !mark && retiredIndex !== -1
      if (!mark && retiredIndex !== -1) mark = retired[retiredIndex]
      if (!mark) continue
      if (wasRetired) {
        retired = retired.filter((candidate) => candidate.id !== action.id)
        mark.raisedInStep = step
        mark.raisedOrder = nextOrder++
        marks.push(mark)
      }
      if (action.nodeId !== undefined) mark.nodeId = action.nodeId
      mark.topic = action.topic
      if (mark.notes.at(-1)?.text !== action.note.text) mark.notes.push(action.note)
      mark.feedbackContents = action.feedbackContents
      mark.suggestedFeedback = action.suggestedFeedback
      // Where the person left it survives a reworded mark; losing the spectrum
      // takes it with them, since there is nothing left to sit on.
      mark.position = action.feedbackContents ? (mark.position ?? OPENING_STEP) : null
      mark.changedInStep = step
      mark.changedOrder = wasRetired ? mark.raisedOrder : nextOrder++
      applied.push({
        toolName: 'update_mark',
        id: action.id,
        nodeId: mark.nodeId,
        position: mark.position,
        feedbackContents: mark.feedbackContents ?? null,
        revived: wasRetired
      })
    }
    capOpenQuestions()
    return applied
  }

  async function run(input: ConsiderInput): Promise<void> {
    const startedIn = generation
    const known = new Set(input.propositions.map((p) => p.id))
    const full: JudgeInput = { ...input, marks, retired }
    currentInput = structuredClone(full)
    const calls = await deps.judge({ system: deps.system, prompt: deps.render(full) })
    if (startedIn !== generation) {
      options.onLifecycle?.('dropped stale judgment', marks)
      return
    }
    const markIds = new Set([...marks, ...retired].map((mark) => mark.id))
    const { actions, rejected } = readActions(calls, known, input.reasoning, markIds)
    if (rejected.length > 0) options.onRejectedTools?.(rejected, full)
    const applied = apply(actions)
    if (applied.length > 0) options.onTools?.(applied, full)
    options.onChanged(marks, retired, full)
  }

  function start(input: ConsiderInput): void {
    busy = true
    run(input)
      .catch((error: unknown) => {
        options.onError?.(error)
      })
      .finally(() => {
        busy = false
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
      generation += 1
      suspended = false
      const hadState = marks.length > 0 || retired.length > 0
      retired = []
      step = 1
      nextOrder = 0
      pending = null
      marks = []
      locked.clear()
      currentInput = null
      if (hadState) {
        options.onLifecycle?.('turn reset', marks)
        options.onChanged(marks, retired, null)
      }
    },

    suspend() {
      generation += 1
      suspended = true
      pending = null
      currentInput = null
      wakeSettlers()
    },

    beginStep(nextStep) {
      generation += 1
      step = nextStep ?? step + 1
      nextOrder = 0
      pending = null
      currentInput = null
      // Dropping the queued chunk can leave nothing in flight, and an unwoken
      // waiter holds the run for good.
      wakeSettlers()
    },

    consider(input) {
      if (suspended || input.propositions.length === 0) return

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
      options.onChanged(marks, retired, null)
    },

    dismissMark(id) {
      const mark = marks.find((candidate) => candidate.id === id)
      if (!mark) return
      retired = [...retired, mark]
      marks = marks.filter((candidate) => candidate.id !== id)
      options.onLifecycle?.(`dismissed ${id}`, marks)
      options.onChanged(marks, retired, null)
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
      options.onChanged(marks, retired, null)
    },

    lockMark(id) {
      locked.add(id)
    },

    unlockMark(id) {
      locked.delete(id)
    },

    get marks() {
      return marks
    },

    get currentInput() {
      return currentInput
    }
  }
}
