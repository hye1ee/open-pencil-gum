import { describe, expect, test } from 'bun:test'

import { runMetaAgent } from '@/app/meta-agent/core/runtime'
import type { MetaAgentModelCaller, MetaAgentRuntimeInput } from '@/app/meta-agent/core/runtime'

describe('Meta Agent runtime', () => {
  test('passes host-composed prompts to the model and normalizes its first decision', async () => {
    let received: MetaAgentRuntimeInput | null = null
    const caller: MetaAgentModelCaller = {
      async generate(input) {
        received = input
        return [
          { toolName: 'create_conflict_feedback_note', input: { topic: 'scope' } },
          { toolName: 'create_uncovered_feedback_note', input: { topic: 'ignored' } }
        ]
      }
    }

    const decisions = await runMetaAgent(
      { system: 'shared system plus domain profile', prompt: 'host-rendered context' },
      caller
    )

    expect(received).toEqual({
      system: 'shared system plus domain profile',
      prompt: 'host-rendered context'
    })
    expect(decisions).toEqual([{ relationship: 'conflict', payload: { topic: 'scope' } }])
  })

  test('returns no decision for prose-only or unknown tool output', async () => {
    const caller: MetaAgentModelCaller = {
      async generate() {
        return [{ toolName: 'unrelated_tool', input: {} }]
      }
    }

    expect(await runMetaAgent({ system: 'system', prompt: 'prompt' }, caller)).toEqual([])
  })
})
