import { describe, expect, test } from 'bun:test'

import { normalizeParticipantId } from '@/app/study/survey/participant'

describe('participant id normalization', () => {
  test('lowercases and hyphenates spaces', () => {
    expect(normalizeParticipantId('  P 01  ')).toBe('p-01')
  })

  test('strips characters outside a-z 0-9 hyphen', () => {
    expect(normalizeParticipantId('참가자_P01!')).toBe('p01')
  })

  test('caps at 64 characters', () => {
    expect(normalizeParticipantId('a'.repeat(80))).toHaveLength(64)
  })

  test('returns empty for input with nothing usable', () => {
    expect(normalizeParticipantId('!!!')).toBe('')
    expect(normalizeParticipantId('')).toBe('')
  })
})
