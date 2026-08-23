import { valibotSchema } from '@ai-sdk/valibot'
import { tool } from 'ai'
import * as v from 'valibot'

const noteInput = valibotSchema(
  v.object({
    topic: v.string(),
    representation_type: v.picklist(['text', 'code-visual', 'image']),
    code_visual_type: v.nullable(
      v.picklist(['artifact', 'spectrum', 'flow', 'comparison', 'palette', 'wireframe'])
    ),
    code_visual_brief: v.nullable(
      v.object({
        subject: v.string(),
        decision: v.string(),
        alternatives: v.array(v.object({ label: v.string(), description: v.string() })),
        must_show: v.array(v.string()),
        format_hint: v.nullable(v.picklist(['html', 'svg']))
      })
    ),
    image_type: v.nullable(
      v.picklist([
        'illustration',
        'scene',
        'metaphor',
        'texture',
        'photographic-reference',
        'expressive-style'
      ])
    ),
    image_prompt: v.nullable(v.string()),
    representation_goal: v.string(),
    cue_segments: v.array(
      v.object({
        text: v.string(),
        source: v.picklist(['neutral', 'reasoning', 'proposition']),
        evidence_quote: v.nullable(v.string()),
        proposition_id: v.nullable(v.string())
      })
    ),
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
