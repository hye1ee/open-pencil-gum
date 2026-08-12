import { describe, expect, test } from 'bun:test'

import {
  createMetaAgent,
  isWarning,
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

const TEXT_FOR: Record<'conflict' | 'alignment' | 'unknown', string> = {
  conflict: 'considers filled icons · you use outlines',
  alignment: 'reaches for outline icons · you use outlines',
  unknown: 'considers badges · we do not know badges'
}

/**
 * The model gives a strength only; the sign comes from `relation`. It arrives as
 * a string because the tool schema asks for one — Gemini refuses a numeric enum.
 * An unknown sends none at all: it rests on no proposition, so there is no fit
 * to rate.
 */
function generate(
  quote: string,
  relation: 'conflict' | 'alignment' | 'unknown' = 'conflict',
  nodeId: string | null = '0:1',
  propositionId = 'outlined',
  strength = '4'
): MarkToolCall {
  return {
    toolName: 'generate_mark',
    input: {
      node_id: nodeId,
      relation,
      text: TEXT_FOR[relation],
      evidence_from_reasoning: quote,
      evidence_from_user_model: relation === 'unknown' ? null : propositionId,
      ...(relation === 'unknown' ? {} : { strength })
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
    onChanged: (marks, from) => {
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
  test('applies conflict and unknown tool calls with distinct semantics', async () => {
    const h = harness()
    const conflict = 'considering a filled star for the icon'
    const unknown = 'and considering a badge above the price'
    h.queue.push([generate(conflict), generate(unknown, 'unknown')])

    const marks = await h.run(
      `${conflict}, ${unknown}, while keeping the rest of the card restrained and simple.`
    )

    expect(marks.map((mark) => mark.relation)).toEqual(['conflict', 'unknown'])
    expect(marks.map(isWarning)).toEqual([true, false])
  })

  test('applies an alignment mark, which cites a proposition but is not a warning', async () => {
    const h = harness()
    const quote = 'reaching for outline icons'
    h.queue.push([generate(quote, 'alignment')])

    const marks = await h.run(
      `${quote} to match the rest of the set, keeping the card's detailing consistent throughout.`
    )

    expect(marks.map((mark) => mark.relation)).toEqual(['alignment'])
    expect(marks.map(isWarning)).toEqual([false])
    // The sign is the relation's, not the model's: it sent 4 either way.
    expect(marks[0]?.rating).toBe(4)
    // The cited id has to survive, or the user model cannot tell which belief
    // just held up.
    expect(marks[0]?.notes[0]?.evidence.fromUserModel).toBe('outlined')
  })

  test('signs a conflict negative from the same strength an alignment reads positive', async () => {
    const h = harness()
    const quote = 'considering a filled star for the icon'
    h.queue.push([generate(quote, 'conflict', '0:1', 'outlined', '4')])

    const marks = await h.run(
      `${quote}, alongside several other options that remain undecided for now.`
    )

    expect(marks[0]?.rating).toBe(-4)
  })

  test('gives an unknown no rating at all, and rejects a conflict that sends none', async () => {
    const h = harness()
    const unknown = 'considering a badge above the price'
    const conflict = 'considering a filled star for the icon'
    const noStrength = generate(conflict)
    delete (noStrength.input as { strength?: unknown }).strength
    h.queue.push([generate(unknown, 'unknown', null), noStrength])

    const marks = await h.run(`${unknown}, and ${conflict}, with the rest still undecided.`)

    // Zero here is off the scale, not the weakest point on it.
    expect(marks.map((mark) => [mark.relation, mark.rating])).toEqual([['unknown', 0]])
  })

  test('drops the oldest question when a fourth arrives, not the weakest', async () => {
    const h = harness()
    const quotes = ['the badge', 'the divider', 'the shadow', 'the corner treatment']
    h.queue.push(quotes.slice(0, 3).map((q) => generate(q, 'unknown', null)))
    await h.run(`Considering ${quotes.slice(0, 3).join(', ')}, none of them settled yet at all.`)

    h.queue.push([generate(quotes[3], 'unknown', null)])
    const marks = await h.run(
      `Considering ${quotes.join(', ')}, and none of those has been settled yet.`
    )

    // m1 was raised first, so m1 is the one that goes.
    expect(marks.map((mark) => mark.id)).toEqual(['m2', 'm3', 'm4'])
  })

  test('retires a dismissed mark rather than forgetting it, freeing its slot', async () => {
    const h = harness()
    const quote = 'considering a badge above the price'
    h.queue.push([generate(quote, 'unknown', null)])
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

  test('rejects a conflict that does not cite a known proposition', async () => {
    const h = harness()
    const quote = 'considering a filled star for the icon'
    const invalid = generate(quote, 'conflict', '0:1', 'missing')
    h.queue.push([invalid])

    expect(await h.run(`${quote}, alongside several other options that remain undecided.`)).toEqual(
      []
    )
  })

  test('retires the settled node’s marks whichever way they point, but never an unknown', async () => {
    const h = harness()
    const first = 'considering a filled star on the first card'
    const second = 'considering a filled star on the second card'
    const third = 'considering a badge treatment for the row'
    const fourth = 'reaching for outline icons on the first card'
    h.queue.push([
      generate(first, 'conflict', '0:1'),
      generate(second, 'conflict', '0:2'),
      generate(third, 'unknown', null),
      generate(fourth, 'alignment', '0:1')
    ])
    await h.run(
      `${first}; ${second}; ${third}; ${fourth}; none of these alternatives has been executed yet.`
    )

    h.agent.retireSettledMarks(['0:1'])

    // m1 and m4 both name the settled node. m3 is an unknown: the change landing
    // says nothing about a question we raised because we had no belief at all.
    expect(h.agent.marks.map((mark) => mark.id)).toEqual(['m2', 'm3'])
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
          relation: 'conflict',
          text: 'returns to filled stars · you use outlines',
          evidence_from_reasoning: again,
          evidence_from_user_model: 'outlined',
          strength: '5'
        }
      }
    ])

    const marks = await h.run(`${again}, after comparing the available icon families and weights.`)

    expect(marks).toHaveLength(1)
    expect(marks[0]?.id).toBe('m1')
    expect(marks[0]?.nodeId).toBe('0:2')
    expect(marks[0]?.notes).toHaveLength(2)
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
