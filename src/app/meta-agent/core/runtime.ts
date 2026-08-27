import { generateText } from 'ai'

import { createUntracedLanguageModel } from '@/app/ai/chat/model'
import { backgroundProviderOptions, modelConfigForSlot } from '@/app/ai/model-routing'
import { META_AGENT_FEEDBACK_NOTE_TOOLS } from '@/app/meta-agent/core/tools'
import type { FeedbackNoteRelationship } from '@/app/meta-agent/core/types'

const META_AGENT_MAX_OUTPUT_TOKENS = 2048

export interface MetaAgentRuntimeInput {
  system: string
  prompt: string
}

export interface MetaAgentRawToolCall {
  toolName: string
  input: unknown
}

export interface MetaAgentDecision {
  relationship: FeedbackNoteRelationship
  payload: unknown
}

export interface MetaAgentModelCaller {
  generate(input: MetaAgentRuntimeInput): Promise<readonly MetaAgentRawToolCall[]>
}

const DEFAULT_MODEL_CALLER: MetaAgentModelCaller = {
  async generate(input) {
    const result = await generateText({
      model: createUntracedLanguageModel(modelConfigForSlot('meta-agent')),
      system: input.system,
      prompt: input.prompt,
      maxOutputTokens: META_AGENT_MAX_OUTPUT_TOKENS,
      providerOptions: backgroundProviderOptions('meta-agent'),
      tools: META_AGENT_FEEDBACK_NOTE_TOOLS,
      toolChoice: 'auto'
    })
    return result.staticToolCalls.map((call) => ({
      toolName: call.toolName,
      input: call.input
    }))
  }
}

function relationshipForTool(toolName: string): FeedbackNoteRelationship | null {
  if (toolName === 'create_alignment_feedback_note') return 'alignment'
  if (toolName === 'create_conflict_feedback_note') return 'conflict'
  if (toolName === 'create_uncovered_feedback_note') return 'uncovered'
  return null
}

/**
 * Runs one host-neutral Meta Agent judgment. Hosts own prompt construction,
 * note storage, representation materialization, and intervention behavior.
 */
export async function runMetaAgent(
  input: MetaAgentRuntimeInput,
  caller: MetaAgentModelCaller = DEFAULT_MODEL_CALLER
): Promise<MetaAgentDecision[]> {
  const calls = await caller.generate(input)
  return calls.slice(0, 1).flatMap((call): MetaAgentDecision[] => {
    const relationship = relationshipForTool(call.toolName)
    return relationship ? [{ relationship, payload: call.input }] : []
  })
}
