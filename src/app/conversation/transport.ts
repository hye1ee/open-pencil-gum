import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { DirectChatTransport, stepCountIs, ToolLoopAgent } from 'ai'
import type { ChatTransport, ModelMessage, UIMessage } from 'ai'

import { withModelTrace } from '@/app/ai/chat/model-trace'
import type { ReasoningObserver } from '@/app/ai/chat/model-trace'
import type { ConversationTurnGate } from '@/app/conversation/gate'
import type { ConversationToolId } from '@/app/conversation/settings'
import { CHAT_TASK_SYSTEM } from '@/app/meta-agent/prompts/chat'
import type { Proposition } from '@/app/user-model/pipeline'

interface ConversationTransportOptions {
  apiKey: string
  modelId: string
  enabledTools: readonly ConversationToolId[]
  observer: ReasoningObserver
  gate: ConversationTurnGate
  getPropositions(): readonly Proposition[]
  takeRevisionFeedback(): string | null
  onActions(actions: string[]): void
}

function preferenceInstructions(propositions: readonly Proposition[]): string {
  if (propositions.length === 0) return ''
  const lines = propositions
    .filter((item) => item.confidence >= 0.35)
    .map((item) => `- ${item.text}`)
  if (lines.length === 0) return ''
  return `\n\nCONVERSATIONAL USER MODEL\nUse these as soft preferences unless the current request says otherwise:\n${lines.join('\n')}`
}

export function createConversationTransport(
  options: ConversationTransportOptions
): ChatTransport<UIMessage> {
  const google = createGoogleGenerativeAI({ apiKey: options.apiKey })
  const model = withModelTrace(google(options.modelId), {
    mode: 'conversation',
    reasoningObserver: options.observer,
    awaitResume: (point) => options.gate.awaitResume(point),
    gateOutput: true
  })
  const enabledTools = new Set(options.enabledTools)
  const tools = {
    ...(enabledTools.has('google_search') ? { google_search: google.tools.googleSearch({}) } : {}),
    ...(enabledTools.has('code_execution')
      ? { code_execution: google.tools.codeExecution({}) }
      : {}),
    ...(enabledTools.has('url_context') ? { url_context: google.tools.urlContext({}) } : {})
  }

  const agent = new ToolLoopAgent({
    model,
    instructions: CHAT_TASK_SYSTEM,
    tools,
    stopWhen: stepCountIs(8),
    maxOutputTokens: 8192,
    providerOptions: { google: { thinkingConfig: { includeThoughts: true } } },
    prepareCall: (call) => {
      const instructions = CHAT_TASK_SYSTEM + preferenceInstructions(options.getPropositions())
      const revision = options.takeRevisionFeedback()
      if (!revision) return { ...call, instructions }

      const revisionMessage: ModelMessage = {
        role: 'user',
        content:
          `[Internal revision instruction]\nThe user interrupted the previous answer before its next action. ` +
          `Regenerate the answer from the last stable user message and incorporate this feedback:\n${revision}`
      }

      if (call.messages != null) {
        return { ...call, instructions, messages: [...call.messages, revisionMessage] }
      }

      const prompt =
        typeof call.prompt === 'string'
          ? ([{ role: 'user', content: call.prompt }] satisfies ModelMessage[])
          : (call.prompt ?? [])
      return { ...call, instructions, prompt: [...prompt, revisionMessage] }
    },
    onStepFinish: (step) => {
      const actions = step.toolCalls.flatMap((call) => (call ? [call.toolName] : []))
      if (actions.length > 0) options.onActions(actions)
    }
  })

  return new DirectChatTransport({ agent, sendSources: true }) as ChatTransport<UIMessage>
}
