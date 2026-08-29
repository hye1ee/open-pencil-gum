import type { UIMessage } from 'ai'

export type MidRunUserMessage = {
  id: string
  text: string
  anchorMessageId: string
  afterPartCount: number | null
}

export type ChatTimelineItem = {
  key: string
  message: UIMessage
  variant: 'default' | 'additional-feedback'
}

function userMessage(item: MidRunUserMessage): UIMessage {
  return {
    id: item.id,
    role: 'user',
    parts: [{ type: 'text', text: item.text }]
  }
}

function defaultItem(message: UIMessage): ChatTimelineItem {
  return { key: message.id, message, variant: 'default' }
}

function feedbackItem(item: MidRunUserMessage): ChatTimelineItem {
  return { key: item.id, message: userMessage(item), variant: 'additional-feedback' }
}

/**
 * Insert mid-run user messages at the assistant-part boundary where they were
 * sent. This only changes presentation: the task-agent transcript continues to
 * receive these messages through the step-boundary intervention channel.
 */
export function composeChatTimeline(
  messages: readonly UIMessage[],
  midRunMessages: readonly MidRunUserMessage[]
): ChatTimelineItem[] {
  if (midRunMessages.length === 0) return messages.map(defaultItem)

  const byAnchor = new Map<string, MidRunUserMessage[]>()
  for (const item of midRunMessages) {
    const anchored = byAnchor.get(item.anchorMessageId)
    if (anchored) anchored.push(item)
    else byAnchor.set(item.anchorMessageId, [item])
  }

  const timeline: ChatTimelineItem[] = []
  const inserted = new Set<string>()

  for (const message of messages) {
    const anchored = byAnchor.get(message.id) ?? []
    if (anchored.length === 0) {
      timeline.push(defaultItem(message))
      continue
    }

    if (message.role !== 'assistant') {
      timeline.push(defaultItem(message))
      for (const item of anchored) {
        timeline.push(feedbackItem(item))
        inserted.add(item.id)
      }
      continue
    }

    let partStart = 0
    let segment = 0
    for (const item of anchored) {
      const requestedEnd = item.afterPartCount ?? message.parts.length
      const partEnd = Math.max(partStart, Math.min(requestedEnd, message.parts.length))
      if (partEnd > partStart) {
        const fragment: UIMessage = {
          ...message,
          id: `${message.id}:before-${item.id}`,
          parts: message.parts.slice(partStart, partEnd)
        }
        timeline.push({ key: fragment.id, message: fragment, variant: 'default' })
        segment++
      }
      timeline.push(feedbackItem(item))
      inserted.add(item.id)
      partStart = partEnd
    }

    if (partStart < message.parts.length) {
      const fragment: UIMessage = {
        ...message,
        id: `${message.id}:after-${segment}`,
        parts: message.parts.slice(partStart)
      }
      timeline.push({ key: fragment.id, message: fragment, variant: 'default' })
    }
  }

  // Keep the optimistic bubble visible even if its anchor disappeared while a
  // provider stream was being repaired or replaced.
  for (const item of midRunMessages) {
    if (!inserted.has(item.id)) timeline.push(feedbackItem(item))
  }

  return timeline
}
