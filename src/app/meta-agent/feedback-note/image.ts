import { createOpenAI } from '@ai-sdk/openai'
import { generateImage } from 'ai'

import { feedbackImageApiKey } from '@/app/ai/model-routing'
import type { FeedbackNoteImageType } from '@/app/meta-agent/feedback-note/types'
import { isTauri } from '@/app/tauri/env'
import { tauriFetch } from '@/app/tauri/http'

const MODEL = 'gpt-image-2'

const STYLE = `Create one minimal visual feedback cue. Use a warm off-white background, charcoal hand-drawn lines, and at most one muted violet accent. Show only 2–6 essential shapes. Do not create a questionnaire, presentation, polished mockup, legend, heading, explanatory callout, or decorative label. Do not repeat the feedback cue. Use no prose; when labels are needed for meaning, use at most four labels of up to 3 words each. Do not visually favor an answer.`

const TYPE_GUIDE: Record<FeedbackNoteImageType, string> = {
  illustration:
    'Use concrete, recognizable subjects to express the idea with only the detail needed to compare or annotate it.',
  scene: 'Show a specific spatial or social situation whose meaning depends on the whole scene.',
  metaphor: 'Use one clear visual metaphor for an abstract quality or relationship.',
  texture: 'Make material, surface, and tactile character the main information.',
  'photographic-reference':
    'Create a photographic reference whose lighting, framing, or physical realism is necessary to judge the direction.',
  'expressive-style':
    'Make the overall expressive character, mark-making, mood, or visual voice the main information.'
}

export function buildFeedbackNoteImagePrompt(
  prompt: string,
  imageType: FeedbackNoteImageType,
  representationGoal: string
): string {
  return `${STYLE}\n\nImage type:\n${imageType}\n${TYPE_GUIDE[imageType]}\n\nFeedback goal:\n${representationGoal}\n\nContent to represent:\n${prompt}`
}

export async function generateFeedbackNoteImage(
  prompt: string,
  imageType: FeedbackNoteImageType,
  representationGoal: string
): Promise<string> {
  const apiKey = feedbackImageApiKey()
  if (!apiKey) throw new Error('OpenAI API key is not configured')
  const openai = createOpenAI({
    apiKey,
    fetch: isTauri() ? tauriFetch : undefined
  })
  const result = await generateImage({
    model: openai.image(MODEL),
    prompt: buildFeedbackNoteImagePrompt(prompt, imageType, representationGoal),
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
