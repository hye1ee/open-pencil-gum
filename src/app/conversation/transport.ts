import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { DirectChatTransport, stepCountIs, ToolLoopAgent } from 'ai'
import type { ChatTransport, ModelMessage, UIMessage } from 'ai'

import { CHAT_TASK_SYSTEM, conversationToolInstructions } from '@/app/conversation/prompt'
import type { ConversationToolId } from '@/app/conversation/settings'
import type { ChatTurnGate } from '@/app/meta-agent/hosts/lenchat/gate'
import { withChatModelTrace } from '@/app/meta-agent/hosts/lenchat/model-trace'
import type { ChatReasoningObserver } from '@/app/meta-agent/hosts/lenchat/types'
import { ASK_USER_AGENT_INSTRUCTIONS, createAskUserTool } from '@/app/study/ask-user'
import type { AskUserSession } from '@/app/study/ask-user'
import { isHandsOffDelegationCondition } from '@/app/study/runtime'
import type { StudyRuntimeConfig } from '@/app/study/runtime'
import type { Proposition } from '@/app/user-model/pipeline'

interface ConversationTransportOptions {
  apiKey: string
  modelId: string
  enabledTools: readonly ConversationToolId[]
  runtime: StudyRuntimeConfig
  askUserSession: AskUserSession
  observer: ChatReasoningObserver
  awaitReasoningReviews: boolean
  isSilentRevision(): boolean
  gate: ChatTurnGate
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

function taskInstructions(options: ConversationTransportOptions): string {
  const sections = [CHAT_TASK_SYSTEM, conversationToolInstructions(options.enabledTools)]
  if (options.runtime.askUserEnabled) sections.push(ASK_USER_AGENT_INSTRUCTIONS)
  if (options.runtime.taskAgentUsesUserModel) {
    sections.push(preferenceInstructions(options.getPropositions()))
  }
  return sections.filter(Boolean).join('\n\n')
}

export function createConversationTransport(
  options: ConversationTransportOptions
): ChatTransport<UIMessage> {
  const google = createGoogleGenerativeAI({ apiKey: options.apiKey })
  const runtime = options.runtime
  const model = withChatModelTrace(google(options.modelId), {
    observer: options.observer,
    awaitReasoningReviews: options.awaitReasoningReviews,
    reasoningMode: () => ({
      observe:
        (runtime.metaAgentEnabled ||
          runtime.allowFreeIntervention ||
          isHandsOffDelegationCondition(runtime.condition)) &&
        !options.isSilentRevision(),
      reveal: runtime.showRawReasoning && !options.isSilentRevision()
    }),
    awaitResume: (point) => options.gate.awaitResume(point),
    // Ask User can leave the next provider request vulnerable to a transient
    // browser SSE connection close after the user has spent time answering.
    // Keep recovery scoped to this study condition so already-tested LenChat
    // conditions and every LenCanvas transport retain their existing behavior.
    retryInitialNetworkFailure: runtime.condition === 'ask-user'
  })
  const enabledTools = new Set(options.enabledTools)
  const tools = {
    ...(enabledTools.has('google_search') ? { google_search: google.tools.googleSearch({}) } : {}),
    ...(enabledTools.has('code_execution')
      ? { code_execution: google.tools.codeExecution({}) }
      : {}),
    ...(enabledTools.has('url_context') ? { url_context: google.tools.urlContext({}) } : {}),
    ...(runtime.askUserEnabled ? { ask_user: createAskUserTool(options.askUserSession) } : {})
  }

  const agent = new ToolLoopAgent({
    model,
    instructions: taskInstructions(options),
    tools,
    stopWhen: stepCountIs(8),
    maxOutputTokens: 8192,
    providerOptions: { google: { thinkingConfig: { includeThoughts: true } } },
    prepareCall: (call) => {
      const instructions = taskInstructions(options)
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
