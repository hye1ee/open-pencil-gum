import { reactive } from 'vue'

interface AgentActivityState {
  metaAgentTasks: number
}

export const agentActivity: AgentActivityState = reactive({
  metaAgentTasks: 0
})

export function beginMetaAgentActivity(): () => void {
  agentActivity.metaAgentTasks++
  let finished = false
  return () => {
    if (finished) return
    finished = true
    agentActivity.metaAgentTasks = Math.max(0, agentActivity.metaAgentTasks - 1)
  }
}

export function metaAgentIsWorking(): boolean {
  return agentActivity.metaAgentTasks > 0
}
