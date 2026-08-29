import type { ConversationToolId } from '@/app/conversation/settings'

export const CHAT_TASK_SYSTEM = `You are a capable conversational assistant. Answer the user's request directly and accurately. Do not claim a tool was used when it was not.`

const TOOL_GUIDANCE: Record<ConversationToolId, string> = {
  google_search:
    '- google_search: Search for current or externally verifiable information. Cite sources supplied by search.',
  code_execution: '- code_execution: Run calculations or code that benefits from execution.',
  url_context: '- url_context: Read content from URLs supplied by the user.'
}

export function conversationToolInstructions(
  enabledTools: readonly ConversationToolId[]
): string {
  const guidance = enabledTools.map((tool) => TOOL_GUIDANCE[tool])
  if (guidance.length === 0) {
    return 'No external information tools are available. Continue without them and do not invent tool names.'
  }
  return `AVAILABLE TOOLS
Only call tools listed below. If a capability is not listed, continue without it rather than inventing a tool name.
${guidance.join('\n')}`
}
