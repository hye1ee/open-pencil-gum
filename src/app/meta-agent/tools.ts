import { valibotSchema } from '@ai-sdk/valibot'
import { tool } from 'ai'
import * as v from 'valibot'

const relationSchema = v.picklist(['conflict', 'unknown'])
const evidenceSchema = {
  evidence_from_reasoning: v.string(),
  evidence_from_user_model: v.nullable(v.string())
}

export const MARK_TOOLS = {
  generate_mark: tool({
    description:
      'Create one genuinely new conflict or unknown mark. Never call for support/alignment or for a concern already listed as standing/retired.',
    inputSchema: valibotSchema(
      v.object({
        node_id: v.nullable(v.string()),
        relation: relationSchema,
        text: v.string(),
        ...evidenceSchema,
        importance: v.number()
      })
    )
  }),
  update_mark: tool({
    description:
      'Update a standing mark, or revive a retired mark with the same id when the concern returns. Preserve whether the reasoning is only considering or actually intending a choice.',
    inputSchema: valibotSchema(
      v.object({
        id: v.string(),
        node_id: v.optional(v.nullable(v.string())),
        relation: relationSchema,
        text: v.string(),
        ...evidenceSchema,
        importance: v.number()
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
 * So one way off remains, and it is an event rather than an opinion: the change
 * landed and nobody stopped it. A decision genuinely taken back is an update
 * to importance 1, which leaves the mark where it was and says it no longer
 * needs attention.
 */
