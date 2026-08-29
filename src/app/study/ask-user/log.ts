import type { AskUserLifecycleEvent } from '@/app/study/ask-user/types'

export function formatAskUserLifecycleEvent(event: AskUserLifecycleEvent): string {
  switch (event.type) {
    case 'request-started':
      return `request=${event.requestId} started`
    case 'question-asked':
      return `request=${event.question.requestId} question=${event.question.sequence} asked: ${event.question.question}`
    case 'question-answered':
      return (
        `request=${event.question.requestId} question=${event.question.sequence} ` +
        `selected=${event.selectedOption ?? 'custom'} answered: ${event.answer}`
      )
    case 'question-cancelled':
      return `request=${event.question.requestId} question=${event.question.sequence} cancelled: ${event.reason}`
    case 'question-rejected':
      return `request=${event.requestId} rejected: ${event.reason}`
  }
  return event
}
