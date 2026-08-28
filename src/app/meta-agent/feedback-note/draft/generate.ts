import { generateText } from 'ai'
import type { UserContent } from 'ai'

import { createUntracedLanguageModel } from '@/app/ai/chat/model'
import {
  backgroundProviderOptions,
  isSlotConfigured,
  modelConfigForSlot
} from '@/app/ai/model-routing'
import { FEEDBACK_DRAFT_SYSTEM, renderFeedbackDraftPrompt } from '@/app/meta-agent/feedback-note/draft/prompt'
import type { FeedbackDraftRequest } from '@/app/meta-agent/feedback-note/draft/types'

/** Host-neutral auto-feedback generation. The caller owns User Model state,
 * confirmed-feedback history, and visual capture; this function sees only the
 * explicit request assembled at that boundary. */
export async function generateFeedbackDraft(input: FeedbackDraftRequest): Promise<string | null> {
  if (!isSlotConfigured('feedback-draft')) return null
  const prompt = renderFeedbackDraftPrompt({
    note: input.note,
    selection: input.selection,
    propositions: input.propositions,
    previousFeedback: input.previousFeedback,
    hasOverviewImage: input.overviewImage !== undefined,
    hasAnnotatedImage: input.annotatedImage !== undefined
  })
  const content: UserContent = [{ type: 'text', text: prompt }]
  if (input.overviewImage) content.push({ type: 'image', image: input.overviewImage })
  if (input.annotatedImage) content.push({ type: 'image', image: input.annotatedImage })

  const result = await generateText({
    model: createUntracedLanguageModel(modelConfigForSlot('feedback-draft')),
    system: FEEDBACK_DRAFT_SYSTEM,
    messages: [{ role: 'user', content }],
    maxOutputTokens: 80,
    providerOptions: backgroundProviderOptions('feedback-draft')
  })
  return result.text.trim().replace(/^['“”"]+|['“”"]+$/g, '') || null
}
