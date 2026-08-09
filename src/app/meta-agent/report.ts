import type { MarkAnswer } from '@/app/ai/chat/mismatch'
import type { Mark, MarkNote } from '@/app/meta-agent/judge'
import type { FeedbackNote } from '@/app/user-model/pipeline'

/**
 * What the person said, once they stop saying it.
 *
 * Marks were shown to them one at a time, but the reply is not one at a time:
 * a chunk of thinking raises two or three marks about one decision, and which
 * of those they answered is only meaningful next to which they let pass.
 * Leaving a mark alone is agreement — that is the rule the whole interaction
 * rests on — so an unanswered mark carries as much as an answered one and both
 * go in the report.
 *
 * Two readers, and they need different things from it. The agent needs to know
 * what to do differently and that it is redoing a step. The user model needs
 * the claims: which of our beliefs about this person just held up, and which
 * one they contradicted in their own words.
 */

export interface MarkReport {
  /** Answered, in the order answered. */
  answered: MarkAnswer[]
  /** Raised this turn and never answered. */
  agreed: Mark[]
}

function latestNote(mark: Mark): MarkNote | null {
  return mark.notes.length > 0 ? mark.notes[mark.notes.length - 1] : null
}

function noteOf(mark: Mark): string {
  return latestNote(mark)?.text ?? ''
}

function citedProposition(mark: Mark): string | null {
  for (let i = mark.notes.length - 1; i >= 0; i--) {
    const cited = mark.notes[i].evidence.fromUserModel
    if (cited !== null) return cited
  }
  return null
}

/**
 * Marks already reported on, so the same one is never reported twice.
 *
 * A single build reports more than once: when someone answers a marker the turn
 * restarts, and the run then ends again for real at the finish. Both endings
 * read the same list of marks, so without this every mark from the first half
 * of a build would arrive a second time as fresh agreement and count double.
 */
const reported = new Set<string>()

export function forgetReportedMarks(): void {
  reported.clear()
}

/** Of the marks the person could have answered, the ones not yet accounted for. */
export function takeUnreportedMarks(marks: Mark[]): Mark[] {
  const fresh = marks.filter((mark) => !reported.has(mark.id))
  for (const mark of fresh) reported.add(mark.id)
  return fresh
}

/**
 * `raised` is every mark of the turn, standing or not — a mark the person saw
 * and passed over may well have been deleted by the meta-agent since, and it
 * still counts as agreed with.
 */
export function buildMarkReport(raised: Mark[], answers: MarkAnswer[]): MarkReport {
  const answeredIds = new Set(answers.map((answer) => answer.id))
  return {
    answered: answers,
    agreed: raised.filter((mark) => !answeredIds.has(mark.id))
  }
}

export function hasContent(report: MarkReport): boolean {
  return report.answered.length > 0 || report.agreed.length > 0
}

/**
 * The message the agent restarts from.
 *
 * It never saw any of these notes — the meta-agent writes to the person, not to
 * it — so the note has to travel with the reply or the reply is a non sequitur.
 * The instruction to discard is explicit because the transcript it is handed
 * still contains the thinking that led to the abandoned step, and a model that
 * is not told otherwise will read its own half-finished plan as settled.
 */
export function renderReportForAgent(
  report: MarkReport,
  stepNumber: number,
  request: string
): string {
  const lines: string[] = [
    `[Interrupted at step ${stepNumber}]`,
    '',
    'While you were working, the user was shown notes about the decisions in your',
    'thinking. You never saw those notes. They have replied to some of them, and the',
    'step you were part-way through has been stopped.',
    '',
    'Discard whatever you were about to do in that step and do it again, differently,',
    'in light of what they said. Everything from the steps before it stands.',
    '',
    // Restated rather than left to the transcript: the planning call at the top
    // of the restarted turn reads the newest user message, and a plan made from
    // an interruption note alone would forget what is being built.
    `The request has not changed. They asked for: ${request}`
  ]

  if (report.answered.length > 0) {
    lines.push('', 'What they replied to:')
    for (const answer of report.answered) {
      const where = answer.nodeId === null ? 'the design as a whole' : `node ${answer.nodeId}`
      lines.push(`- about ${where}, they were shown: "${answer.note}"`)
      lines.push(`  they said: ${answer.text}`)
    }
  }

  if (report.agreed.length > 0) {
    lines.push(
      '',
      'They were also shown these and let them stand, which means they were content',
      'with them. Do not change these:'
    )
    for (const mark of report.agreed) {
      const where = mark.nodeId === null ? 'the design as a whole' : `node ${mark.nodeId}`
      lines.push(`- about ${where}: "${noteOf(mark)}"`)
    }
  }

  return lines.join('\n')
}

/**
 * The same event as evidence about the person, handed over with its structure
 * intact.
 *
 * Not prose. Each note already knows the proposition it was raised against and
 * the words it was read off — that is what the evidence fields on a mark are
 * for — and flattening them into a sentence means the user model has to work
 * back to a proposition id it was already holding.
 */
export function feedbackNotes(report: MarkReport): FeedbackNote[] {
  return [
    ...report.answered.map((answer) => ({
      note: answer.note,
      quote: answer.quote,
      citedId: answer.citedId,
      reply: answer.text
    })),
    ...report.agreed.map((mark) => ({
      note: noteOf(mark),
      quote: latestNote(mark)?.evidence.fromReasoning ?? '',
      citedId: citedProposition(mark),
      reply: null
    }))
  ]
}

/**
 * Drop the tool call the abort cut in half.
 *
 * Stopping mid-stream leaves the assistant message holding a tool call whose
 * result never arrived. Every provider rejects a transcript like that — "Tool
 * result is missing for tool call …" — so replaying it as history to restart
 * the build fails before the first token. A call with no result also had no
 * effect on the canvas, so nothing is lost by removing it; completed calls from
 * the same step stay, because those did happen.
 */
export function withoutDanglingToolCalls<T extends { role: string; parts: unknown[] }>(
  messages: readonly T[]
): T[] {
  const last = messages.at(-1)
  if (last?.role !== 'assistant') return [...messages]

  const kept = last.parts.filter((part) => {
    if (typeof part !== 'object' || part === null || !('toolCallId' in part)) return true
    const state = 'state' in part ? part.state : undefined
    return state === 'output-available' || state === 'output-error'
  })
  if (kept.length === last.parts.length) return [...messages]

  const head = messages.slice(0, -1)
  // Nothing but a step marker left: the message says the agent started a step
  // and did nothing, which is noise in the transcript and in the chat.
  const onlyMarkers = kept.every(
    (part) =>
      typeof part === 'object' && part !== null && 'type' in part && part.type === 'step-start'
  )
  if (onlyMarkers) return head
  return [...head, { ...last, parts: kept }]
}
