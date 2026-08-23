import { generateText } from 'ai'
import type { UserContent } from 'ai'

import { createUntracedLanguageModel } from '@/app/ai/chat/model'
import {
  backgroundProviderOptions,
  isSlotConfigured,
  modelConfigForSlot
} from '@/app/ai/model-routing'
import { relevantConfirmedFeedback } from '@/app/feedback-note/draft/history'
import { FEEDBACK_DRAFT_SYSTEM, renderFeedbackDraftPrompt } from '@/app/feedback-note/draft/prompt'
import type { FeedbackDraftInput } from '@/app/feedback-note/draft/types'
import { propositions } from '@/app/user-model/store'

export async function generateFeedbackDraft(input: FeedbackDraftInput): Promise<string | null> {
  if (!isSlotConfigured('feedback-draft')) return null
  const linkedIds = new Set(input.note.propositionIds)
  const relevantPropositions = propositions.value
    .filter((item) => linkedIds.has(item.id))
    .slice(0, 5)
  const previousFeedback = relevantConfirmedFeedback(input.note)
  const prompt = renderFeedbackDraftPrompt({
    note: input.note,
    selection: input.selection,
    propositions: relevantPropositions,
    previousFeedback,
    hasOverviewImage: input.overviewImage !== undefined,
    hasSelectionImage: input.selectionImage !== undefined
  })
  const content: UserContent = [{ type: 'text', text: prompt }]
  if (input.overviewImage) content.push({ type: 'image', image: input.overviewImage })
  if (input.selectionImage) content.push({ type: 'image', image: input.selectionImage })

  const result = await generateText({
    model: createUntracedLanguageModel(modelConfigForSlot('feedback-draft')),
    system: FEEDBACK_DRAFT_SYSTEM,
    messages: [{ role: 'user', content }],
    maxOutputTokens: 80,
    providerOptions: backgroundProviderOptions('feedback-draft')
  })
  return result.text.trim().replace(/^['“”"]+|['“”"]+$/g, '') || null
}
