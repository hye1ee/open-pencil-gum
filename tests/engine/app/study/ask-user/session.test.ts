import { describe, expect, test } from 'bun:test'

import {
  ASK_USER_AGENT_INSTRUCTIONS,
  AskUserSession,
  LENCANVAS_ASK_USER_INSTRUCTIONS,
  formatAskUserLifecycleEvent
} from '@/app/study/ask-user'
import type { AskUserLifecycleEvent } from '@/app/study/ask-user'

describe('ask_user session', () => {
  test('blocks one tool call until the user answers it', async () => {
    const session = new AskUserSession()
    session.beginRequest('request-1')

    const result = session.ask({
      question: ' Which source type should I prioritize? ',
      options: ['Academic papers', 'Official sources', 'Recent news']
    })

    expect(session.snapshot().pendingQuestion).toMatchObject({
      requestId: 'request-1',
      sequence: 1,
      question: 'Which source type should I prioritize?'
    })
    expect(session.answer('Use official sources.', 'Official sources')).toBeTrue()
    expect(await result).toEqual({
      status: 'answered',
      questionId: expect.any(String),
      answer: 'Use official sources.',
      selectedOption: 'Official sources'
    })
    expect(session.snapshot().pendingQuestion).toBeNull()
  })

  test('allows multiple sequential questions but only one pending question', async () => {
    const session = new AskUserSession()
    session.beginRequest('request-2')

    const first = session.ask({
      question: 'What should I optimize first?',
      options: ['Travel time', 'Cost', 'Variety']
    })
    expect(() =>
      session.ask({
        question: 'Should I also compare prices?',
        options: ['Yes', 'No', 'Only major costs']
      })
    ).toThrow('another ask_user question is still waiting for an answer')
    session.answer('Optimize travel time.')
    await first

    const second = session.ask({
      question: 'Should I also compare prices?',
      options: ['Yes', 'No', 'Only major costs']
    })
    expect(session.snapshot().pendingQuestion).toMatchObject({
      requestId: 'request-2',
      sequence: 2,
      question: 'Should I also compare prices?'
    })
    session.answer('Yes, compare prices.')
    expect(await second).toMatchObject({
      status: 'answered',
      answer: 'Yes, compare prices.'
    })
  })

  test('resolves a pending tool call when its request is replaced', async () => {
    const session = new AskUserSession()
    session.beginRequest('old-request')
    const result = session.ask({
      question: 'Which direction should I take?',
      options: ['Option A', 'Option B', 'Option C']
    })

    session.beginRequest('new-request')

    expect(await result).toEqual({
      status: 'cancelled',
      questionId: expect.any(String),
      reason: 'request-replaced'
    })
    expect(session.snapshot()).toEqual({ requestId: 'new-request', pendingQuestion: null })
  })

  test('publishes host-neutral lifecycle events and instructions', async () => {
    const events: AskUserLifecycleEvent[] = []
    const session = new AskUserSession({ onEvent: (event) => events.push(event) })
    session.beginRequest('request-3')
    const result = session.ask({
      question: 'Which audience matters most?',
      options: ['New researchers', 'Experts', 'General readers']
    })
    session.answer('New researchers.')
    await result

    expect(events.map((event) => event.type)).toEqual([
      'request-started',
      'question-asked',
      'question-answered'
    ])
    expect(formatAskUserLifecycleEvent(events[1])).toContain('question=1 asked')
    expect(ASK_USER_AGENT_INSTRUCTIONS).toContain('exactly one concise, actionable question')
    expect(ASK_USER_AGENT_INSTRUCTIONS).toContain('exactly three')
    expect(ASK_USER_AGENT_INSTRUCTIONS).toContain('again later in the same request')
    expect(ASK_USER_AGENT_INSTRUCTIONS).toContain(
      'another independent user-specific decision remains unresolved'
    )
    expect(ASK_USER_AGENT_INSTRUCTIONS).not.toContain('materially change')
    expect(ASK_USER_AGENT_INSTRUCTIONS).toContain('priorities, success criteria')
    expect(ASK_USER_AGENT_INSTRUCTIONS).toContain(
      'Ask the highest-impact unresolved decision first'
    )
    expect(LENCANVAS_ASK_USER_INSTRUCTIONS).toContain('independent layers')
    expect(LENCANVAS_ASK_USER_INSTRUCTIONS).toContain('multiple sequential questions')
    expect(LENCANVAS_ASK_USER_INSTRUCTIONS).toContain('content before detailed structure')
  })

  test('rejects missing or duplicate answer options', () => {
    const session = new AskUserSession()
    session.beginRequest('request-4')

    expect(() =>
      session.ask({
        question: 'Which pace should I use?',
        options: ['Relaxed', 'Relaxed', 'Busy']
      })
    ).toThrow('ask_user requires exactly three distinct answer options')
  })
})
