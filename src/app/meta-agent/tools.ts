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
      'Create one genuinely new mark only when a proposition covers the decision and a meaningful steering range exists between it and the reasoning. Never when they say the same thing or when the decision is already listed.',
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
      'Update a standing mark, or revive a retired mark with the same id when the decision returns. Send whichever of the two payloads the decision now has. Preserve whether the reasoning is only considering or actually intending a choice.',
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
