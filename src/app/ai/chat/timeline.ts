import type { UIMessage } from 'ai'

export type MidRunUserMessage = {
  id: string
  text: string
  anchorMessageId: string
  afterPartCount: number | null
}

export type ChatTimelineMessageItem = {
  kind: 'message'
  key: string
  message: UIMessage
  variant: 'default' | 'additional-feedback'
}

export type ChatTimelineInsertion<Value> = {
  key: string
  anchorMessageId: string
  afterPartCount: number | null
  value: Value
}

export type ChatTimelineItem<Value = never> =
  | ChatTimelineMessageItem
  | {
      kind: 'insertion'
      key: string
      value: Value
    }

function userMessage(item: MidRunUserMessage): UIMessage {
  return {
    id: item.id,
    role: 'user',
    parts: [{ type: 'text', text: item.text }]
  }
}

function defaultItem(message: UIMessage): ChatTimelineMessageItem {
  return { kind: 'message', key: message.id, message, variant: 'default' }
}

function feedbackItem(item: MidRunUserMessage): ChatTimelineMessageItem {
  return {
    kind: 'message',
    key: item.id,
    message: userMessage(item),
    variant: 'additional-feedback'
  }
}

type AnchoredEvent<Value> =
  | {
      kind: 'feedback'
      key: string
      afterPartCount: number | null
      value: MidRunUserMessage
      order: number
    }
  | {
      kind: 'insertion'
      key: string
      afterPartCount: number | null
      value: Value
      order: number
    }

function eventItem<Value>(event: AnchoredEvent<Value>): ChatTimelineItem<Value> {
  if (event.kind === 'feedback') return feedbackItem(event.value)
  return { kind: 'insertion', key: event.key, value: event.value }
}

/**
 * Insert mid-run user messages at the assistant-part boundary where they were
 * sent. This only changes presentation: the task-agent transcript continues to
 * receive these messages through the step-boundary intervention channel.
 */
export function composeChatTimeline<Value = never>(
  messages: readonly UIMessage[],
  midRunMessages: readonly MidRunUserMessage[],
  insertions: readonly ChatTimelineInsertion<Value>[] = []
): ChatTimelineItem<Value>[] {
  if (midRunMessages.length === 0 && insertions.length === 0) return messages.map(defaultItem)

  const byAnchor = new Map<string, AnchoredEvent<Value>[]>()
  const addEvent = (anchorMessageId: string, event: AnchoredEvent<Value>): void => {
    const anchored = byAnchor.get(anchorMessageId)
    if (anchored) anchored.push(event)
    else byAnchor.set(anchorMessageId, [event])
  }
  midRunMessages.forEach((item, order) => {
    addEvent(item.anchorMessageId, {
      kind: 'feedback',
      key: item.id,
      afterPartCount: item.afterPartCount,
      value: item,
      order
    })
  })
  insertions.forEach((item, index) => {
    addEvent(item.anchorMessageId, {
      kind: 'insertion',
      key: item.key,
      afterPartCount: item.afterPartCount,
      value: item.value,
      order: midRunMessages.length + index
    })
  })

  for (const events of byAnchor.values()) {
    events.sort((a, b) => {
      const aBoundary = a.afterPartCount ?? Number.MAX_SAFE_INTEGER
      const bBoundary = b.afterPartCount ?? Number.MAX_SAFE_INTEGER
      return aBoundary - bBoundary || a.order - b.order
    })
  }

  const timeline: ChatTimelineItem<Value>[] = []
  const inserted = new Set<string>()

  for (const message of messages) {
    const anchored = byAnchor.get(message.id) ?? []
    if (anchored.length === 0) {
      timeline.push(defaultItem(message))
      continue
    }

    if (message.role !== 'assistant') {
      timeline.push(defaultItem(message))
      for (const event of anchored) {
        timeline.push(eventItem(event))
        inserted.add(event.key)
      }
      continue
    }

    let partStart = 0
    let segment = 0
    for (const event of anchored) {
      const requestedEnd = event.afterPartCount ?? message.parts.length
      const partEnd = Math.max(partStart, Math.min(requestedEnd, message.parts.length))
      if (partEnd > partStart) {
        const fragment: UIMessage = {
          ...message,
          id: `${message.id}:before-${event.key}`,
          parts: message.parts.slice(partStart, partEnd)
        }
        timeline.push({ kind: 'message', key: fragment.id, message: fragment, variant: 'default' })
        segment++
      }
      timeline.push(eventItem(event))
      inserted.add(event.key)
      partStart = partEnd
    }

    if (partStart < message.parts.length) {
      const fragment: UIMessage = {
        ...message,
        id: `${message.id}:after-${segment}`,
        parts: message.parts.slice(partStart)
      }
      timeline.push({ kind: 'message', key: fragment.id, message: fragment, variant: 'default' })
    }
  }

  // Keep the optimistic bubble visible even if its anchor disappeared while a
  // provider stream was being repaired or replaced.
  for (const item of midRunMessages) {
    if (!inserted.has(item.id)) timeline.push(feedbackItem(item))
  }
  for (const item of insertions) {
    if (!inserted.has(item.key)) {
      timeline.push({ kind: 'insertion', key: item.key, value: item.value })
    }
  }

  return timeline
}
