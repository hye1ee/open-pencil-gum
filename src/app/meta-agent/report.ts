import type { MarkAnswer } from '@/app/ai/chat/mismatch'
import type { Mark, MarkNote } from '@/app/meta-agent/judge'
import { isUnrelated } from '@/app/meta-agent/judge'
import type { FeedbackNote } from '@/app/user-model/pipeline'

/**
 * What the person said, answered and unanswered alike — leaving a mark alone is
 * agreement, so both carry. Two readers want different things: the agent wants
 * what to do differently, the user model wants which belief held or broke.
 */

export interface MarkReport {
  /** Answered, in the order answered. */
  answered: MarkAnswer[]
  /** Raised this turn and never answered. */
  agreed: Mark[]
}

export interface InterruptedStep {
  reasoning: string
  pendingActions: Array<{ toolName: string; input: unknown }>
}

interface PendingToolPart {
  toolCallId: unknown
  state?: unknown
  toolName?: unknown
  type?: unknown
  input?: unknown
}

export function pendingActionsFromParts(
  parts: readonly unknown[]
): InterruptedStep['pendingActions'] {
  return parts.flatMap((part) => {
    if (typeof part !== 'object' || part === null || !('toolCallId' in part)) return []
    const row = part as PendingToolPart
    if (row.state === 'output-available' || row.state === 'output-error') return []
    let toolName = 'unknown tool'
    if (typeof row.toolName === 'string') toolName = row.toolName
    else if (typeof row.type === 'string' && row.type.startsWith('tool-')) {
      toolName = row.type.slice(5)
    }
    return [{ toolName, input: row.input }]
  })
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

/** A build reports twice — once when a marker answer restarts the turn, once at
 * the finish — and both read the same list, so a mark would count double. */
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

/** `raised` is every mark of the turn, standing or not: one the person saw and
 * passed over still counts as agreed with. */
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

/** The agent never saw these notes, so each has to travel with its reply. The
 * discard instruction is explicit: the transcript still holds the dead plan. */
export function renderReportForAgent(
  report: MarkReport,
  stepNumber: number,
  request: string,
  interrupted?: InterruptedStep
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
    // The restarted turn's planning call reads the newest user message, and an
    // interruption note alone would forget what is being built.
    `The request has not changed. They asked for: ${request}`
  ]

  if (interrupted?.reasoning) {
    lines.push('', 'Reasoning from the interrupted step:', interrupted.reasoning)
  }
  const actions = (interrupted?.pendingActions ?? []).map(({ toolName, input }) => {
    const detail = JSON.stringify(input) ?? ''
    return `${toolName}(${detail.length > 800 ? `${detail.slice(0, 800)}…` : detail})`
  })
  if (actions.length > 0) {
    lines.push('', 'Actions being prepared in that step:')
    for (const action of actions) lines.push(`- ${action}`)
    lines.push('Pending actions above were not applied to the canvas.')
  }

  if (report.answered.length > 0) {
    lines.push('', 'What they replied to:')
    for (const answer of report.answered) {
      const where = answer.nodeId === null ? 'the design as a whole' : `node ${answer.nodeId}`
      lines.push(`- about ${answer.topic} (${where}), they were shown: "${answer.note}"`)
      if (answer.fromPosition !== undefined && answer.toPosition !== undefined) {
        lines.push(`  they moved the marker from ${answer.fromPosition} to ${answer.toPosition}`)
      }
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

/** Structured, not prose: each note already knows its proposition id and the
 * words it was read off, and flattening makes the user model recover them. */
export function feedbackNotes(report: MarkReport): FeedbackNote[] {
  return [
    ...report.answered.map((answer) => ({
      note: answer.note,
      quote: answer.quote,
      citedId: answer.citedId,
      reply: answer.text,
      fromPosition: answer.fromPosition ?? null,
      toPosition: answer.toPosition ?? null
    })),
    ...report.agreed
      .filter((mark) => !isUnrelated(mark))
      .map((mark) => ({
        note: noteOf(mark),
        quote: latestNote(mark)?.evidence.fromReasoning ?? '',
        citedId: citedProposition(mark),
        reply: null,
        fromPosition: null,
        toPosition: null
      }))
  ]
}

/** A call whose result never arrived makes every provider reject the transcript
 * on replay, and it never touched the canvas, so nothing is lost dropping it. */
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
  // Only a step marker left: the agent started a step and did nothing.
  const onlyMarkers = kept.every(
    (part) =>
      typeof part === 'object' && part !== null && 'type' in part && part.type === 'step-start'
  )
  if (onlyMarkers) return head
  return [...head, { ...last, parts: kept }]
}
