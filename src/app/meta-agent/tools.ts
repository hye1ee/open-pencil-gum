import { valibotSchema } from '@ai-sdk/valibot'
import { tool } from 'ai'
import * as v from 'valibot'

const relationSchema = v.picklist(['conflict', 'alignment', 'unknown'])

/**
 * How strongly, never which way — `relation` already says that. A picklist so
 * the provider rejects anything else, and strings because Gemini refuses a
 * numeric `enum` on the whole declaration. Optional: an `unknown` rests on no
 * proposition, so it has no fit to rate. `readRating` parses the digit back out.
 */
const strengthSchema = v.optional(v.picklist(['1', '2', '3', '4', '5']))
const evidenceSchema = {
  evidence_from_reasoning: v.string(),
  evidence_from_user_model: v.nullable(v.string())
}

export const MARK_TOOLS = {
  generate_mark: tool({
    description:
      'Create one genuinely new mark. Never for a decision already listed as standing or retired.',
    inputSchema: valibotSchema(
      v.object({
        node_id: v.nullable(v.string()),
        relation: relationSchema,
        text: v.string(),
        ...evidenceSchema,
        strength: strengthSchema
      })
    )
  }),
  update_mark: tool({
    description:
      'Update a standing mark, or revive a retired mark with the same id when the decision returns. Preserve whether the reasoning is only considering or actually intending a choice.',
    inputSchema: valibotSchema(
      v.object({
        id: v.string(),
        node_id: v.optional(v.nullable(v.string())),
        relation: relationSchema,
        text: v.string(),
        ...evidenceSchema,
        strength: strengthSchema
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
