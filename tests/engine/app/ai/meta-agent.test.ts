import { describe, expect, test } from 'bun:test'

import {
  SPECTRUM,
  createMetaAgent,
  isUnrelated,
  type ConsiderInput,
  type JudgeInput,
  type Mark,
  type MarkToolCall,
  type MetaAgent
} from '@/app/meta-agent/judge'

const BASE: ConsiderInput = {
  request: 'Make three product cards',
  plan: null,
  propositions: [
    {
      id: 'outlined',
      text: 'Uses outlined icons',
      confidence: 0.9,
      rationale: null,
      shownToAgent: true
    }
  ],
  canvas: 'Card (0:1) FRAME',
  reasoning: '',
  actions: []
}

/** `against` and `with` are only which way the quoted reasoning went; nothing
 * records it, and both make the same kind of mark. */
type Quoted = 'against' | 'with' | 'uncovered'

const TEXT_FOR: Record<Quoted, string> = {
  against: 'considers filled icons · you use outlines',
  with: 'reaches for outline icons · you use outlines',
  uncovered: 'considers badges · we do not know badges'
}

const FEEDBACK = Object.fromEntries(SPECTRUM.map((step) => [step, `Do it ${step}`]))

/**
 * A related mark cites a proposition and brings the five instructions; an
 * unrelated one cites nothing and brings the single suggestion. Which way the
 * reasoning went only picks the wording — it changes no field.
 */
function generate(
  quote: string,
  kind: Quoted = 'against',
  nodeId: string | null = '0:1',
  propositionId = 'outlined'
): MarkToolCall {
  const unrelated = kind === 'uncovered'
  return {
    toolName: unrelated ? 'generate_unrelated_mark' : 'generate_related_mark',
    input: {
      node_id: nodeId,
      topic: unrelated ? 'Badge treatment' : 'Icon language',
      text: TEXT_FOR[kind],
      evidence_from_reasoning: quote,
      evidence_from_user_model: unrelated ? null : propositionId,
      ...(unrelated
        ? { suggested_feedback: 'Use a subtle badge treatment' }
        : { feedback_contents: FEEDBACK })
    }
  }
}

interface Harness {
  agent: MetaAgent
  queue: MarkToolCall[][]
  rendered: JudgeInput[]
  run(reasoning: string): Promise<Mark[]>
}

function harness(): Harness {
  const queue: MarkToolCall[][] = []
  const rendered: JudgeInput[] = []
  const waiting: Array<(marks: Mark[]) => void> = []
  const agent = createMetaAgent({
    deps: {
      system: 'test',
      render: (input) => {
        rendered.push(input)
        return input.reasoning
      },
      judge: async () => queue.shift() ?? []
    },
    onChanged: (marks, _retired, from) => {
      if (!from) return
      waiting.shift()?.(structuredClone(marks))
    }
  })
  return {
    agent,
    queue,
    rendered,
    run: (reasoning) =>
      new Promise((resolve) => {
        waiting.push(resolve)
        agent.consider({ ...BASE, reasoning })
      })
  }
}

