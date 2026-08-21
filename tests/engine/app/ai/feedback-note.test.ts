import { describe, expect, test } from 'bun:test'

import { buildFeedbackNoteImagePrompt } from '@/app/feedback-note/image'
import { FEEDBACK_NOTE_SYSTEM, renderFeedbackNotePrompt } from '@/app/feedback-note/prompt'
import { FEEDBACK_NOTE_TOOLS } from '@/app/feedback-note/tools'
import { USER_MODEL_FIXTURE } from '@/app/user-model/fixture'

describe('interactive feedback note', () => {
  test('offers one tool for each relationship', () => {
    expect(Object.keys(FEEDBACK_NOTE_TOOLS)).toEqual([
      'create_alignment_feedback_note',
      'create_conflict_feedback_note',
      'create_uncovered_feedback_note'
    ])
    expect(FEEDBACK_NOTE_SYSTEM).toContain('at most two tools')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('Do not call a tool when')
  })

  test('covers all three relationships including alignment', () => {
    expect(FEEDBACK_NOTE_SYSTEM).toContain('create_alignment_feedback_note:')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('create_conflict_feedback_note:')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('create_uncovered_feedback_note:')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('Alignment still requires a note')
    expect(FEEDBACK_NOTE_SYSTEM).toContain(
      'choose visual only when seeing or marking a representation would help'
    )
    expect(FEEDBACK_NOTE_SYSTEM).toContain('diagram: sequence, workflow, causality')
    expect(FEEDBACK_NOTE_SYSTEM).toContain(
      'artifact: the person must inspect an actual visual result'
    )
    expect(FEEDBACK_NOTE_SYSTEM).toContain('A design topic does not automatically require a visual')
  })

  test('puts the user model and completed reasoning in the prompt', () => {
    const prompt = renderFeedbackNotePrompt({
      request: 'Make a dashboard',
      plan: 'Build the shell first',
      reasoning: 'I will use equal-width cards.',
      propositions: [
        {
          id: 'equal-cards',
          text: 'Prefers equal visual weight.',
          confidence: 0.8,
          rationale: 'Makes comparison easier.',
          shownToAgent: true
        }
      ],
      canvas: '(empty)',
      actions: [],
      previousNotes: [
        {
          id: 'n1',
          topic: 'layout-first-workflow',
          relationship: 'alignment',
          mode: 'visual',
          visualType: 'diagram',
          representationGoal: 'Verify whether rough structure should precede details.',
          text: 'Rough layout before details',
          annotationAffordance: 'Change the order',
          nodeId: '0:3',
          evidenceFromReasoning: 'I will sketch the layout first.',
          propositionIds: ['equal-cards'],
          status: 'continued'
        }
      ]
    })

    expect(prompt).toContain('equal-cards')
    expect(prompt).toContain('I will use equal-width cards.')
    expect(prompt).toContain('PREVIOUS FEEDBACK NOTES')
    expect(prompt).toContain('layout-first-workflow [continued, alignment]')
    expect(prompt).toContain('representation: visual/diagram')
  })

  test('keeps image style stable without prescribing one representation', () => {
    const prompt = buildFeedbackNoteImagePrompt(
      'Show the tradeoff between two workflows.',
      'Connect the steps in the preferred order.',
      'diagram',
      'Learn which workflow order the person expects.'
    )
    expect(prompt).toContain('warm off-white background')
    expect(prompt).toContain('2–6 essential shapes')
    expect(prompt).toContain('Representation type:\ndiagram')
    expect(prompt).toContain('Do not draw an application screen')
    expect(prompt).toContain('four labels of up to 3 words each')
    expect(prompt).toContain('Do not create a questionnaire')
    expect(prompt).toContain('Show the tradeoff between two workflows.')
    expect(prompt).toContain('Connect the steps in the preferred order.')
    expect(prompt).toContain('Learn which workflow order the person expects.')
  })

  test('requires an open annotation opportunity', () => {
    expect(FEEDBACK_NOTE_SYSTEM).toContain('Every note must support a meaningful response')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('the person may instead draw anything elsewhere')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('explain a different idea by voice')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('annotation_affordance')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('direct 2–6 word pen gesture')
    expect(FEEDBACK_NOTE_SYSTEM).toContain(
      'Do not repeat an earlier underlying user-model question'
    )
    expect(FEEDBACK_NOTE_SYSTEM).toContain(
      'Never use circle, connect, choose, select, rate, or rank for text mode'
    )
    expect(FEEDBACK_NOTE_SYSTEM).toContain(
      'Alignment and conflict require at least one relevant proposition id'
    )
    expect(FEEDBACK_NOTE_SYSTEM).toContain(
      'A proposition already queried in this request is exhausted'
    )
  })

  test('fixture exercises every visual representation type', () => {
    const text = USER_MODEL_FIXTURE.map((item) => item.text).join('\n')
    expect(text).toContain('order, dependencies, and groups')
    expect(text).toContain('rendered color, spacing, and proportion')
    expect(text).toContain('concrete scenarios or metaphors')
  })
})
