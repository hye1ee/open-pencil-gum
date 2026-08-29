import { describe, expect, test } from 'bun:test'

import { ChatTurnGate } from '@/app/meta-agent/hosts/lenchat/gate'

describe('ChatTurnGate', () => {
  test('does not hold reasoning deltas when sequential review is disabled', async () => {
    const gate = new ChatTurnGate()
    gate.hold()

    expect(await gate.awaitResume('mid-thought')).toBe(true)
    gate.resume()
  })

  test('holds reasoning deltas, provider actions, and final output', async () => {
    const gate = new ChatTurnGate(true)
    gate.hold()

    let thoughtSettled = false
    const pendingThought = gate.awaitResume('mid-thought').then((allowed) => {
      thoughtSettled = true
      return allowed
    })
    await Promise.resolve()
    expect(thoughtSettled).toBe(false)
    gate.resume()
    expect(await pendingThought).toBe(true)

    gate.hold()
    const pendingAction = gate.awaitResume('before-action')
    gate.resume()
    expect(await pendingAction).toBe(true)

    gate.hold()
    const pendingOutput = gate.awaitResume('before-final-response')
    gate.resume()
    expect(await pendingOutput).toBe(true)
  })

  test('abandons a pending tool call when feedback requests a revision', async () => {
    const gate = new ChatTurnGate()
    gate.hold()

    const pending = gate.awaitResume('before-action')
    gate.abandon()
    expect(await pending).toBe(false)
  })

  test('abandons pending final output when feedback requests a revision', async () => {
    const gate = new ChatTurnGate()
    gate.hold()

    const pending = gate.awaitResume('before-final-response')
    gate.abandon()
    expect(await pending).toBe(false)
  })

  test('reviews reasoning chunks sequentially before abandoning the action', async () => {
    const gate = new ChatTurnGate(true)
    gate.hold()
    gate.deferAbandonAtCommit()

    const firstChunk = gate.awaitResume('mid-thought')
    gate.resume()
    expect(await firstChunk).toBe(true)

    gate.hold()
    const secondChunk = gate.awaitResume('mid-thought')
    gate.resume()
    expect(await secondChunk).toBe(true)

    expect(await gate.awaitResume('before-action')).toBe(false)
  })
})
