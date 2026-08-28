import type { Proposition } from '@/app/user-model/pipeline'

export type { ReasoningObserver as ChatReasoningObserver } from '@/app/meta-agent/core/reasoning-observer'

export interface ChatReasoningMode {
  observe: boolean
  reveal: boolean
}

export interface ChatMonitoredContext {
  readonly domain: 'chat'
  readonly userRequest: string
  readonly propositions: readonly Proposition[]
  summarizeState(): string
  actionsSoFar(): readonly string[]
}
