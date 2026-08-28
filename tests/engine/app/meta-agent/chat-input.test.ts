import { describe, expect, test } from 'bun:test'

import type { UIMessage } from 'ai'

import {
  CHAT_FEEDBACK_NOTE_SYSTEM,
  renderChatFeedbackNotePrompt
} from '@/app/meta-agent/domains/chat/prompt'
import {
  buildLenChatFeedbackNoteInput,
  summarizeLenChatConversation
} from '@/app/meta-agent/hosts/lenchat/input'
import type { ChatProposition } from '@/app/user-model-chat/types'

const messages: UIMessage[] = [
  { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Compare these approaches.' }] },
  {
    id: 'assistant-1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'I will compare their evidence and trade-offs.' }]
  },
  { id: 'assistant-tool', role: 'assistant', parts: [] }
]

function proposition(id: string, confidence: number): ChatProposition {
  return {
    id,
    text: `Preference ${id}`,
    confidence,
    decay: 0.25,
    reasoning: '',
    rationale: `Reason ${id}`,
    rationaleGrounds: null,
    rationaleFrom: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    observations: 1,
    embedding: [],
    originalText: `Preference ${id}`,
    originalEmbedding: [],
    revisions: 0
  }
}

describe('LenChat Meta Agent input', () => {
  test('summarizes text and retained tool activity without editor state', () => {
    const summary = summarizeLenChatConversation(messages)

    expect(summary).toContain('user: Compare these approaches.')
    expect(summary).toContain('assistant: I will compare their evidence and trade-offs.')
    expect(summary).toContain('assistant: (tool activity)')
  })

  test('adapts conversation state to the shared Meta Agent contract', () => {
    const input = buildLenChatFeedbackNoteInput({
      messages,
      request: 'Compare these approaches.',
      reasoning: 'I will prioritize peer-reviewed evidence.',
      propositions: [proposition('shown', 0.8), proposition('withheld', 0.2)],
      completedActions: ['google_search']
    })

    expect(input.plan).toBeNull()
    expect(input.reasoning).toBe('I will prioritize peer-reviewed evidence.')
    expect(input.completedActions).toEqual(['google_search'])
    expect(input.propositions.map((item) => [item.id, item.shownToAgent])).toEqual([
      ['shown', true],
      ['withheld', false]
    ])
  })

  test('renders general Chat context with all representation choices and no canvas anchor', () => {
    const input = buildLenChatFeedbackNoteInput({
      messages,
      request: 'Compare these approaches.',
      reasoning: 'I will prioritize peer-reviewed evidence.',
      propositions: [proposition('evidence', 0.8)],
      completedActions: ['google_search']
    })
    const prompt = renderChatFeedbackNotePrompt(input)

    expect(prompt).toContain('CONVERSATION\nuser: Compare these approaches.')
    expect(prompt).toContain('COMPLETED ACTIONS\ngoogle_search')
    expect(prompt).toContain('REASONING CHUNK\nI will prioritize peer-reviewed evidence.')
    expect(prompt).toContain('evidence (0.80): Preference evidence')
    expect(prompt).not.toContain('CANVAS')
    expect(CHAT_FEEDBACK_NOTE_SYSTEM).toContain('Always set node_id to null')
    expect(CHAT_FEEDBACK_NOTE_SYSTEM).toContain('text: the decision is primarily semantic')
    expect(CHAT_FEEDBACK_NOTE_SYSTEM).toContain('code-visual: structure, relationships')
    expect(CHAT_FEEDBACK_NOTE_SYSTEM).toContain('image: the visual subject itself')
  })
})
