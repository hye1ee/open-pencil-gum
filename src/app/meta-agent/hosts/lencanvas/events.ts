/** The directive the agent is building to, owned by the transport and reported
 * here for Feedback Note generation to read. */
let agentPlan: string | null = null

/** Called with null at the top of every turn, restarts included: the transport
 * rebuilds the plan at step 0, so anything held in between is a finished build. */
export function noteAgentPlan(plan: string | null): void {
  agentPlan = plan
}

export function currentPlan(): string | null {
  return agentPlan
}
