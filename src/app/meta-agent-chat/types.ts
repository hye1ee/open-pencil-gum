import type { ChatProposition } from '@/app/user-model-chat/types'

export type { ReasoningObserver as ChatReasoningObserver } from '@/app/meta-agent/core/reasoning-observer'

export interface ChatReasoningMode {
  observe: boolean
  reveal: boolean
}

export interface ChatMonitoredContext {
  readonly domain: 'chat'
  readonly userRequest: string
  readonly propositions: readonly ChatProposition[]
  summarizeState(): string
  actionsSoFar(): readonly string[]
}
