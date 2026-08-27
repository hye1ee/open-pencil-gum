import type { ChatProposition } from '@/app/user-model-chat/types'

export interface ChatMonitoredContext {
  readonly domain: 'chat'
  readonly userRequest: string
  readonly propositions: readonly ChatProposition[]
  summarizeState(): string
  actionsSoFar(): readonly string[]
}

export interface ChatReasoningObserver {
  start(streamId: number): void
  chunk(streamId: number, reasoningChunk: string, reasoningSoFar: string): void
  end(streamId: number, reasoning: string): void
  settled(streamId: number): Promise<void>
}
