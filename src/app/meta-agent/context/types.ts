import type { Proposition } from '@/app/user-model/pipeline'

export interface MonitoredDomainContext {
  readonly domain: 'design' | 'chat'
  readonly userRequest: string
  readonly plan: string | null
  readonly propositions: readonly Proposition[]
  summarizeState(): string
  actionsSoFar(): readonly string[]
}
