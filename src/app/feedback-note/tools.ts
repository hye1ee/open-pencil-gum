import { valibotSchema } from '@ai-sdk/valibot'
import { tool } from 'ai'
import * as v from 'valibot'

const noteInput = valibotSchema(
  v.object({
    topic: v.string(),
    mode: v.picklist(['text', 'visual']),
    visual_type: v.nullable(v.picklist(['diagram', 'artifact', 'illustration'])),
    representation_goal: v.string(),
    text: v.string(),
    image_prompt: v.nullable(v.string()),
    annotation_affordance: v.string(),
    node_id: v.nullable(v.string()),
    evidence_from_reasoning: v.string(),
    proposition_ids: v.array(v.string())
  })
)

export const FEEDBACK_NOTE_TOOLS = {
  create_alignment_feedback_note: tool({
    description: 'Create one note about reasoning that aligns with a user-model proposition.',
    inputSchema: noteInput
  }),
  create_conflict_feedback_note: tool({
    description: 'Create one note about reasoning that conflicts with a user-model proposition.',
    inputSchema: noteInput
  }),
  create_uncovered_feedback_note: tool({
    description: 'Create one note about a meaningful decision not covered by the user model.',
    inputSchema: noteInput
  })
}
