import { valibotSchema } from '@ai-sdk/valibot'
import { tool } from 'ai'
import * as v from 'valibot'

const relationSchema = v.picklist(['conflict', 'alignment', 'unknown'])

/**
 * How strongly, never which way — `relation` already says that.
 *
 * A picklist rather than a number with a range, so the provider rejects
 * anything else before it reaches us and the model gets to try again. Asking for
 * a signed −5…+5 instead put a zero in the middle of the scale that meant
 * nothing, and left the sign free to disagree with the relation beside it.
 *
 * The digits are strings because Gemini only takes `enum` on a string field.
 * Sent as numbers, the whole function declaration is refused before the call is
 * ever made — `Invalid value at parameters.properties[5].value.enum[0]
 * (TYPE_STRING)` — which silently costs every mark in the run, not just the
 * strength. `readAlignment` parses the digit back out.
 *
 * Optional because an `unknown` has no strength to give. It rests on nothing we
 * believe, so there is no fit to rate; the only thing a number there could mean
 * is how much the blind spot matters, which is a second meaning in one field and
 * was read by nothing. A `conflict` or an `alignment` that leaves it out is
 * rejected rather than defaulted.
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
 * There is no delete.
 *
 * A mark came off two ways: the meta-agent deleted it, or the change it warned
 * about landed and stood. Measured over several runs, deletion fired seven to
 * eight times a turn and almost never for a decision actually taken back — it
 * fired because the thinking had moved to another subject, which is not the
 * same thing. What that cost: badges vanishing under the pointer mid-read,
 * marks gone before anyone could finish the sentence, and a mark the person
 * never got to answer being counted as one they accepted.
 *
 * Two ways off remain, and neither is the model changing its mind: the change
 * landed and nobody stopped it, or the person dismissed the mark themselves. A
 * withdrawal value existed for a while and was removed — it left the mark in
 * `answerable`, so the user model still counted a belief this person had watched
 * break, and it bought only that the run stopped being held.
 */
