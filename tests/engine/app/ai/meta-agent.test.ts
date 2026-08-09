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
  propositions: [{ id: 'outlined', text: 'Uses outlined icons', confidence: 0.9 }],
  canvas: 'Card (0:1) FRAME',
  reasoning: '',
  actions: []
}

function generate(
  quote: string,
  relation: 'conflict' | 'unknown' = 'conflict',
  nodeId: string | null = '0:1',
  propositionId = 'outlined'
): MarkToolCall {
  return {
    toolName: 'generate_mark',
    input: {
      node_id: nodeId,
      relation,
      text:
        relation === 'conflict'
          ? 'considers filled icons · you use outlines'
          : 'considers badges · we do not know badges',
      evidence_from_reasoning: quote,
      evidence_from_user_model: relation === 'conflict' ? propositionId : null,
      importance: relation === 'conflict' ? 8 : 3
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

  test('rejects a conflict that does not cite a known proposition', async () => {
    const h = harness()
    const quote = 'considering a filled star for the icon'
    const invalid = generate(quote, 'conflict', '0:1', 'missing')
    h.queue.push([invalid])

    expect(await h.run(`${quote}, alongside several other options that remain undecided.`)).toEqual(
      []
    )
  })

  test('selectively retires only anchored conflicts for the settled preview', async () => {
    const h = harness()
    const first = 'considering a filled star on the first card'
    const second = 'considering a filled star on the second card'
    const third = 'considering a badge treatment for the row'
    h.queue.push([
      generate(first, 'conflict', '0:1'),
      generate(second, 'conflict', '0:2'),
      generate(third, 'unknown', null)
    ])
    await h.run(`${first}; ${second}; ${third}; none of these alternatives has been executed yet.`)

    h.agent.retireWarnings(['0:1'])

    expect(h.agent.marks.map((mark) => mark.id)).toEqual(['m2', 'm3'])
  })

  test('updates a retired mark to revive the same id instead of duplicating it', async () => {
    const h = harness()
    const first = 'considering a filled star for the first card'
    h.queue.push([generate(first)])
    await h.run(`${first}, but several icon alternatives remain open for the moment.`)
    h.agent.retireWarnings(['0:1'])

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
          importance: 9
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
    h.agent.retireWarnings(['0:1'])
    h.agent.remapNode('0:1', '0:9')
    h.queue.push([])
    await h.run('reviewing the completed card hierarchy without introducing another visual choice.')

    expect(h.rendered.at(-1)?.retired[0]?.nodeId).toBe('0:9')
  })
})
