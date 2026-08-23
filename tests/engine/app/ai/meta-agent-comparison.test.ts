import { describe, expect, test } from 'bun:test'

import {
  PROPOSITION_COMPARISON_SYSTEM,
  renderPropositionComparisonPrompt
} from '@/app/meta-agent/comparison/prompt'
import { PROPOSITION_COMPARISON_TOOLS } from '@/app/meta-agent/comparison/tools'
import { parsePropositionComparison } from '@/app/meta-agent/comparison/use'
import type { Proposition } from '@/app/meta-agent/judge'

const USER_PROPOSITIONS: Proposition[] = [
  {
    id: 'structure-first',
    text: 'Maps the overall structure before polishing details.',
    confidence: 0.9,
    rationale: 'Reduces ambiguity before committing.',
    shownToAgent: true
  },
  {
    id: 'visible-controls',
    text: 'Keeps advanced controls visible instead of hiding them progressively.',
    confidence: 0.7,
    rationale: null,
    shownToAgent: true
  }
]

describe('meta-agent proposition comparison shadow', () => {
  test('separates extraction from many-to-many user-model links', () => {
    expect(PROPOSITION_COMPARISON_SYSTEM).toContain('without consulting the user model')
    expect(PROPOSITION_COMPARISON_SYSTEM).toContain('zero, one, or several')
    expect(PROPOSITION_COMPARISON_SYSTEM).toContain('Return at most 5 propositions')
    expect(PROPOSITION_COMPARISON_SYSTEM).toContain(
      'Do not omit a proposition because the current user model may not cover it'
    )
    expect(PROPOSITION_COMPARISON_SYSTEM).toContain('with no links is uncovered')
    expect(Object.keys(PROPOSITION_COMPARISON_TOOLS)).toEqual(['record_proposition_comparison'])
  })

  test('renders reasoning and every user-model proposition with confidence', () => {
    const prompt = renderPropositionComparisonPrompt({
      request: 'Make a dashboard',
      reasoning: 'I will establish the structure before styling cards.',
      propositions: USER_PROPOSITIONS
    })

    expect(prompt).toContain('Make a dashboard')
    expect(prompt).toContain('structure-first')
    expect(prompt).toContain('(9/10)')
    expect(prompt).toContain('I will establish the structure before styling cards.')
  })

  test('keeps valid links and leaves an unlinked task proposition uncovered', () => {
    const reasoning =
      'I will establish the structure before styling cards. Then I will collapse advanced controls.'
    const comparison = parsePropositionComparison(
      {
        task_propositions: [
          {
            id: 'ta-1',
            text: 'Establish the dashboard structure before styling its individual cards.',
            evidence_from_reasoning: 'establish the structure before styling cards'
          },
          {
            id: 'ta-2',
            text: 'Collapse advanced controls until the user explicitly needs them.',
            evidence_from_reasoning: 'collapse advanced controls'
          }
        ],
        links: [
          {
            task_proposition_id: 'ta-1',
            user_proposition_id: 'structure-first',
            relationship: 'alignment',
            explanation: 'Both establish structure before detail work.'
          }
        ]
      },
      reasoning,
      USER_PROPOSITIONS
    )

    expect(comparison?.taskPropositions.map((proposition) => proposition.id)).toEqual([
      'ta-1',
      'ta-2'
    ])
    expect(comparison?.links).toHaveLength(1)
    expect(comparison?.links.some((link) => link.taskPropositionId === 'ta-2')).toBeFalse()
  })

  test('rejects invented evidence and links to unknown ids', () => {
    const comparison = parsePropositionComparison(
      {
        task_propositions: [
          {
            id: 'ta-1',
            text: 'Use a sidebar.',
            evidence_from_reasoning: 'invented quote'
          }
        ],
        links: [
          {
            task_proposition_id: 'ta-1',
            user_proposition_id: 'missing',
            relationship: 'alignment',
            explanation: 'Invented relationship.'
          }
        ]
      },
      'I will use top navigation.',
      USER_PROPOSITIONS
    )

    expect(comparison).toEqual({ taskPropositions: [], links: [] })
  })
})
