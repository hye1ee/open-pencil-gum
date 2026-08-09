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
  }),
  delete_mark: tool({
    description:
      'Delete a standing or retired mark only when the quoted reasoning abandons it, or to make room for a more important unknown.',
    inputSchema: valibotSchema(
      v.object({
        id: v.string(),
        evidence_from_reasoning: v.string()
      })
    )
  })
}
