import { describe, expect, test } from 'bun:test'

import type { UIMessage } from 'ai'

import { createChatContext, summarizeConversation } from '@/app/meta-agent-chat/context'

const messages: UIMessage[] = [
  { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Compare these approaches.' }] },
  {
    id: 'assistant-1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Here is the comparison.' }]
  }
]

describe('chat monitoring context', () => {
  test('summarizes the transcript without an editor store', () => {
    expect(summarizeConversation(messages)).toContain('user: Compare these approaches.')
    expect(summarizeConversation(messages)).toContain('assistant: Here is the comparison.')
  })

  test('keeps actions and state behind the shared read-only contract', () => {
    const context = createChatContext({
      messages,
      userRequest: 'Compare these approaches.',
      propositions: [],
      actions: ['google_search']
    })

    expect(context.domain).toBe('chat')
    expect(context.summarizeState()).toContain('Here is the comparison.')
    expect(context.actionsSoFar()).toEqual(['google_search'])
  })
})
