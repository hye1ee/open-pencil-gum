import { describe, expect, test } from 'bun:test'

import type { ReasoningFeedbackOutcome } from '@/app/study/user-initiated/reasoning-review'
import { createUserModel } from '@/app/user-model/pipeline'
import type {
  Proposition,
  RevisionPurpose,
  SavedProposition,
  UserModelDeps
} from '@/app/user-model/pipeline'
import { reasoningFeedbackBatch } from '@/app/user-model/user-initiated/batch'
import {
  FEEDBACK_SYSTEM_USER_INITIATED,
  RATIONALE_SYSTEM_USER_INITIATED
} from '@/app/user-model/user-initiated/prompt'

function proposition(overrides: Partial<SavedProposition> = {}): SavedProposition {
  const now = new Date().toISOString()
  return {
    id: 'travel-pace',
    text: 'Prefers flexible travel schedules.',
    confidence: 0.6,
    decay: 0.2,
    reasoning: 'Seed proposition.',
    rationale: null,
    rationaleGrounds: null,
    rationaleFrom: [],
    createdAt: now,
    updatedAt: now,
    observations: 1,
    embedding: [1, 0],
    originalText: 'Prefers flexible travel schedules.',
    originalEmbedding: [1, 0],
    revisions: 0,
    ...overrides
  }
}

function outcome(
  id: string,
  chunkIndex: number,
  text: string,
  reasoningSoFar: string,
  feedback: string,
  selectedReasoning: string | null
): ReasoningFeedbackOutcome {
  return {
    review: {
      id,
      streamId: 1,
      chunkIndex,
      request: 'Plan a five-day trip.',
      text,
      reasoningSoFar,
      status: 'answered',
      createdAt: chunkIndex
    },
    feedback,
    selectedReasoning
  }
}

describe('User-Initiated reasoning feedback → shared User Model', () => {
  test('retrieves per feedback item, combines candidates, and updates once before retry', async () => {
    const embedCalls: string[][] = []
    const revisionCalls: Array<{ system: string; prompt: string; purpose: RevisionPurpose }> = []
    const retrievals: Array<{ shownIds: string[] }> = []
    const saved: Proposition[][] = []
    const deps: UserModelDeps = {
      propose: async () => '[]',
      embed: async (texts) => {
        embedCalls.push(texts)
        if (texts.length === 2)
          return [
            [1, 0],
            [0, 1]
          ]
        return texts.map(() => [1, 0])
      },
      revise: async (input) => {
        revisionCalls.push(input)
        if (input.system === FEEDBACK_SYSTEM_USER_INITIATED) {
          return JSON.stringify([
            {
              id: 'travel-pace',
              text: 'Prefers flexible travel schedules with unhurried mornings.',
              confidence: 9,
              decay: 2,
              reasoning: 'The first feedback adds a reusable timing constraint.',
              relation: 'same_claim_refinement'
            }
          ])
        }
        if (input.system === RATIONALE_SYSTEM_USER_INITIATED) {
          return JSON.stringify([
            {
              id: 'travel-pace',
              rationale: 'Jet lag may make early starts difficult.',
              purpose_evidence_quote: 'because jet lag may make early starts difficult',
              rationale_grounds: 'The first final feedback explicitly states this reason.',
              rationale_from: []
            }
          ])
        }
        return '[]'
      }
    }
    const model = createUserModel({
      deps,
      onChange: (items) => saved.push(structuredClone(items)),
      onUserInitiatedRetrieval: (trace) => retrievals.push(trace)
    })
    model.load([
      proposition(),
      proposition({
        id: 'travel-cost',
        text: 'Wants important travel costs shown explicitly.',
        embedding: [0, 1],
        originalEmbedding: [0, 1]
      })
    ])

    const outcomes = [
      outcome(
        'reasoning-1-1',
        1,
        'I will schedule an early start every day.',
        'I will group sights by area. I will schedule an early start every day.',
        'Keep mornings flexible because jet lag may make early starts difficult.',
        'schedule an early start every day'
      ),
      outcome(
        'reasoning-1-2',
        2,
        'I will omit prices until the final summary.',
        'I will group sights by area. I will omit prices until the final summary.',
        'Show the major ticket costs beside each day.',
        null
      )
    ]

    await model.observeUserInitiated(reasoningFeedbackBatch('request-1', null, outcomes))

    expect(embedCalls[0]).toHaveLength(2)
    expect(embedCalls[0]?.[0]).toContain('Feedback target: schedule an early start every day')
    expect(embedCalls[0]?.[0]).toContain(
      'Final user feedback: Keep mornings flexible because jet lag may make early starts difficult.'
    )
    expect(embedCalls[0]?.[1]).toContain(
      'Feedback target: I will omit prices until the final summary.'
    )
    expect(retrievals).toEqual([
      { shownIds: ['travel-pace', 'travel-cost'], items: expect.any(Array) }
    ])

    expect(revisionCalls).toHaveLength(2)
    expect(revisionCalls.map((call) => call.purpose)).toEqual([
      'revise-from-user-initiated',
      'revise-from-user-initiated'
    ])
    expect(revisionCalls[0]?.prompt).toContain('Prefers flexible travel schedules.')
    expect(revisionCalls[0]?.prompt).toContain('Wants important travel costs shown explicitly.')
    expect(revisionCalls[0]?.prompt).toContain(
      'I will group sights by area. I will schedule an early start every day.'
    )
    expect(revisionCalls[0]?.prompt).toContain('selected reasoning: (the whole checkpoint)')

    const updated = saved.at(-1)?.find((item) => item.id === 'travel-pace')
    expect(updated).toMatchObject({
      text: 'Prefers flexible travel schedules with unhurried mornings.',
      rationale: 'Jet lag may make early starts difficult.',
      rationaleGrounds: 'The first final feedback explicitly states this reason.',
      observations: 2,
      revisions: 1
    })
  })
})
