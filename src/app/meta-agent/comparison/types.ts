import type { MarkRelation } from '@/app/meta-agent/judge'

export interface TaskAgentProposition {
  id: string
  text: string
  evidenceFromReasoning: string
}

export interface PropositionLink {
  taskPropositionId: string
  userPropositionId: string
  relationship: Exclude<MarkRelation, 'unknown'>
  explanation: string
}

export interface PropositionComparison {
  taskPropositions: TaskAgentProposition[]
  links: PropositionLink[]
}
