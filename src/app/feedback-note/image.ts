import { createOpenAI } from '@ai-sdk/openai'
import { generateImage } from 'ai'

import { feedbackImageApiKey } from '@/app/ai/model-routing'
import type { FeedbackNoteVisualType } from '@/app/feedback-note/types'
import { isTauri } from '@/app/tauri/env'
import { tauriFetch } from '@/app/tauri/http'

const MODEL = 'gpt-image-2'

const STYLE = `Create one minimal visual feedback cue. Use a warm off-white background, charcoal hand-drawn lines, and at most one muted violet accent. Show only 2–6 essential shapes. Provide the minimum visual anchors needed for the requested pen gesture, but do not draw the person's answer. Do not create a questionnaire, presentation, polished mockup, legend, heading, explanatory callout, or decorative label. Do not repeat the question. Use no prose; when labels are needed for meaning, use at most four labels of up to 3 words each. Do not visually favor an answer.`

const TYPE_GUIDE: Record<FeedbackNoteVisualType, string> = {
  diagram:
    'Create a conceptual diagram using only the nodes, paths, boundaries, or stages needed to express the sequence or relationship. Do not draw an application screen, card layout, or interface fragment.',
  artifact:
    'Show only the smallest recognizable fragment of the actual visual result needed to judge color, spacing, proportion, placement, or emphasis. Do not turn it into a full interface or polished mockup.',
  illustration:
    'Use concrete, recognizable symbols to express the situation or abstract concept. Prioritize the relationship between the symbols over decorative detail.'
}

export function buildFeedbackNoteImagePrompt(
  prompt: string,
  annotationAffordance: string,
  visualType: FeedbackNoteVisualType,
  representationGoal: string
): string {
  return `${STYLE}\n\nRepresentation type:\n${visualType}\n${TYPE_GUIDE[visualType]}\n\nFeedback goal:\n${representationGoal}\n\nContent to represent:\n${prompt}\n\nAnnotation opportunity:\n${annotationAffordance}\nMake its visual anchors easy to mark, but do not draw the person's mark.`
}

export async function generateFeedbackNoteImage(
  prompt: string,
  annotationAffordance: string,
  visualType: FeedbackNoteVisualType,
  representationGoal: string
): Promise<string> {
  const apiKey = feedbackImageApiKey()
  if (!apiKey) throw new Error('OpenAI API key is not configured')
  const openai = createOpenAI({
    apiKey,
    fetch: isTauri() ? (tauriFetch as unknown as typeof globalThis.fetch) : undefined
  })
  const result = await generateImage({
    model: openai.image(MODEL),
    prompt: buildFeedbackNoteImagePrompt(
      prompt,
      annotationAffordance,
      visualType,
      representationGoal
    ),
    size: '1024x1024',
    providerOptions: {
      openai: {
        quality: 'low',
        outputFormat: 'jpeg',
        outputCompression: 70
      }
    }
  })
  return `data:${result.image.mediaType};base64,${result.image.base64}`
}
