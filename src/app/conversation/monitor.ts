import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { valibotSchema } from '@ai-sdk/valibot'
import { generateText, tool } from 'ai'
import * as v from 'valibot'

import type { ReasoningObserver } from '@/app/ai/chat/model-trace'
import type { ConversationFeedbackNote } from '@/app/conversation/types'
import type { MonitoredDomainContext } from '@/app/meta-agent/context/types'
import { CHAT_MONITOR_SYSTEM, renderChatMonitorPrompt } from '@/app/meta-agent/prompts/chat'

const monitorTools = {
  record_feedback_note: tool({
    description: 'Record the single strongest review point, or explicitly record that none exists.',
    inputSchema: valibotSchema(
      v.object({
        should_interrupt: v.boolean(),
        relationship: v.picklist(['alignment', 'conflict', 'uncovered']),
        cue: v.string(),
        evidence_from_reasoning: v.string(),
        proposition_ids: v.array(v.string())
      })
    )
  })
}

interface ConversationMonitorOptions {
  apiKey: string
  modelId: string
  getContext(): MonitoredDomainContext
  getMessageId(): string | null
  onActivity(active: boolean): void
  onReasoningChunk(chunk: string): void
  onFeedback(note: ConversationFeedbackNote): void
}

function exactEvidence(reasoning: string, evidence: string): boolean {
  const flat = (value: string) => value.replaceAll(/\s+/g, ' ').trim().toLowerCase()
  return evidence.trim() !== '' && flat(reasoning).includes(flat(evidence))
}

export function createConversationMonitor(options: ConversationMonitorOptions): ReasoningObserver {
  const tasks = new Map<number, Promise<void>>()

  async function review(reasoning: string): Promise<void> {
    if (reasoning.trim() === '') return
    options.onActivity(true)
    try {
      const google = createGoogleGenerativeAI({ apiKey: options.apiKey })
      const result = await generateText({
        model: google(options.modelId),
        system: CHAT_MONITOR_SYSTEM,
        prompt: renderChatMonitorPrompt(options.getContext(), reasoning),
        maxOutputTokens: 768,
        providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
        tools: monitorTools,
        toolChoice: { type: 'tool', toolName: 'record_feedback_note' }
      })
      const call = result.staticToolCalls.at(0)
      if (!call) return
      const input = call.input
      if (!input.should_interrupt || !exactEvidence(reasoning, input.evidence_from_reasoning))
        return
      options.onFeedback({
        id: crypto.randomUUID(),
        messageId: options.getMessageId(),
        cue: input.cue.trim(),
        reasoningEvidence: input.evidence_from_reasoning.trim(),
        relationship: input.relationship,
        propositionIds: input.proposition_ids,
        createdAt: Date.now()
      })
    } catch (error) {
      console.warn('[conversation-monitor] review failed:', error)
    } finally {
      options.onActivity(false)
    }
  }

  return {
    start: (streamId) => {
      tasks.delete(streamId)
    },
    chunk: (_streamId, reasoningChunk) => {
      options.onReasoningChunk(reasoningChunk)
    },
    end: (streamId, reasoning) => {
      tasks.set(streamId, review(reasoning))
    },
    settled: (streamId) => tasks.get(streamId) ?? Promise.resolve()
  }
}
