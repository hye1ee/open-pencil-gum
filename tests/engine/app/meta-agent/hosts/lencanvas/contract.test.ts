import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import { createEditorStore } from '@/app/editor/session'
import { META_AGENT_FEEDBACK_NOTE_TOOLS as FEEDBACK_NOTE_TOOLS } from '@/app/meta-agent/core/tools'
import {
  DESIGN_FEEDBACK_NOTE_SYSTEM as FEEDBACK_NOTE_SYSTEM,
  renderDesignFeedbackNotePrompt as renderFeedbackNotePrompt
} from '@/app/meta-agent/domains/canvas/prompt'
import { buildOpenPencilFeedbackNoteInput } from '@/app/meta-agent/hosts/lencanvas/input'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('Meta Agent contract', () => {
  test('locks the current system and rendered prompt before extraction', () => {
    const prompt = renderFeedbackNotePrompt({
      request: 'Create three cards',
      plan: 'Create a shared frame, then three variants.',
      reasoning: 'I will arrange the cards in an equal-width horizontal row.',
      propositions: [
        {
          id: 'layout-density',
          text: 'Prefers compact layouts with clear grouping.',
          confidence: 0.72,
          rationale: 'Dense layouts support fast comparison.',
          shownToAgent: true
        }
      ],
      canvas: 'Dashboard (0:1) FRAME 1200×800',
      actions: ['create_frame 0:1'],
      previousNotes: []
    })

    expect(sha256(FEEDBACK_NOTE_SYSTEM)).toBe(
      '75ffda67f8e1267e2427b3176d764853580b8a1da2cbee92786864bfd2d9346f'
    )
    expect(sha256(prompt)).toBe('49bc9a837735fea201c5620873a32e598b604c3e1d34001498249c09df56f4c4')
  })

  test('locks the three relationship tool contracts', () => {
    const toolContract = Object.fromEntries(
      Object.entries(FEEDBACK_NOTE_TOOLS).map(([name, definition]) => [
        name,
        {
          description: definition.description,
          schema: definition.inputSchema.jsonSchema
        }
      ])
    )

    expect(sha256(JSON.stringify(toolContract))).toBe(
      '21a7214a4742b468db53d6a019f4938c86568a2dad0748b05da82362aaac2c90'
    )
  })

  test('adapts OpenPencil state without changing the rendered input', () => {
    const adapted = buildOpenPencilFeedbackNoteInput({
      store: createEditorStore(),
      request: 'Create three cards',
      plan: 'Create a shared frame, then three variants.',
      reasoning: 'I will arrange the cards in an equal-width horizontal row.',
      originStep: 3,
      originChunk: 2,
      propositions: [],
      generation: 7
    })

    expect(adapted.canvas).toBe('(empty)')
    expect(adapted.actions).toEqual([])
    expect(adapted.originStep).toBe(3)
    expect(adapted.originChunk).toBe(2)
    expect(adapted.generation).toBe(7)
    expect(renderFeedbackNotePrompt(adapted)).toBe(
      renderFeedbackNotePrompt({
        request: adapted.request,
        plan: adapted.plan,
        reasoning: adapted.reasoning,
        propositions: adapted.propositions,
        canvas: '(empty)',
        actions: []
      })
    )
  })
})
