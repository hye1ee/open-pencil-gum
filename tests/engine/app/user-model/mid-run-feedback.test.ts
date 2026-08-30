import { describe, expect, test } from 'bun:test'

import {
  FEEDBACK_SYSTEM_MID_RUN_FEEDBACK,
  RATIONALE_SYSTEM_MID_RUN_FEEDBACK
} from '@/app/user-model/mid-run-feedback/prompt'
import type { UserModelMidRunFeedbackBatch } from '@/app/user-model/mid-run-feedback/types'
import { createUserModel } from '@/app/user-model/pipeline'
import type {
  Proposition,
  RevisionPurpose,
  SavedProposition,
  UserModelDeps
} from '@/app/user-model/pipeline'

function proposition(overrides: Partial<SavedProposition> = {}): SavedProposition {
  const now = new Date().toISOString()
  return {
    id: 'button-style',
    text: 'Prefers filled primary buttons.',
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
    originalText: 'Prefers filled primary buttons.',
    originalEmbedding: [1, 0],
    revisions: 0,
    ...overrides
  }
}

function batch(overrides: Partial<UserModelMidRunFeedbackBatch> = {}): UserModelMidRunFeedbackBatch {
  return {
    requestId: 'request-1',
    request: 'Create a project summary card component.',
    stepNumber: 7,
    executedActions: ['render → card-frame', 'batch_update → title-text, badge'],
    messages: ['Make every button outlined instead, filled buttons feel too heavy here.'],
    ...overrides
  }
}

describe('mid-run feedback → shared User Model', () => {
  test('embeds each message, retrieves neighbours, and revises with mid-run prompts', async () => {
    const embedCalls: string[][] = []
    const revisionCalls: Array<{ system: string; prompt: string; purpose: RevisionPurpose }> = []
    const saved: Proposition[][] = []
    const deps: UserModelDeps = {
      propose: async () => '[]',
      embed: async (texts) => {
        embedCalls.push(texts)
        return texts.map(() => [1, 0])
      },
      revise: async (input) => {
        revisionCalls.push(input)
        if (input.system === FEEDBACK_SYSTEM_MID_RUN_FEEDBACK) {
          return JSON.stringify([
            {
              id: 'button-style',
              text: 'Prefers outlined buttons over filled ones in dense layouts.',
              confidence: 8,
              decay: 2,
              reasoning: 'The mid-run message contradicts the filled-button preference.',
              relation: 'contradiction'
            }
          ])
        }
        if (input.system === RATIONALE_SYSTEM_MID_RUN_FEEDBACK) {
          return JSON.stringify([
            {
              id: 'button-style',
              rationale: 'Filled buttons feel visually heavy in this kind of layout.',
              purpose_evidence_quote: 'filled buttons feel too heavy here',
              rationale_grounds: 'The message states the reason directly.',
              rationale_from: []
            }
          ])
        }
        return '[]'
      }
    }
    const model = createUserModel({
      deps,
      onChange: (items) => saved.push(structuredClone(items))
    })
    model.load([proposition()])

    await model.observeMidRunFeedback(batch())

    expect(embedCalls[0]).toHaveLength(1)
    expect(embedCalls[0]?.[0]).toContain(
      'Original request: Create a project summary card component.'
    )
    expect(embedCalls[0]?.[0]).toContain('User message: Make every button outlined instead')

    expect(revisionCalls.map((call) => call.purpose)).toEqual([
      'revise-from-mid-run-feedback',
      'revise-from-mid-run-feedback'
    ])
    expect(revisionCalls[0]?.prompt).toContain('The agent was at step 7.')
    expect(revisionCalls[0]?.prompt).toContain('render → card-frame')
    expect(revisionCalls[0]?.prompt).toContain('Make every button outlined instead')
    expect(revisionCalls[0]?.prompt).toContain('Prefers filled primary buttons.')
    expect(revisionCalls[0]?.prompt).not.toContain('plan')

    const updated = saved.at(-1)?.find((item) => item.id === 'button-style')
    expect(updated).toMatchObject({
      text: 'Prefers outlined buttons over filled ones in dense layouts.',
      rationale: 'Filled buttons feel visually heavy in this kind of layout.',
      observations: 2,
      revisions: 1
    })
  })

  test('drops a rationale whose quote is not an exact message substring', async () => {
    const dropped: string[] = []
    const deps: UserModelDeps = {
      propose: async () => '[]',
      embed: async (texts) => texts.map(() => [1, 0]),
      revise: async (input) => {
        if (input.system === RATIONALE_SYSTEM_MID_RUN_FEEDBACK) {
          return JSON.stringify([
            {
              id: 'button-style',
              rationale: 'Wants lighter visuals.',
              purpose_evidence_quote: 'this text never appeared in any message',
              rationale_grounds: 'Invented.',
              rationale_from: []
            }
          ])
        }
        return '[]'
      }
    }
    const model = createUserModel({
      deps,
      onChange: () => undefined,
      onRationaleDropped: (reason) => dropped.push(reason)
    })
    model.load([proposition()])

    await model.observeMidRunFeedback(batch())

    expect(dropped).toHaveLength(1)
    expect(model.propositions[0]?.rationale).toBeNull()
  })

  test('an empty message batch is a no-op', async () => {
    let revised = 0
    const deps: UserModelDeps = {
      propose: async () => '[]',
      embed: async (texts) => texts.map(() => [1, 0]),
      revise: async () => {
        revised += 1
        return '[]'
      }
    }
    const model = createUserModel({ deps, onChange: () => undefined })
    model.load([proposition()])

    await model.observeMidRunFeedback(batch({ messages: [] }))

    expect(revised).toBe(0)
  })
})
