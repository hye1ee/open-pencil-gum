import { valibotSchema } from '@ai-sdk/valibot'
import { tool } from 'ai'
import * as v from 'valibot'

const shared = {
  node_id: v.nullable(v.string()),
  topic: v.string(),
  text: v.string(),
  evidence_from_reasoning: v.string()
}

/**
 * One instruction for each step between doing what the agent reasoned and doing
 * what the proposition says. The model writes all five and picks none — the
 * person chooses, and a mark opens in the middle.
 */
const feedbackContentsSchema = v.object({
  as_reasoned: v.string(),
  mostly_reasoned: v.string(),
  halfway: v.string(),
  mostly_user_model: v.string(),
  as_user_model: v.string()
})

export const MARK_TOOLS = {
  generate_related_mark: tool({
    description:
      'Create one genuinely new mark only when following the reasoning and following the proposition would produce meaningfully different actions or visible results. If both ends produce substantially the same result, adjective changes do not create a valid range: call no tool. Never repeat a listed decision.',
    inputSchema: valibotSchema(
      v.object({
        ...shared,
        evidence_from_user_model: v.string(),
        feedback_contents: feedbackContentsSchema
      })
    )
  }),
  generate_unrelated_mark: tool({
    description:
      "Create one genuinely new mark on a design decision that neither the user's current request nor any proposition covers. Never ask about a choice the request already made, even if the user model is silent or disagrees. Never repeat a standing or retired decision.",
    inputSchema: valibotSchema(
      v.object({
        ...shared,
        evidence_from_user_model: v.null(),
        suggested_feedback: v.string()
      })
    )
  }),
  update_mark: tool({
    description:
      'Update or revive a mark only when the old and new reasoning ask the same user decision and could be answered by the same feedback instruction. A shared node, nearby timing, or available retired id is not enough; generate a new mark for a different question. Preserve whether reasoning is considering or intending.',
    inputSchema: valibotSchema(
      v.object({
        id: v.string(),
        ...shared,
        node_id: v.optional(v.nullable(v.string())),
        evidence_from_user_model: v.nullable(v.string()),
        feedback_contents: v.nullable(feedbackContentsSchema),
        suggested_feedback: v.nullable(v.string())
      })
    )
  })
}

/**
 * There is no delete. Measured, the model fired it seven or eight times a turn
 * and almost never for a decision actually taken back, so badges vanished
 * mid-read and unanswered marks were counted as accepted. A mark comes off two
 * ways now: the change lands and stands, or the user dismisses it.
 */
