import { describe, expect, test } from 'bun:test'

import type { UIMessage } from 'ai'

import {
  composeChatTimeline,
  type ChatTimelineInsertion,
  type MidRunUserMessage
} from '@/app/ai/chat/timeline'

function messageItems<Value>(timeline: ReturnType<typeof composeChatTimeline<Value>>) {
  return timeline.filter((item) => item.kind === 'message')
}

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

    expect(messageItems(timeline).map((item) => item.message.id)).toEqual([
      'request',
      'agent:before-feedback-1',
      'feedback-1',
      'agent:after-1'
    ])
    const feedbackItem = timeline[2]
    const finalItem = timeline[3]
    expect(feedbackItem?.kind === 'message' ? feedbackItem.variant : null).toBe(
      'additional-feedback'
    )
    expect(finalItem?.kind === 'message' ? finalItem.message.parts : null).toEqual([
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

    expect(
      messageItems(composeChatTimeline(messages, feedback)).map((item) => item.message.id)
    ).toEqual(['request', 'feedback-1'])
  })

  test('interleaves reasoning reviews with the tool parts they gate', () => {
    const messages = [
      message('request', 'user', ['Create a button']),
      message('agent', 'assistant', ['first tool', 'second tool', 'final answer'])
    ]
    const reviews: ChatTimelineInsertion<string>[] = [
      {
        key: 'review-1',
        anchorMessageId: 'agent',
        afterPartCount: 0,
        value: 'reasoning chunk 1'
      },
      {
        key: 'review-2',
        anchorMessageId: 'agent',
        afterPartCount: 1,
        value: 'reasoning chunk 2'
      }
    ]

    const timeline = composeChatTimeline(messages, [], reviews)

    expect(
      timeline.map((item) =>
        item.kind === 'message' ? item.message.parts[0] : { type: 'review', text: item.value }
      )
    ).toEqual([
      { type: 'text', text: 'Create a button' },
      { type: 'review', text: 'reasoning chunk 1' },
      { type: 'text', text: 'first tool' },
      { type: 'review', text: 'reasoning chunk 2' },
      { type: 'text', text: 'second tool' }
    ])
    const finalMessage = timeline.at(-1)
    expect(finalMessage?.kind === 'message' ? finalMessage.message.parts : null).toEqual([
      { type: 'text', text: 'second tool' },
      { type: 'text', text: 'final answer' }
    ])
  })
})
