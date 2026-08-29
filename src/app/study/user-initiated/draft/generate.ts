import { generateText } from 'ai'

import { createUntracedLanguageModel } from '@/app/ai/chat/model'
import {
  backgroundProviderOptions,
  isSlotConfigured,
  modelConfigForSlot
} from '@/app/ai/model-routing'
import {
  REASONING_FEEDBACK_DRAFT_SYSTEM,
  renderReasoningFeedbackDraftPrompt
} from '@/app/study/user-initiated/draft/prompt'

export interface ReasoningFeedbackDraftRequest {
  request: string
  reasoningSoFar: string
  selectedReasoning: string
}

export async function generateReasoningFeedbackDraft(
  input: ReasoningFeedbackDraftRequest
): Promise<string | null> {
  if (!isSlotConfigured('feedback-draft') || input.selectedReasoning.trim() === '') return null

  const result = await generateText({
    model: createUntracedLanguageModel(modelConfigForSlot('feedback-draft')),
    system: REASONING_FEEDBACK_DRAFT_SYSTEM,
    prompt: renderReasoningFeedbackDraftPrompt(input),
    maxOutputTokens: 60,
    providerOptions: backgroundProviderOptions('feedback-draft')
  })

  return result.text.trim().replace(/^['“”"]+|['“”"]+$/g, '') || null
}
