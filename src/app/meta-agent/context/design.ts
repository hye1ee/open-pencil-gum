import type { EditorStore } from '@/app/editor/active-store'
import type { Proposition as JudgeProposition } from '@/app/meta-agent/judge'
import type { Proposition, SavedProposition } from '@/app/user-model/pipeline'

export {
  actionsSoFar,
  propositionsForRun,
  summariseCanvas,
  withAncestors
} from '@/app/meta-agent/context'

import { actionsSoFar, summariseCanvas } from '@/app/meta-agent/context'
import type { MonitoredDomainContext } from '@/app/meta-agent/context/types'

/** Read-only design adapter. Editor mutation and turn control remain outside context. */
export function createDesignContext(input: {
  store: EditorStore
  userRequest: string
  plan: string | null
  propositions: readonly Proposition[]
}): MonitoredDomainContext {
  return {
    domain: 'design',
    userRequest: input.userRequest,
    plan: input.plan,
    propositions: input.propositions,
    summarizeState: () => summariseCanvas(input.store),
    actionsSoFar: () => actionsSoFar(input.store)
  }
}

// Keep these types discoverable beside the adapter without widening the shared contract.
export type DesignJudgeProposition = JudgeProposition
export type DesignSavedProposition = SavedProposition
