import { valibotSchema } from '@ai-sdk/valibot'
import { tool } from 'ai'
import * as v from 'valibot'

export const PROPOSITION_COMPARISON_TOOLS = {
  record_proposition_comparison: tool({
    description: 'Record task-agent propositions and their semantic links to the user model.',
    inputSchema: valibotSchema(
      v.object({
        task_propositions: v.array(
          v.object({
            id: v.string(),
            text: v.string(),
            evidence_from_reasoning: v.string()
          })
        ),
        links: v.array(
          v.object({
            task_proposition_id: v.string(),
            user_proposition_id: v.string(),
            relationship: v.picklist(['alignment', 'conflict']),
            explanation: v.string()
          })
        )
      })
    )
  })
}
