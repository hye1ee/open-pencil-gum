import { describe, expect, test } from 'bun:test'

import { ChatTurnGate } from '@/app/meta-agent-chat/gate'

describe('ChatTurnGate', () => {
  test('holds provider actions and final output, but not incomplete thought', async () => {
    const gate = new ChatTurnGate()
    gate.hold()

    expect(await gate.awaitResume('mid-thought')).toBe(true)
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
})
