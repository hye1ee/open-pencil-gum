import { describe, expect, test } from 'bun:test'

import type { AskUserAnswer } from '@/app/study/ask-user'
import { FEEDBACK_SYSTEM_ASKUSER, RATIONALE_SYSTEM_ASKUSER } from '@/app/user-model/ask-user/prompt'
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
    id: 'travel-style',
    text: 'Prefers neighborhood-focused travel.',
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
    originalText: 'Prefers neighborhood-focused travel.',
    originalEmbedding: [1, 0],
    revisions: 0,
    ...overrides
  }
}

function answer(): AskUserAnswer {
  return {
    question: {
      id: 'question-1',
      requestId: 'request-1',
      sequence: 1,
      question: 'What should the itinerary prioritize?',
      options: ['Famous landmarks', 'Neighborhood experiences', 'Shopping'],
      createdAt: 1
    },
    selectedOption: 'Neighborhood experiences',
    answer: 'Neighborhood experiences, because we want to understand how locals live.',
    answeredAt: 2
  }
}

describe('Ask User → shared User Model', () => {
  test('retrieves from the chosen answer and updates proposition and rationale', async () => {
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
        if (input.system === FEEDBACK_SYSTEM_ASKUSER) {
          return JSON.stringify([
            {
              id: 'travel-style',
              text: 'Prefers neighborhood-focused travel that reveals how locals live.',
              confidence: 9,
              decay: 2,
              reasoning: 'The selected option and final answer refine the existing preference.',
              relation: 'same_claim_refinement'
            }
          ])
        }
        if (input.system === RATIONALE_SYSTEM_ASKUSER) {
          return JSON.stringify([
            {
              id: 'travel-style',
              rationale: 'Wants to understand how locals live.',
              purpose_evidence_quote: 'because we want to understand how locals live',
              rationale_grounds: 'The final answer explicitly states this purpose.',
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
    model.load([
      proposition(),
      proposition({
        id: 'shopping-style',
        text: 'Prioritizes shopping districts while traveling.',
        embedding: [0, 1],
        originalEmbedding: [0, 1]
      })
    ])

    await model.observeAskUser({
      requestId: 'request-1',
      request: 'Plan a five-day trip.',
      answers: [answer()]
    })

    expect(embedCalls[0]?.[0]).toContain('Selected option: Neighborhood experiences')
    expect(embedCalls[0]?.[0]).toContain(
      'Final answer: Neighborhood experiences, because we want to understand how locals live.'
    )
    expect(embedCalls[0]?.[0]).not.toContain('Famous landmarks')
    expect(embedCalls[0]?.[0]).not.toContain('Shopping')

    expect(revisionCalls).toHaveLength(2)
    expect(revisionCalls.map((call) => call.purpose)).toEqual([
      'revise-from-ask-user',
      'revise-from-ask-user'
    ])
    expect(revisionCalls[0]?.prompt).toContain('1. Famous landmarks')
    expect(revisionCalls[0]?.prompt).toContain('2. Neighborhood experiences')
    expect(revisionCalls[0]?.prompt).toContain('3. Shopping')
    expect(revisionCalls[0]?.prompt).toContain('selected option: "Neighborhood experiences"')

    const updated = saved.at(-1)?.find((item) => item.id === 'travel-style')
    expect(updated).toMatchObject({
      text: 'Prefers neighborhood-focused travel that reveals how locals live.',
      rationale: 'Wants to understand how locals live.',
      rationaleGrounds: 'The final answer explicitly states this purpose.',
      observations: 2,
      revisions: 1
    })
    expect(saved.at(-1)?.find((item) => item.id === 'shopping-style')).toMatchObject({
      text: 'Prioritizes shopping districts while traveling.',
      observations: 1
    })
  })
})
