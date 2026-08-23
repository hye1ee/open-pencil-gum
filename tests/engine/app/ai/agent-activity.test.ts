import { describe, expect, test } from 'bun:test'

import {
  agentActivity,
  beginMetaAgentActivity,
  metaAgentIsWorking
} from '@/app/ai/chat/agent-activity'

describe('agent activity', () => {
  test('keeps Meta Agent activity visible until every overlapping task finishes', () => {
    agentActivity.metaAgentTasks = 0
    const finishFirst = beginMetaAgentActivity()
    const finishSecond = beginMetaAgentActivity()
    expect(metaAgentIsWorking()).toBe(true)
    expect(agentActivity.metaAgentTasks).toBe(2)

    finishFirst()
    expect(metaAgentIsWorking()).toBe(true)
    finishFirst()
    expect(agentActivity.metaAgentTasks).toBe(1)

    finishSecond()
    expect(metaAgentIsWorking()).toBe(false)
  })
})
