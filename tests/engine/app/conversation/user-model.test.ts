import { describe, expect, test } from 'bun:test'

import type { ConversationFeedbackItem, ConversationFeedbackNote } from '@/app/conversation/types'
import { conversationFeedbackBatch } from '@/app/conversation/user-model'
import { lenChatFeedbackNote } from '@/app/feedback-note/hosts/lenchat/note'

function note(feedbackItems: ConversationFeedbackItem[]): ConversationFeedbackNote {
  return {
    id: 'chat-note-1',
    messageId: 'message-1',
    originStep: 3,
    originChunk: 2,
    topic: 'source-selection',
    cue: 'The agent will prioritize official sources.',
    reasoningEvidence: 'I will begin with official documentation.',
    relationship: 'alignment',
    representation: { type: 'text' },
    representationGoal: 'Confirm the source strategy.',
    propositionIds: ['p1'],
    status: feedbackItems.length > 0 ? 'answered' : 'continued',
    reply: feedbackItems.map((item) => item.text).join('\n') || null,
    feedbackItems,
    createdAt: 1
  }
}

describe('LenChat feedback host boundary', () => {
  test('preserves each annotation selection in User Model feedback', () => {
    const feedbackItems: ConversationFeedbackItem[] = [
      {
        id: 'feedback-1',
        selection: { type: 'region', x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        text: 'Use the comparison on the left.',
        createdAt: 10
      },
      {
        id: 'feedback-2',
        selection: {
          type: 'text',
          source: 'reasoning',
          text: 'official documentation',
          start: 18,
          end: 40
        },
        text: 'Include independent evaluations as well.',
        createdAt: 11
      }
    ]

    const batch = conversationFeedbackBatch(note(feedbackItems), feedbackItems)

    expect(batch.notes[0]?.resolution).toBe('explicit-feedback')
    expect(batch.notes[0]?.feedbackItems).toEqual([
      {
        id: 'feedback-1',
        selection: { type: 'region', x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        feedback: 'Use the comparison on the left.',
        createdAt: 10
      },
      {
        id: 'feedback-2',
        selection: {
          type: 'text',
          source: 'reasoning',
          text: 'official documentation',
          start: 18,
          end: 40
        },
        feedback: 'Include independent evaluations as well.',
        createdAt: 11
      }
    ])
  })

  test('maps the UI record back to the shared Feedback Note contract', () => {
    const shared = lenChatFeedbackNote(note([]))

    expect(shared.text).toBe('The agent will prioritize official sources.')
    expect(shared.evidenceFromReasoning).toBe('I will begin with official documentation.')
    expect(shared.nodeId).toBeNull()
    expect(shared.propositionIds).toEqual(['p1'])
  })
})
