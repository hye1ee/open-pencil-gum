import { isTextUIPart } from 'ai'
import type { UIMessage } from 'ai'

export function messageText(message: UIMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join(' ')
    .trim()
}

export function titleFrom(messages: readonly UIMessage[]): string {
  const first = messages.find((message) => message.role === 'user')
  const text = first ? messageText(first) : ''
  return text ? text.slice(0, 52) : 'New chat'
}

export function lastUserRequest(messages: readonly UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === 'user') return messageText(message)
  }
  return ''
}
