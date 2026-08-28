import { describe, expect, test } from 'bun:test'

import type { UIMessage } from 'ai'

import { createChatMonitor } from '@/app/meta-agent/hosts/lenchat/monitor'
import type { MetaAgentDecision, MetaAgentRuntimeInput } from '@/app/meta-agent/core/runtime'

const messages: UIMessage[] = [
  { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Compare the options.' }] }
]

type ChatMetaAgentReviewResult = MetaAgentDecision['relationship'] | 'skip'

function uncoveredTextDecision(topic = 'evidence-strategy'): MetaAgentDecision {
  return {
    relationship: 'uncovered',
    payload: {
      topic,
      representation_type: 'text',
      code_visual_type: null,
      code_visual_brief: null,
      image_type: null,
      image_prompt: null,
      representation_goal: 'Review the source policy before the search proceeds.',
      cue_segments: [
        {
          text: 'The agent plans to prioritize official sources.',
          source: 'reasoning',
          evidence_quote: 'I will prioritize official sources.',
          proposition_id: null
        }
      ],
      node_id: null,
      evidence_from_reasoning: 'I will prioritize official sources.',
      proposition_ids: []
    }
  }
}

describe('LenChat shared Meta Agent monitor', () => {
  test('reviews each reasoning delta and publishes validated notes', async () => {
    const calls: MetaAgentRuntimeInput[] = []
    const chunks: string[] = []
    const chunkLocations: string[] = []
    const reviews: ChatMetaAgentReviewResult[] = []
    const notes: string[] = []
    const activity: boolean[] = []
    const monitor = createChatMonitor({
      getContext: () => ({
        messages,
        request: 'Compare the options.',
        propositions: [],
        completedActions: ['google_search']
      }),
      onReasoningChunk: (streamId, chunkIndex, chunk) => {
        chunks.push(chunk)
        chunkLocations.push(`${streamId}:${chunkIndex}`)
      },
      run: async (input) => {
        calls.push(input)
        return calls.length === 1 ? [uncoveredTextDecision()] : []
      },
      onActivity: (active) => activity.push(active),
      onNote: (note) => notes.push(note.topic),
      onReview: (review) => reviews.push(review.decision?.relationship ?? 'skip')
    })

    monitor.observer.start(7)
    monitor.observer.chunk(
      7,
      'I will prioritize official sources.',
      'I will prioritize official sources.'
    )
    monitor.observer.chunk(
      7,
      ' Then compare recency.',
      'I will prioritize official sources. Then compare recency.'
    )
    monitor.observer.end(7, 'I will prioritize official sources. Then compare recency.')
    await monitor.observer.settled(7)

    expect(chunks).toEqual(['I will prioritize official sources.', ' Then compare recency.'])
    expect(chunkLocations).toEqual(['7:1', '7:2'])
    expect(calls).toHaveLength(2)
    expect(calls[0]?.system).toContain('A conversational agent has no canvas node')
    expect(calls[0]?.prompt).toContain('REASONING CHUNK\nI will prioritize official sources.')
    expect(calls[0]?.prompt).toContain('COMPLETED ACTIONS\ngoogle_search')
    expect(calls[1]?.prompt).toContain('REASONING CHUNK\n Then compare recency.')
    expect(calls[1]?.prompt).not.toContain(
      'REASONING CHUNK\nI will prioritize official sources. Then compare recency.'
    )
    expect(reviews).toEqual(['uncovered', 'skip'])
    expect(notes).toEqual(['evidence-strategy'])
    expect(activity).toEqual([true, false])
  })

  test('rejects a note whose reasoning cue is not anchored in the delta', async () => {
    const notes: string[] = []
    const monitor = createChatMonitor({
      getContext: () => ({
        messages,
        request: 'Compare the options.',
        propositions: [],
        completedActions: []
      }),
      onReasoningChunk: () => undefined,
      run: async () => [uncoveredTextDecision()],
      onNote: (note) => notes.push(note.topic)
    })

    monitor.observer.start(9)
    monitor.observer.chunk(9, 'I will use recent sources.', 'I will use recent sources.')
    monitor.observer.end(9, 'I will use recent sources.')
    await monitor.observer.settled(9)

    expect(notes).toEqual([])
  })

  test('does not publish an old review after reset', async () => {
    let release: ((decisions: MetaAgentDecision[]) => void) | undefined
    const reviews: ChatMetaAgentReviewResult[] = []
    const monitor = createChatMonitor({
      getContext: () => ({
        messages,
        request: 'Compare the options.',
        propositions: [],
        completedActions: []
      }),
      onReasoningChunk: () => undefined,
      run: () =>
        new Promise((resolve) => {
          release = resolve
        }),
      onReview: (review) => reviews.push(review.decision?.relationship ?? 'skip')
    })

    monitor.observer.start(8)
    monitor.observer.chunk(8, 'I will choose one.', 'I will choose one.')
    await Promise.resolve()
    monitor.reset()
    release?.([])
    await Promise.resolve()

    expect(reviews).toEqual([])
  })
})
