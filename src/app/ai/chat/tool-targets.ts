/**
 * Which nodes a tool call is about, read off its arguments before it runs.
 *
 * This replaces the agent declaring its own focus through a `set_attention`
 * call. A declaration is a claim — it costs a step, it goes stale the moment
 * the agent edits something it forgot to declare, and three of eight calls in a
 * measured run declared a set that was already current. The arguments are not a
 * claim: `set_fill(node_a1, …)` is about `node_a1` and cannot be about anything
 * else.
 *
 * Same knowledge the mutation guard uses (`intervention.ts`), read for a
 * different purpose, so the two stay side by side rather than one calling the
 * other — the guard answers "may this run?" and needs to say why it refused.
 *
 * Creation tools are the one case the arguments cannot answer: the new node has
 * no id until it exists. The parent is the honest anchor — it is where the user
 * should be looking — and the real id arrives moments later through the
 * existing done-flash, which reads it off the result.
 */

function fromBatch(args: Record<string, unknown>): string[] {
  let ops: unknown
  try {
    ops = JSON.parse(String(args.operations))
  } catch {
    return []
  }
  if (!Array.isArray(ops)) return []
  return ops
    .map((op) => (op as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string')
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

export function targetNodeIds(toolName: string, args: Record<string, unknown>): string[] {
  if (toolName === 'batch_update') return fromBatch(args)

  // render either swaps a subtree in place or builds into a parent.
  if (toolName === 'render') {
    const target = str(args.replace_id) ?? str(args.parent_id)
    return target ? [target] : []
  }

  const id = str(args.id)
  if (id) return [id]

  const parent = str(args.parent_id)
  return parent ? [parent] : []
}
