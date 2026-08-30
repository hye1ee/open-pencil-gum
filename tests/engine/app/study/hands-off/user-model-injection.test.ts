import { describe, expect, test } from 'bun:test'

import { parseUserModelReplacementJson } from '@/app/study/hands-off/user-model-injection'

describe('hands-off user model injection', () => {
  test('accepts the persisted file shape and fills defaults', () => {
    const parsed = parseUserModelReplacementJson(
      JSON.stringify({ propositions: [{ text: 'Prefers trains.' }] })
    )
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({
      id: 'hands-off-injected-1',
      text: 'Prefers trains.',
      confidence: 0.78,
      decay: 0,
      rationale: null,
      embedding: [],
      originalText: 'Prefers trains.',
      observations: 1,
      revisions: 0
    })
  })

  test('accepts a bare array and keeps provided fields', () => {
    const parsed = parseUserModelReplacementJson(
      JSON.stringify([
        {
          id: 'proposition-7',
          text: 'Prefers muted palettes.',
          confidence: 0.4,
          rationale: 'Stated directly.',
          embedding: [0.1, 0.2]
        }
      ])
    )
    expect(parsed[0]).toMatchObject({
      id: 'proposition-7',
      confidence: 0.4,
      rationale: 'Stated directly.',
      embedding: [0.1, 0.2]
    })
  })

  test('rejects invalid input with descriptive errors', () => {
    expect(() => parseUserModelReplacementJson('not json')).toThrow('Not valid JSON.')
    expect(() => parseUserModelReplacementJson('{"foo": 1}')).toThrow(
      'Expected an array of propositions'
    )
    expect(() => parseUserModelReplacementJson('[]')).toThrow('empty')
    expect(() => parseUserModelReplacementJson('[{"confidence": 0.5}]')).toThrow(
      'missing a non-empty "text" field'
    )
    expect(() => parseUserModelReplacementJson('[42]')).toThrow('must be an object')
  })
})
