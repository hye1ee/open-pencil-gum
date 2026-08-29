import { describe, expect, test } from 'bun:test'

import type { UIMessage } from 'ai'

import { composeChatTimeline, type MidRunUserMessage } from '@/app/ai/chat/timeline'

function message(id: string, role: 'user' | 'assistant', parts: string[]): UIMessage {
  return {
    id,
    role,
    parts: parts.map((text) => ({ type: 'text', text }))
  }
}

describe('composeChatTimeline', () => {
  test('places later assistant parts after the mid-run user message', () => {
    const messages = [
      message('request', 'user', ['Create a workshop landing page']),
      message('agent', 'assistant', ['first tool', 'second tool', 'final answer'])
    ]
    const feedback: MidRunUserMessage[] = [
      {
        id: 'feedback-1',
        text: 'I want a night mode workshop',
        anchorMessageId: 'agent',
        afterPartCount: 1
      }
    ]

    const timeline = composeChatTimeline(messages, feedback)

    expect(timeline.map((item) => item.message.id)).toEqual([
      'request',
      'agent:before-feedback-1',
      'feedback-1',
      'agent:after-1'
    ])
    expect(timeline[2]?.variant).toBe('additional-feedback')
    expect(timeline[3]?.message.parts).toEqual([
      { type: 'text', text: 'second tool' },
      { type: 'text', text: 'final answer' }
    ])
  })

  test('places feedback after a user request when no assistant part exists yet', () => {
    const messages = [message('request', 'user', ['Create a workshop landing page'])]
    const feedback: MidRunUserMessage[] = [
      {
        id: 'feedback-1',
        text: 'Use night mode',
        anchorMessageId: 'request',
        afterPartCount: null
      }
    ]

    expect(composeChatTimeline(messages, feedback).map((item) => item.message.id)).toEqual([
      'request',
      'feedback-1'
    ])
  })
})
