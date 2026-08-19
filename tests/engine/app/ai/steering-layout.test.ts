import { describe, expect, test } from 'bun:test'

import {
  beginSteeringRun,
  mismatch,
  recordSteeringStep,
  resetSteeringSteps
} from '@/app/ai/chat/mismatch'
import { layoutTimeline, positionY } from '@/app/ai/chat/steering-layout'
import type { Mark, MarkFeedbackContents, SpectrumStep } from '@/app/meta-agent/judge'

const FEEDBACK = {
  as_reasoned: 'a',
  mostly_reasoned: 'b',
  halfway: 'c',
  mostly_user_model: 'd',
  as_user_model: 'e'
} satisfies MarkFeedbackContents

/** `position: null` is how a mark says no proposition covers it, so it also
 * carries no spectrum. */
function mark(id: string, step: number, order: number, position: SpectrumStep | null): Mark {
  return {
    id,
    lineageId: id,
    nodeId: null,
    topic: 'Card hierarchy',
    notes: [],
    raisedInStep: step,
    raisedOrder: order,
    changedInStep: step,
    changedOrder: order,
    position,
    feedbackContents: position === null ? null : FEEDBACK
  }
}

describe('steering timeline layout', () => {
  // A restart keeps the step budget, so it carries on counting and redoes the
  // step that was interrupted rather than starting at one again.
  test('carries the step count through a restart', () => {
    resetSteeringSteps()
    beginSteeringRun()
    recordSteeringStep(1)
    recordSteeringStep(2)
    beginSteeringRun()
    recordSteeringStep(2)
    recordSteeringStep(3)

    expect(mismatch.steeringSteps).toEqual([1, 2, 3])
    resetSteeringSteps()
  })

  test('keeps recorded steps that have no marks', () => {
    const layout = layoutTimeline([], [1, 2, 3])

    expect(layout.points).toEqual([])
    expect(layout.steps.map((step) => step.number)).toEqual([1, 2, 3])
  })

  test('sorts by step and creation order, with our end of the scale on top', () => {
    const layout = layoutTimeline([
      mark('later', 2, 0, 'as_reasoned'),
      mark('second', 1, 1, 'mostly_user_model'),
      mark('first', 1, 0, 'as_user_model')
    ])

    expect(layout.points.map((point) => point.mark.id)).toEqual(['first', 'second', 'later'])
    expect(positionY('mostly_user_model')).toBeLessThan(90)
    expect(positionY('mostly_reasoned')).toBeGreaterThan(90)
  })

  test('places an unknown at the middle height and gives it a gray region', () => {
    const layout = layoutTimeline([
      mark('a', 1, 0, 'as_user_model'),
      mark('question', 1, 1, null),
      mark('b', 1, 2, 'as_reasoned')
    ])

    expect(layout.points[1]?.y).toBe(90)
    expect(layout.regions.map((region) => region.kind)).toEqual(['rated', 'unknown', 'rated'])
  })

  test('does not extend an unknown region into an empty previous step', () => {
    const layout = layoutTimeline([mark('question', 8, 0, null)], [7, 8])
    const step8 = layout.steps.find((step) => step.number === 8)
    const question = layout.regions.find((region) => region.kind === 'unknown')

    expect(question?.start).toBe(step8?.start)
    expect(question?.end).toBe(step8?.end)
  })

  test('leaves a step with no marks unpainted', () => {
    const layout = layoutTimeline([mark('question', 8, 0, null)], [7, 8])
    const step7 = layout.steps.find((step) => step.number === 7)

    expect(step7).toBeDefined()
    expect(layout.regions.some((region) => region.start < (step7?.end ?? 0))).toBe(false)
  })

  test('widens a step as it receives more markers', () => {
    const empty = layoutTimeline([], [1])
    const one = layoutTimeline([mark('a', 1, 0, 'mostly_user_model')])
    const three = layoutTimeline([
      mark('a', 1, 0, 'mostly_user_model'),
      mark('b', 1, 1, 'mostly_reasoned'),
      mark('c', 1, 2, null)
    ])
    const emptyStep = empty.steps[0]
    const oneStep = one.steps[0]
    const threeStep = three.steps[0]
    if (!emptyStep || !oneStep || !threeStep) throw new Error('expected step layouts')

    expect(oneStep.end - oneStep.start).toBeGreaterThan(emptyStep.end - emptyStep.start)
    expect(threeStep.end - threeStep.start).toBeGreaterThan(oneStep.end - oneStep.start)
  })

  test('does not move existing markers when another marker is appended', () => {
    const first = mark('first', 1, 0, 'mostly_user_model')
    const one = layoutTimeline([first])
    const two = layoutTimeline([first, mark('second', 1, 1, 'mostly_reasoned')])

    expect(two.points[0]?.x).toBe(one.points[0]?.x)
  })

  test('compresses a missing run of steps into one timeline region', () => {
    const layout = layoutTimeline(
      [mark('before', 4, 0, 'mostly_user_model'), mark('after', 8, 0, 'mostly_reasoned')],
      [4, 8]
    )

    expect(layout.steps.map((step) => step.label)).toEqual(['Step 4', 'Steps 5–7', 'Step 8'])
  })

  test('spreads the five steps across a taller steering space', () => {
    expect(positionY(null, 360)).toBe(180)
    expect(positionY('mostly_user_model', 360)).toBeGreaterThan(positionY('mostly_user_model'))
    expect(positionY('as_reasoned', 360)).toBeGreaterThan(positionY('as_reasoned'))
  })
})
