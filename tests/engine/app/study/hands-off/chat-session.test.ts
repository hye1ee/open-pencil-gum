import { describe, expect, test } from 'bun:test'

import { createHandsOffChatSession } from '@/app/study/hands-off/chat-session'

describe('hands-off chat session', () => {
  test('collects reasoning chunks passively while the agent runs', () => {
    const session = createHandsOffChatSession()
    session.beginRun('Plan a trip')
    session.observer.start(1)
    session.observer.chunk(1, 'First thought.', 'First thought.')
    session.observer.chunk(1, '   ', 'First thought.')
    session.observer.chunk(1, 'Second thought.', 'First thought. Second thought.')
    expect(session.reasoningBlocks.value).toEqual([
      { id: 'hands-off-reasoning-1-1', streamId: 1, chunkIndex: 1, text: 'First thought.' },
      { id: 'hands-off-reasoning-1-2', streamId: 1, chunkIndex: 2, text: 'Second thought.' }
    ])
    expect(session.phase.value).toBe('agent-running')
  })

  test('ignores chunks outside an active run', () => {
    const session = createHandsOffChatSession()
    session.observer.start(1)
    session.observer.chunk(1, 'Stray reasoning.', 'Stray reasoning.')
    expect(session.reasoningBlocks.value).toHaveLength(0)
  })

  test('walks the phases in order and reveals the answer text', () => {
    const session = createHandsOffChatSession()
    expect(session.phase.value).toBe('idle')
    session.beginRun('Plan a trip')
    expect(session.phase.value).toBe('agent-running')
    session.completeAgentRun()
    expect(session.phase.value).toBe('annotating-reasoning')
    session.finishReasoningAnnotation('The final answer.')
    expect(session.phase.value).toBe('annotating-final-answer')
    expect(session.finalAnswerText.value).toBe('The final answer.')
    session.finishFinalAnswerAnnotation()
    expect(session.phase.value).toBe('completed')
    // Out-of-order calls stay ignored.
    session.completeAgentRun()
    expect(session.phase.value).toBe('completed')
  })

  test('accumulates annotations only during an annotation phase', () => {
    const session = createHandsOffChatSession()
    session.beginRun('Plan a trip')
    session.observer.start(1)
    session.observer.chunk(1, 'A thought.', 'A thought.')
    session.addAnnotation({
      streamId: 1,
      chunkIndex: 1,
      selectedText: 'thought',
      startOffset: 2,
      endOffset: 9,
      polarity: 'liked'
    })
    expect(session.annotations.value).toHaveLength(0)

    session.completeAgentRun()
    session.addAnnotation({
      streamId: 1,
      chunkIndex: 1,
      selectedText: 'thought',
      startOffset: 2,
      endOffset: 9,
      polarity: 'liked'
    })
    session.finishReasoningAnnotation('The answer.')
    session.addAnnotation({
      streamId: 0,
      chunkIndex: 0,
      selectedText: 'answer',
      startOffset: 4,
      endOffset: 10,
      polarity: 'disliked'
    })
    expect(session.annotations.value).toEqual([
      expect.objectContaining({ phase: 'reasoning', polarity: 'liked', stepNumber: null }),
      expect.objectContaining({ phase: 'final-output', polarity: 'disliked' })
    ])
    expect(session.isAnnotationPending()).toBeTrue()
    session.finishFinalAnswerAnnotation()
    expect(session.isAnnotationPending()).toBeFalse()
  })

  test('reset clears everything back to idle', () => {
    const session = createHandsOffChatSession()
    session.beginRun('Plan a trip')
    session.observer.start(1)
    session.observer.chunk(1, 'A thought.', 'A thought.')
    session.completeAgentRun()
    session.reset()
    expect(session.phase.value).toBe('idle')
    expect(session.reasoningBlocks.value).toHaveLength(0)
    expect(session.annotations.value).toHaveLength(0)
    expect(session.finalAnswerText.value).toBe('')
  })
})
