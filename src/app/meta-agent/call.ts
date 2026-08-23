import { generateText } from 'ai'

import { beginMetaAgentActivity } from '@/app/ai/chat/agent-activity'
import { createUntracedLanguageModel } from '@/app/ai/chat/model'
import { backgroundProviderOptions, modelConfigForSlot } from '@/app/ai/model-routing'
import type { MarkToolCall } from '@/app/meta-agent/judge'
import { MARK_TOOLS } from '@/app/meta-agent/tools'

const JUDGE_MAX_TOKENS = 2048

export async function callMetaAgent(system: string, prompt: string): Promise<MarkToolCall[]> {
  const finishActivity = beginMetaAgentActivity()
  try {
    const result = await generateText({
      model: createUntracedLanguageModel(modelConfigForSlot('meta-agent')),
      system,
      maxOutputTokens: JUDGE_MAX_TOKENS,
      providerOptions: backgroundProviderOptions('meta-agent'),
      prompt,
      tools: MARK_TOOLS,
      toolChoice: 'auto'
    })
    return result.staticToolCalls.map(
      (call): MarkToolCall => ({ toolName: call.toolName, input: call.input })
    )
  } finally {
    finishActivity()
  }
}