describe('meta-agent mark tools', () => {
  test('applies a related and an unrelated tool call with distinct semantics', async () => {
    const h = harness()
    h.agent.beginStep(3)
    const against = 'considering a filled star for the icon'
    const uncovered = 'and considering a badge above the price'
    h.queue.push([generate(against), generate(uncovered, 'uncovered')])

    const marks = await h.run(
      `${against}, ${uncovered}, while keeping the rest of the card restrained and simple.`
    )

    expect(marks.map(isUnrelated)).toEqual([false, true])
    expect(marks.map((mark) => mark.lineageId)).toEqual(['m1', 'm2'])
    expect(marks.map((mark) => mark.topic)).toEqual(['Icon language', 'Badge treatment'])
    expect(marks.map((mark) => mark.raisedOrder)).toEqual([0, 1])
    expect(marks.map((mark) => mark.raisedInStep)).toEqual([3, 3])
  })

  test('applies a related mark with a valid proposition citation', async () => {
    const h = harness()
    const quote = 'reaching for outline icons'
    h.queue.push([generate(quote, 'with')])

    const marks = await h.run(
      `${quote} to match the rest of the set, keeping the card's detailing consistent throughout.`
    )

    expect(marks.map(isUnrelated)).toEqual([false])
    expect(marks[0]?.position).toBe('halfway')
    // The cited id has to survive, or the user model cannot tell which belief
    // just held up.
    expect(marks[0]?.notes[0]?.evidence.fromUserModel).toBe('outlined')
  })

  test('leaves a mark with no spectrum off the scale, and rejects a related one missing it', async () => {
    const h = harness()
    const uncovered = 'considering a badge above the price'
    const against = 'considering a filled star for the icon'
    const noContents = generate(against)
    delete (noContents.input as { feedback_contents?: unknown }).feedback_contents
    h.queue.push([generate(uncovered, 'uncovered', null), noContents])

    const marks = await h.run(`${uncovered}, and ${against}, with the rest still undecided.`)

    // Zero here is off the scale, not the weakest point on it.
    expect(marks.map((mark) => [isUnrelated(mark), mark.position])).toEqual([[true, null]])
  })

  test('rejects a related mark whose spectrum repeats the same instruction', async () => {
    const h = harness()
    const quote = 'choosing a flat white workspace background'
    const call = generate(quote)
    const repeated = Object.fromEntries(SPECTRUM.map((step) => [step, 'Use pure white']))
    ;(call.input as { feedback_contents: unknown }).feedback_contents = repeated
    h.queue.push([call])

    const marks = await h.run(
      `The agent is ${quote}, while considering the rest of the card presentation and layout.`
    )

    expect(marks).toHaveLength(0)
  })

  test('drops the oldest question when a fourth arrives, not the weakest', async () => {
    const h = harness()
    const quotes = ['the badge', 'the divider', 'the shadow', 'the corner treatment']
    h.queue.push(quotes.slice(0, 3).map((q) => generate(q, 'uncovered', null)))
    await h.run(`Considering ${quotes.slice(0, 3).join(', ')}, none of them settled yet at all.`)

    h.queue.push([generate(quotes[3], 'uncovered', null)])
    const marks = await h.run(
      `Considering ${quotes.join(', ')}, and none of those has been settled yet.`
    )

    // m1 was raised first, so m1 is the one that goes.
    expect(marks.map((mark) => mark.id)).toEqual(['m2', 'm3', 'm4'])
  })

  test('retires a dismissed mark rather than forgetting it, freeing its slot', async () => {
    const h = harness()
    const quote = 'considering a badge above the price'
    h.queue.push([generate(quote, 'uncovered', null)])
    await h.run(`${quote}, though nothing about it has been settled yet either way.`)

    h.agent.dismissMark('m1')

    expect(h.agent.marks).toHaveLength(0)
    // Still theirs to have agreed with: dismissing one is agreeing with it, the
    // same reading silence gets.
    expect(h.agent.answerable.map((mark) => mark.id)).toEqual(['m1'])

    // And the judge is still shown it, so the next chunk updates m1 instead of
    // raising the same question under a new id.
    h.queue.push([])
    await h.run('Reviewing the row as a whole without opening another visual question.')
    expect(h.rendered.at(-1)?.retired.map((mark) => mark.id)).toEqual(['m1'])
  })

  test('rejects a related mark that does not cite a known proposition', async () => {
    const h = harness()
    const quote = 'considering a filled star for the icon'
    const invalid = generate(quote, 'against', '0:1', 'missing')
    h.queue.push([invalid])

    expect(await h.run(`${quote}, alongside several other options that remain undecided.`)).toEqual(
      []
    )
  })

  test('retires every mark attached to a settled node', async () => {
    const h = harness()
    const first = 'considering a filled star on the first card'
    const second = 'considering a filled star on the second card'
    const third = 'considering a badge treatment for the row'
    const fourth = 'reaching for outline icons on the first card'
    h.queue.push([
      generate(first, 'against', '0:1'),
      generate(second, 'against', '0:2'),
      generate(third, 'uncovered', null),
      generate(fourth, 'with', '0:1')
    ])
    await h.run(
      `${first}; ${second}; ${third}; ${fourth}; none of these alternatives has been executed yet.`
    )

    h.agent.retireSettledMarks(['0:1'])

    // m1 and m4 name the settled node. A node-less question remains open.
    expect(h.agent.marks.map((mark) => mark.id)).toEqual(['m2', 'm3'])
  })

  test('retires an unrelated mark when its target node settles', async () => {
    const h = harness()
    const quote = 'considering image placeholders on the first card'
    h.queue.push([generate(quote, 'uncovered', '0:1')])
    await h.run(
      `The agent is working through several card decisions and is ${quote}, before rendering that choice into the existing layout.`
    )

    h.agent.retireSettledMarks(['0:1'])

    expect(h.agent.marks).toHaveLength(0)
    expect(h.agent.answerable.map((mark) => mark.id)).toEqual(['m1'])
  })

  test('updates the existing mark when a generate call repeats its reasoning evidence', async () => {
    const h = harness()
    const quote = 'using light grey backgrounds and cool borders'
    h.queue.push([generate(quote, 'uncovered', '0:1')])
    await h.run(
      `The agent is reviewing the full card treatment and is ${quote}, while preserving the rest of the established layout.`
    )

    h.queue.push([generate(quote, 'with', '0:1')])
    const marks = await h.run(
      `The agent is still ${quote}, now checked against the user model and the other established design constraints.`
    )

    expect(marks).toHaveLength(1)
    expect(marks[0]?.id).toBe('m1')
    expect(isUnrelated(marks[0] as Mark)).toBe(false)
  })

  test('drops a judgment that finishes after feedback suspends the turn', async () => {
    let finish: ((calls: MarkToolCall[]) => void) | undefined
    const changes: Mark[][] = []
    const agent = createMetaAgent({
      deps: {
        system: 'test',
        render: (input) => input.reasoning,
        judge: () =>
          new Promise((resolve) => {
            finish = resolve
          })
      },
      onChanged: (marks) => changes.push(structuredClone(marks))
    })
    const quote = 'considering a badge above the price'

    agent.consider({
      ...BASE,
      reasoning: `The agent is ${quote}, while reviewing the rest of the complete card layout.`
    })
    agent.suspend()
    finish?.([generate(quote, 'uncovered', '0:1')])
    await agent.settled()

    expect(agent.marks).toHaveLength(0)
    expect(changes).toHaveLength(0)
  })

  test('updates a retired mark to revive the same id instead of duplicating it', async () => {
    const h = harness()
    const first = 'considering a filled star for the first card'
    h.queue.push([generate(first)])
    await h.run(`${first}, but several icon alternatives remain open for the moment.`)
    h.agent.retireSettledMarks(['0:1'])

    const again = 'returning to the filled star for all three cards'
    h.queue.push([
      {
        toolName: 'update_mark',
        input: {
          id: 'm1',
          node_id: '0:2',
          topic: 'Icon language',
          text: 'returns to filled stars · you use outlines',
          evidence_from_reasoning: again,
          evidence_from_user_model: 'outlined',
          feedback_contents: FEEDBACK
        }
      }
    ])

    const marks = await h.run(`${again}, after comparing the available icon families and weights.`)

    expect(marks).toHaveLength(1)
    expect(marks[0]?.id).toBe('m1')
    expect(marks[0]?.nodeId).toBe('0:2')
    expect(marks[0]?.notes).toHaveLength(2)
  })

  test('records an update as a new timeline event without moving its original event', async () => {
    const h = harness()
    const first = 'considering a filled star for the first card'
    h.agent.beginStep(2)
    h.queue.push([generate(first)])
    await h.run(
      `${first}, while the other icon details remain open and the broader card treatment is still being compared.`
    )
    await h.agent.settled()

    const update = 'switching back to outline icons for the first card'
    h.agent.beginStep(3)
    h.queue.push([
      {
        toolName: 'update_mark',
        input: {
          id: 'm1',
          topic: 'Icon language',
          text: 'returns to outline icons · you use outlines',
          evidence_from_reasoning: 'outline icons',
          evidence_from_user_model: 'outlined',
          feedback_contents: FEEDBACK,
          suggested_feedback: null
        }
      }
    ])

    const marks = await h.run(`${update}, after comparing the available treatments.`)

    expect(marks[0]?.raisedInStep).toBe(2)
    expect(marks[0]?.raisedOrder).toBe(0)
    expect(marks[0]?.changedInStep).toBe(3)
    expect(marks[0]?.changedOrder).toBe(0)
    expect(marks[0]?.position).toBe('halfway')
  })

  test('remaps both standing and retired marks when render replaces a node id', async () => {
    const h = harness()
    const first = 'considering a filled star for the first card'
    h.queue.push([generate(first)])
    await h.run(`${first}, with other visual details still deliberately left open.`)
    h.agent.retireSettledMarks(['0:1'])
    h.agent.remapNode('0:1', '0:9')
    h.queue.push([])
    await h.run('reviewing the completed card hierarchy without introducing another visual choice.')

    expect(h.rendered.at(-1)?.retired[0]?.nodeId).toBe('0:9')
  })
})
