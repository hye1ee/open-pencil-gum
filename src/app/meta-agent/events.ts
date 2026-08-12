type NodeReplacedObserver = (oldId: string, newId: string) => void

let onNodeReplaced: NodeReplacedObserver | null = null

/** Keeps the AI tool adapter independent of the meta-agent model setup while
 * still letting a render replacement preserve marks on the old node. */
export function setMetaAgentNodeReplacedObserver(observer: NodeReplacedObserver): void {
  onNodeReplaced = observer
}

export function notifyMetaAgentNodeReplaced(oldId: string, newId: string): void {
  if (oldId === newId) return
  onNodeReplaced?.(oldId, newId)
}

/** The directive the agent is building to, owned by the transport and reported
 * here for the judgment to read. See `JudgeInput.plan`. */
let agentPlan: string | null = null

/** Called with null at the top of every turn, restarts included: the transport
 * rebuilds the plan at step 0, so anything held in between is a finished build. */
export function noteAgentPlan(plan: string | null): void {
  agentPlan = plan
}

export function currentPlan(): string | null {
  return agentPlan
}
