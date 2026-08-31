import { describe, expect, test } from 'bun:test'

import {
  TASK_AGENT_PROPOSITION_LIMIT,
  renderUserModelPropositions,
  selectTaskAgentPropositions,
  selectTaskAgentPropositionsByRelevance
} from '@/app/ai/chat/user-model-propositions'
import type { UserModelProposition } from '@/app/ai/chat/user-model-propositions'

function proposition(text: string, confidence: number): UserModelProposition {
  return { text, confidence, rationale: null }
}

function embedded(
  text: string,
  confidence: number,
  embedding: number[]
): UserModelProposition & { embedding: number[] } {
  return { text, confidence, rationale: null, embedding }
}

describe('task agent proposition selection', () => {
  test('takes the top five by confidence from a recency-ordered list', () => {
    const propositions = [
      proposition('recent-low', 0.2),
      proposition('mid', 0.6),
      proposition('high', 0.9),
      proposition('low', 0.3),
      proposition('higher', 0.95),
      proposition('mid-high', 0.7)
    ]
    const selected = selectTaskAgentPropositions(propositions, 'userlens')
    expect(selected).toHaveLength(TASK_AGENT_PROPOSITION_LIMIT)
    expect(selected.map((item) => item.text)).toEqual([
      'higher',
      'high',
      'mid-high',
      'mid',
      'low'
    ])
  })

  test('returns everything when the model has five or fewer propositions', () => {
    const propositions = [proposition('one', 0.1), proposition('two', 0.9)]
    expect(selectTaskAgentPropositions(propositions, 'ask-user')).toHaveLength(2)
  })

  test('hands-off receives the whole model, low confidence included', () => {
    const propositions = Array.from({ length: 8 }, (_, index) =>
      proposition(`item-${index + 1}`, 0.1)
    )
    const selected = selectTaskAgentPropositions(propositions, 'hands-off')
    expect(selected).toHaveLength(8)
    expect(selected.map((item) => item.text)).toEqual(propositions.map((item) => item.text))
  })

  test('never mutates the input array', () => {
    const propositions = [proposition('recent', 0.2), proposition('old', 0.9)]
    selectTaskAgentPropositions(propositions, 'user-initiated')
    expect(propositions.map((item) => item.text)).toEqual(['recent', 'old'])
  })
})

describe('task agent proposition selection by relevance', () => {
  const request = [1, 0]

  test('takes the top five by similarity to the request, confidence ignored', () => {
    const propositions = [
      embedded('far', 1, [0, 1]),
      embedded('near', 0.1, [1, 0]),
      embedded('mid', 0.5, [0.7, 0.7]),
      embedded('close', 0.2, [0.9, 0.1]),
      embedded('off', 0.9, [0.1, 0.9]),
      embedded('adjacent', 0.3, [0.8, 0.2])
    ]
    const selected = selectTaskAgentPropositionsByRelevance(propositions, 'userlens', request)
    expect(selected).toHaveLength(TASK_AGENT_PROPOSITION_LIMIT)
    expect(selected.map((item) => item.text)).toEqual(['near', 'close', 'adjacent', 'mid', 'off'])
  })

  test('a proposition without an embedding ranks last, never crashes', () => {
    const propositions = [
      embedded('unembedded', 1, []),
      embedded('near', 0.1, [1, 0]),
      embedded('far', 0.5, [0.1, 0.9])
    ]
    const selected = selectTaskAgentPropositionsByRelevance(propositions, 'ask-user', request)
    expect(selected.map((item) => item.text)).toEqual(['near', 'far', 'unembedded'])
  })

  test('falls back to confidence order when the request embedding is null', () => {
    const propositions = [
      embedded('low', 0.2, [1, 0]),
      embedded('high', 0.9, [0, 1]),
      embedded('mid', 0.5, [1, 0])
    ]
    const selected = selectTaskAgentPropositionsByRelevance(propositions, 'user-initiated', null)
    expect(selected.map((item) => item.text)).toEqual(['high', 'mid', 'low'])
  })

  test('hands-off still receives the whole model, similarity ignored', () => {
    const propositions = Array.from({ length: 8 }, (_, index) =>
      embedded(`item-${index + 1}`, 0.1, [0, 1])
    )
    const selected = selectTaskAgentPropositionsByRelevance(propositions, 'hands-off', request)
    expect(selected).toHaveLength(8)
  })

  test('never mutates the input array', () => {
    const propositions = [embedded('recent', 0.2, [0, 1]), embedded('old', 0.9, [1, 0])]
    selectTaskAgentPropositionsByRelevance(propositions, 'userlens', request)
    expect(propositions.map((item) => item.text)).toEqual(['recent', 'old'])
  })
})

describe('task agent proposition rendering', () => {
  test('an empty selection renders nothing at all', () => {
    expect(renderUserModelPropositions([])).toBeNull()
  })

  test('renders confidence out of ten and a why line only when a rationale exists', () => {
    const rendered = renderUserModelPropositions([
      { text: 'Prefers quiet palettes.', confidence: 0.78, rationale: 'Less visual noise.' },
      proposition('Avoids dense layouts.', 0.2)
    ])
    expect(rendered).toContain('how much evidence stands')
    expect(rendered).toContain('- Prefers quiet palettes. (8/10)\n    why: Less visual noise.')
    expect(rendered).toContain('- Avoids dense layouts. (3/10)')
    expect(rendered).not.toContain('Avoids dense layouts. (3/10)\n    why:')
  })

  test('mentions the ask_user exception only when the tool is available', () => {
    const propositions = [proposition('Prefers concise answers.', 0.8)]
    const withAskUser = renderUserModelPropositions(propositions, { askUserToolAvailable: true })
    const withoutAskUser = renderUserModelPropositions(propositions)
    expect(withAskUser).toContain('ask_user tool is the exception')
    expect(withoutAskUser).not.toContain('ask_user')
  })
})
