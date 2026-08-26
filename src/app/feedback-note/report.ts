import { feedbackSelectionLabel } from '@/app/feedback-note/draft/selection'
import type { ConfirmedFeedback } from '@/app/feedback-note/draft/types'
import type { StepFeedbackResult } from '@/app/feedback-note/session'

function selectedAlternative(item: ConfirmedFeedback): { id: string; label: string } | null {
  const { selection } = item
  if (selection.type === 'none' || selection.type === 'text') return null
  return selection.target ?? null
}

export function renderStepFeedbackReport(result: StepFeedbackResult, request: string): string {
  const lines = [
    `[Retrying step ${result.step} after user feedback]`,
    '',
    `The original request is unchanged: ${request}`,
    '',
    `You previously reasoned through step ${result.step}, but none of that step's tool calls were executed.`,
    'The user reviewed every feedback note produced from that reasoning.',
    ''
  ]

  if (result.reasoningChunks.length > 0) {
    lines.push('Previous reasoning chunks:')
    for (const chunk of result.reasoningChunks)
      lines.push(`- Chunk ${chunk.chunk}: "${chunk.text}"`)
    lines.push('')
  }

  lines.push('Feedback notes and outcomes:')
  for (const [index, outcome] of result.outcomes.entries()) {
    lines.push(`${index + 1}. Note: "${outcome.note.text}"`)
    lines.push(`   Relationship: ${outcome.note.relationship}`)
    lines.push(`   Agent reasoning evidence: "${outcome.note.evidenceFromReasoning}"`)
    if (outcome.note.propositionIds.length > 0) {
      lines.push(`   Linked user-model propositions: ${outcome.note.propositionIds.join(', ')}`)
    }
    if (outcome.resolution === 'implicitly-accepted') {
      lines.push('   The user reviewed this note and accepted it without correction.')
    } else {
      for (const item of outcome.feedbackItems) {
        const target = selectedAlternative(item)
        if (target) {
          lines.push(`   AUTHORITATIVE CHOICE: ${target.label} (id: ${target.id})`)
          lines.push(`   Supporting explanation: "${item.feedback}"`)
          lines.push(
            '   Interpretation rule: carry out the authoritative choice. Use the explanation only to understand or refine that choice; never use it to reverse the selected alternative.'
          )
        } else {
          lines.push(
            `   On ${feedbackSelectionLabel(item.selection)}, the user said: "${item.feedback}"`
          )
        }
      }
    }
  }

  lines.push(
    '',
    `Perform step ${result.step} again from new reasoning, using every outcome above.`,
    'Do not execute the previous intended actions merely because they appeared in the discarded step.',
    'Interactive feedback is disabled for this retry. Complete the retry through tool execution.'
  )
  return lines.join('\n')
}
