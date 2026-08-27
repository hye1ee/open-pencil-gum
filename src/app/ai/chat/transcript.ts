/**
 * Remove a provider tool call whose result never arrived. It never touched the
 * workspace, and retaining it makes providers reject the transcript on retry.
 */
export function withoutDanglingToolCalls<T extends { role: string; parts: unknown[] }>(
  messages: readonly T[]
): T[] {
  const last = messages.at(-1)
  if (last?.role !== 'assistant') return [...messages]

  const kept = last.parts.filter((part) => {
    if (typeof part !== 'object' || part === null || !('toolCallId' in part)) return true
    const state = 'state' in part ? part.state : undefined
    return state === 'output-available' || state === 'output-error'
  })
  if (kept.length === last.parts.length) return [...messages]

  const head = messages.slice(0, -1)
  const onlyStepStarts = kept.every(
    (part) =>
      typeof part === 'object' && part !== null && 'type' in part && part.type === 'step-start'
  )
  if (onlyStepStarts) return head
  return [...head, { ...last, parts: kept }]
}
