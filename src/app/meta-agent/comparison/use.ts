import { generateText } from 'ai'

import { logPropositionComparison } from '@/app/ai/chat/agent-log'
import { createUntracedLanguageModel } from '@/app/ai/chat/model'
import { backgroundProviderOptions, modelConfigForSlot } from '@/app/ai/model-routing'
import {
  PROPOSITION_COMPARISON_SYSTEM,
  renderPropositionComparisonPrompt
} from '@/app/meta-agent/comparison/prompt'
import { PROPOSITION_COMPARISON_TOOLS } from '@/app/meta-agent/comparison/tools'
import type {
  PropositionComparison,
  PropositionLink,
  TaskAgentProposition
} from '@/app/meta-agent/comparison/types'
import type { Proposition } from '@/app/meta-agent/judge'

interface RawComparison {
  task_propositions?: unknown
  links?: unknown
}

interface RawTaskProposition {
  id?: unknown
  text?: unknown
  evidence_from_reasoning?: unknown
}

interface RawLink {
  task_proposition_id?: unknown
  user_proposition_id?: unknown
  relationship?: unknown
  explanation?: unknown
}

const MAX_TASK_PROPOSITIONS = 5

interface ComparisonParseResult {
  comparison: PropositionComparison
  rejected: string[]
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function flatten(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim().toLowerCase()
}

function readTaskPropositions(
  value: unknown,
  reasoning: string,
  rejected: string[]
): TaskAgentProposition[] {
  if (!Array.isArray(value)) {
    rejected.push('task_propositions is not an array')
    return []
  }
  const haystack = flatten(reasoning)
  const ids = new Set<string>()
  const propositions: TaskAgentProposition[] = []
  for (const item of value.slice(0, MAX_TASK_PROPOSITIONS)) {
    if (typeof item !== 'object' || item === null) {
      rejected.push('task proposition is not an object')
      continue
    }
    const row = item as RawTaskProposition
    const id = readString(row.id)
    const text = readString(row.text)
    const evidenceFromReasoning = readString(row.evidence_from_reasoning)
    if (id === '') {
      rejected.push('task proposition has no id')
      continue
    }
    if (ids.has(id)) {
      rejected.push(`${id}: duplicate task proposition id`)
      continue
    }
    if (text === '') {
      rejected.push(`${id}: task proposition has no text`)
      continue
    }
    if (evidenceFromReasoning === '') {
      rejected.push(`${id}: evidence_from_reasoning is empty`)
      continue
    }
    if (!haystack.includes(flatten(evidenceFromReasoning))) {
      rejected.push(
        `${id}: evidence is not an exact reasoning substring — "${evidenceFromReasoning}"`
      )
      continue
    }
    ids.add(id)
    propositions.push({ id, text, evidenceFromReasoning })
  }
  return propositions
}

function readLinks(
  value: unknown,
  taskPropositions: readonly TaskAgentProposition[],
  userPropositions: readonly Proposition[],
  rejected: string[]
): PropositionLink[] {
  if (!Array.isArray(value)) {
    rejected.push('links is not an array')
    return []
  }
  const taskIds = new Set(taskPropositions.map((proposition) => proposition.id))
  const userIds = new Set(userPropositions.map((proposition) => proposition.id))
  const seen = new Set<string>()
  const links: PropositionLink[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      rejected.push('link is not an object')
      continue
    }
    const row = item as RawLink
    const taskPropositionId = readString(row.task_proposition_id)
    const userPropositionId = readString(row.user_proposition_id)
    const relationship = row.relationship
    const explanation = readString(row.explanation)
    const key = `${taskPropositionId}:${userPropositionId}:${String(relationship)}`
    if (!taskIds.has(taskPropositionId)) {
      rejected.push(`link references rejected or unknown task proposition: ${taskPropositionId}`)
      continue
    }
    if (!userIds.has(userPropositionId)) {
      rejected.push(`link references unknown user proposition: ${userPropositionId}`)
      continue
    }
    if (relationship !== 'alignment' && relationship !== 'conflict') {
      rejected.push(`${taskPropositionId} → ${userPropositionId}: invalid relationship`)
      continue
    }
    if (explanation === '') {
      rejected.push(`${taskPropositionId} → ${userPropositionId}: missing explanation`)
      continue
    }
    if (seen.has(key)) {
      rejected.push(`${taskPropositionId} → ${userPropositionId}: duplicate link`)
      continue
    }
    seen.add(key)
    links.push({ taskPropositionId, userPropositionId, relationship, explanation })
  }
  return links
}

export function parsePropositionComparison(
  value: unknown,
  reasoning: string,
  propositions: readonly Proposition[]
): PropositionComparison | null {
  if (typeof value !== 'object' || value === null) return null
  return parseComparisonWithDiagnostics(value, reasoning, propositions).comparison
}

function parseComparisonWithDiagnostics(
  value: object,
  reasoning: string,
  propositions: readonly Proposition[]
): ComparisonParseResult {
  const row = value as RawComparison
  const rejected: string[] = []
  const taskPropositions = readTaskPropositions(row.task_propositions, reasoning, rejected)
  const links = readLinks(row.links, taskPropositions, propositions, rejected)
  return { comparison: { taskPropositions, links }, rejected }
}

function describeComparison(
  comparison: PropositionComparison,
  propositions: readonly Proposition[]
): string {
  if (comparison.taskPropositions.length === 0) return 'no task-agent propositions'
  const userById = new Map(propositions.map((proposition) => [proposition.id, proposition]))
  return comparison.taskPropositions
    .map((taskProposition) => {
      const links = comparison.links.filter((link) => link.taskPropositionId === taskProposition.id)
      const head =
        `${taskProposition.id}: ${taskProposition.text}\n` +
        `  evidence: "${taskProposition.evidenceFromReasoning}"`
      if (links.length === 0) return `${head}\n  links: uncovered`
      const renderedLinks = links.map((link) => {
        const user = userById.get(link.userPropositionId)
        return (
          `  ${link.relationship} → ${link.userPropositionId}: ${user?.text ?? '(missing)'}\n` +
          `    because: ${link.explanation}`
        )
      })
      return `${head}\n${renderedLinks.join('\n')}`
    })
    .join('\n')
}

export async function compareReasoningWithUserModel(input: {
  request: string
  reasoning: string
  propositions: Proposition[]
}): Promise<void> {
  if (input.reasoning.trim() === '') return
  try {
    const result = await generateText({
      model: createUntracedLanguageModel(modelConfigForSlot('meta-agent')),
      system: PROPOSITION_COMPARISON_SYSTEM,
      prompt: renderPropositionComparisonPrompt(input),
      maxOutputTokens: 1536,
      providerOptions: backgroundProviderOptions('meta-agent'),
      tools: PROPOSITION_COMPARISON_TOOLS,
      toolChoice: { type: 'tool', toolName: 'record_proposition_comparison' }
    })
    const call = result.staticToolCalls[0]
    const parsed = parseComparisonWithDiagnostics(call.input, input.reasoning, input.propositions)
    const raw = JSON.stringify(call.input, null, 2)
    const rejected =
      parsed.rejected.length > 0 ? parsed.rejected.map((item) => `- ${item}`).join('\n') : '(none)'
    logPropositionComparison(
      input.reasoning.length,
      `RAW OUTPUT\n${raw}\n\nREJECTED\n${rejected}\n\nACCEPTED\n${describeComparison(parsed.comparison, input.propositions)}`
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    logPropositionComparison(input.reasoning.length, `failed — ${detail}`)
  }
}
