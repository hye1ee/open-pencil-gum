import { koreanOutputInstruction } from '@/app/study/language'

export const REASONING_FEEDBACK_DRAFT_SYSTEM = `You draft a short, editable feedback message from a user to an agent.

Use only the supplied request and reasoning. Focus on the selected reasoning passage.
Write one actionable sentence in the user's voice, no more than 25 words.
Do not invent a preference, fact, or rationale that the context does not support.
Return only the sentence.${koreanOutputInstruction()}`

interface ReasoningFeedbackDraftPromptInput {
  request: string
  reasoningSoFar: string
  selectedReasoning: string
}

export function renderReasoningFeedbackDraftPrompt(
  input: ReasoningFeedbackDraftPromptInput
): string {
  return `USER REQUEST
${input.request}

REASONING SO FAR
${input.reasoningSoFar}

SELECTED REASONING
${input.selectedReasoning}

Draft the user's one-sentence feedback about the selected reasoning.`
}
