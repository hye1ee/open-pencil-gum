import { describe, expect, test } from 'bun:test'

import { simulateReadableStream, streamText } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

import { ChatTurnGate } from '@/app/meta-agent/hosts/lenchat/gate'
import { withChatModelTrace } from '@/app/meta-agent/hosts/lenchat/model-trace'
import type { ChatReasoningObserver } from '@/app/meta-agent/hosts/lenchat/types'

function testModel() {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'reasoning-start', id: 'reasoning-1' },
          { type: 'reasoning-delta', id: 'reasoning-1', delta: 'I will compare sources.' },
          { type: 'reasoning-end', id: 'reasoning-1' },
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'Final answer' },
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 2, text: 1, reasoning: 1 }
            }
          }
        ]
      })
    })
  })
}

function providerToolModel() {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'reasoning-start', id: 'reasoning-1' },
          { type: 'reasoning-delta', id: 'reasoning-1', delta: 'I will search.' },
          { type: 'reasoning-end', id: 'reasoning-1' },
          {
            type: 'tool-call',
            toolCallId: 'search-1',
            toolName: 'server:google_search',
            input: '{}',
            providerExecuted: true,
            dynamic: true
          },
          {
            type: 'tool-result',
            toolCallId: 'search-1',
            toolName: 'server:google_search',
            result: { sources: ['example'] },
            dynamic: true
          },
          { type: 'reasoning-start', id: 'reasoning-2' },
          { type: 'reasoning-delta', id: 'reasoning-2', delta: 'I will use the results.' },
          { type: 'reasoning-end', id: 'reasoning-2' },
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'Final answer after search' },
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 3, text: 1, reasoning: 2 }
            }
          }
        ]
      })
    })
  })
}

describe('LenChat model trace', () => {
  test('holds final output after reasoning until the feedback gate resumes', async () => {
    const gate = new ChatTurnGate()
    gate.hold()
    let endReasoning: (() => void) | undefined
    const reasoningEnded = new Promise<void>((resolve) => {
      endReasoning = resolve
    })
    const observed: string[] = []
    const observer: ChatReasoningObserver = {
      start: () => undefined,
      chunk: (_streamId, chunk) => observed.push(chunk),
      end: () => endReasoning?.(),
      settled: async () => undefined
    }
    const result = streamText({
      model: withChatModelTrace(testModel(), {
        observer,
        awaitReasoningReviews: true,
        reasoningMode: () => ({ observe: true, reveal: true }),
        awaitResume: (point) => gate.awaitResume(point)
      }),
      prompt: 'Compare sources.'
    })
    const parts: string[] = []
    let finished = false
    const consume = (async () => {
      for await (const part of result.fullStream) parts.push(part.type)
      finished = true
    })()

    await reasoningEnded
    await Promise.resolve()
    expect(observed).toEqual(['I will compare sources.'])
    expect(parts).toContain('reasoning-delta')
    expect(parts).not.toContain('text-delta')
    expect(finished).toBe(false)

    gate.resume()
    await consume
    expect(parts).toContain('text-delta')
    expect(finished).toBe(true)
  })

  test('hides reasoning and bypasses Meta Agent observation during a silent retry', async () => {
    const gate = new ChatTurnGate()
    gate.hold()
    let observations = 0
    const observer: ChatReasoningObserver = {
      start: () => observations++,
      chunk: () => observations++,
      end: () => observations++,
      settled: async () => undefined
    }
    const result = streamText({
      model: withChatModelTrace(testModel(), {
        observer,
        awaitReasoningReviews: true,
        reasoningMode: () => ({ observe: false, reveal: false }),
        awaitResume: (point) => gate.awaitResume(point)
      }),
      prompt: 'Compare sources again.'
    })
    const parts: string[] = []
    for await (const part of result.fullStream) parts.push(part.type)

    expect(observations).toBe(0)
    expect(parts.some((type) => type.startsWith('reasoning-'))).toBe(false)
    expect(parts).toContain('text-delta')
  })

  test('holds final output when feedback arrives after a provider-executed tool', async () => {
    const gate = new ChatTurnGate()
    let reasoningEnds = 0
    let secondReasoningEnded: (() => void) | undefined
    const secondReasoning = new Promise<void>((resolve) => {
      secondReasoningEnded = resolve
    })
    const observer: ChatReasoningObserver = {
      start: () => undefined,
      chunk: () => undefined,
      end: () => {
        reasoningEnds += 1
        if (reasoningEnds !== 2) return
        gate.hold()
        secondReasoningEnded?.()
      },
      settled: async () => undefined
    }
    const result = streamText({
      model: withChatModelTrace(providerToolModel(), {
        observer,
        awaitReasoningReviews: true,
        reasoningMode: () => ({ observe: true, reveal: true }),
        awaitResume: (point) => gate.awaitResume(point)
      }),
      prompt: 'Search before answering.'
    })
    const parts: string[] = []
    let finished = false
    const consume = (async () => {
      for await (const part of result.fullStream) parts.push(part.type)
      finished = true
    })()

    await secondReasoning
    await Promise.resolve()
    expect(parts).toContain('tool-call')
    expect(parts).not.toContain('text-delta')
    expect(finished).toBe(false)

    gate.resume()
    await consume
    expect(parts).toContain('text-delta')
    expect(finished).toBe(true)
  })
})
