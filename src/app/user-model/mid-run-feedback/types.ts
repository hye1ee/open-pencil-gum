/**
 * Feedback the user typed into the chat while the task agent was still
 * executing (the mid-run intervention channel). Collected per step boundary
 * in the ask-user study condition, where the agent stops asking questions
 * after the opening exchange and the user steers it with free messages.
 */
export interface UserModelMidRunFeedbackBatch {
  requestId: string
  request: string
  /** The step whose boundary drained these messages. */
  stepNumber: number
  /** Mutating tool calls executed so far, as "tool → nodeId" lines. Agent
   * context for the reviser, not user evidence. */
  executedActions: readonly string[]
  /** The user's own words — the evidence. */
  messages: readonly string[]
}
