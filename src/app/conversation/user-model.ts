import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { valibotSchema } from '@ai-sdk/valibot'
import { generateText, tool } from 'ai'
import * as v from 'valibot'

import { saveConversationPreferences } from '@/app/conversation/storage'
import type { ConversationFeedbackNote } from '@/app/conversation/types'
import { CHAT_USER_MODEL_SYSTEM } from '@/app/meta-agent/prompts/chat'
import type { Proposition } from '@/app/user-model/pipeline'

const updateTools = {
  update_conversation_user_model: tool({
    description: 'Return only the preference propositions that should be created or updated.',
    inputSchema: valibotSchema(
      v.object({
        updates: v.array(
          v.object({
            id: v.nullable(v.string()),
            text: v.string(),
            confidence: v.number(),
            rationale: v.string()
          })
        )
      })
    )
  })
}

function renderExisting(propositions: readonly Proposition[]): string {
  if (propositions.length === 0) return '(empty)'
  return propositions
    .map(
      (item) =>
        `- ${item.id}: ${item.text} (${Math.round(item.confidence * 9 + 1)}/10)${item.rationale ? ` — ${item.rationale}` : ''}`
    )
    .join('\n')
}

interface LearnOptions {
  apiKey: string
  modelId: string
  note: ConversationFeedbackNote
  reply: string | null
  propositions: readonly Proposition[]
}

export async function learnConversationPreferences(options: LearnOptions): Promise<Proposition[]> {
  const google = createGoogleGenerativeAI({ apiKey: options.apiKey })
  const outcome = options.reply
    ? `EXPLICIT FEEDBACK\n${options.reply}`
    : 'OUTCOME\nThe user reviewed this note and chose Continue without a correction.'
  const prompt = `CURRENT USER MODEL
${renderExisting(options.propositions)}

REVIEWED DECISION
Relationship: ${options.note.relationship}
Cue: ${options.note.cue}
Reasoning evidence: "${options.note.reasoningEvidence}"
Connected proposition ids: ${options.note.propositionIds.join(', ') || '(none)'}

${outcome}`

  const result = await generateText({
    model: google(options.modelId),
    system: CHAT_USER_MODEL_SYSTEM,
    prompt,
    maxOutputTokens: 1024,
    providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
    tools: updateTools,
    toolChoice: { type: 'tool', toolName: 'update_conversation_user_model' }
  })
  const call = result.staticToolCalls.at(0)
  if (!call) return [...options.propositions]

  const next = options.propositions.map((item) => ({ ...item }))
  const stamp = new Date().toISOString()
  for (const update of call.input.updates) {
    const existing = update.id ? next.find((item) => item.id === update.id) : undefined
    const confidence = (Math.min(10, Math.max(1, update.confidence)) - 1) / 9
    if (existing) {
      if (existing.text !== update.text.trim()) existing.revisions += 1
      existing.text = update.text.trim()
      existing.confidence = confidence
      existing.reasoning = `Conversation feedback on: ${options.note.cue}`
      existing.rationale = update.rationale.trim() || null
      existing.rationaleGrounds = options.reply ?? options.note.reasoningEvidence
      existing.updatedAt = stamp
      existing.observations += 1
      continue
    }
    const text = update.text.trim()
    if (text === '') continue
    next.push({
      id: crypto.randomUUID(),
      text,
      confidence,
      decay: 0.25,
      reasoning: `Conversation feedback on: ${options.note.cue}`,
      rationale: update.rationale.trim() || null,
      rationaleGrounds: options.reply ?? options.note.reasoningEvidence,
      rationaleFrom: [],
      createdAt: stamp,
      updatedAt: stamp,
      observations: 1,
      embedding: [],
      originalText: text,
      originalEmbedding: [],
      revisions: 0
    })
  }
  await saveConversationPreferences(next)
  return next
}
