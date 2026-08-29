import { describe, expect, test } from 'bun:test'

import type { ReasoningFeedbackOutcome } from '@/app/study/user-initiated/reasoning-review'
import { renderReasoningFeedbackReport } from '@/app/study/user-initiated/report'

function outcome(selectedReasoning: string | null): ReasoningFeedbackOutcome {
  return {
    review: {
      id: 'reasoning-1-1',
      streamId: 1,
      chunkIndex: 1,
      request: 'Plan a weekend trip.',
      text: 'I will center the trip on nightlife.',
      reasoningSoFar: 'First I will choose a neighborhood. I will center the trip on nightlife.',
      status: 'answered',
      createdAt: 1
    },
    feedback: 'Please prioritize museums and quiet neighborhoods.',
    selectedReasoning
  }
}

describe('user-initiated reasoning feedback report', () => {
  test('includes the selected passage and instructions to discard the first run', () => {
    const report = renderReasoningFeedbackReport(outcome('center the trip on nightlife'))

    expect(report).toContain('Original request: Plan a weekend trip.')
    expect(report).toContain('Selected reasoning: center the trip on nightlife')
    expect(report).toContain('Please prioritize museums and quiet neighborhoods.')
    expect(report).toContain('Discard any action, tool result, or answer')
  })

  test('targets the whole checkpoint for feedback written without a selection', () => {
    const report = renderReasoningFeedbackReport(outcome(null))

    expect(report).toContain('Feedback target: the reasoning checkpoint as a whole')
  })

  test('combines feedback from multiple checkpoints into one retry report', () => {
    const second = outcome('choose a neighborhood')
    second.review = {
      ...second.review,
      id: 'reasoning-1-2',
      chunkIndex: 2,
      text: 'I will choose a neighborhood before setting the daily route.'
    }
    second.feedback = 'Choose the neighborhood based on transit access.'

    const report = renderReasoningFeedbackReport([outcome('center the trip on nightlife'), second])

    expect(report).toContain('Feedback 1')
    expect(report).toContain('Feedback 2')
    expect(report).toContain('Choose the neighborhood based on transit access.')
    expect(report).toContain('Reasoning so far at this checkpoint:')
  })
})
