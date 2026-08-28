import { generateText } from 'ai'

import { createUntracedLanguageModel } from '@/app/ai/chat/model'
import { backgroundProviderOptions, modelConfigForSlot } from '@/app/ai/model-routing'
import { buildInteractiveCodeVisualDocument } from '@/app/meta-agent/feedback-note/code-visual/document'
import { inspectCodeVisualHtml } from '@/app/meta-agent/feedback-note/code-visual/html'
import {
  CODE_VISUAL_SYSTEM,
  renderCodeVisualComposerPrompt
} from '@/app/meta-agent/feedback-note/code-visual/prompt'
import { inspectCodeVisualSvg } from '@/app/meta-agent/feedback-note/code-visual/svg'
import { CODE_VISUAL_TOOLS } from '@/app/meta-agent/feedback-note/code-visual/tools'
import type {
  CodeVisualArtifact,
  CodeVisualTarget,
  FeedbackNote,
  FeedbackNoteCodeVisualType
} from '@/app/meta-agent/feedback-note/types'

interface RawHtmlArtifact {
  html?: unknown
  css?: unknown
  targets?: unknown
}

interface RawSvgArtifact {
  svg?: unknown
  targets?: unknown
}

interface RawCodeVisualTarget {
  id?: unknown
  label?: unknown
}

export function codeVisualToolName(
  visualType: FeedbackNoteCodeVisualType
): 'render_code_visual_html' | 'render_code_visual_svg' {
  return visualType === 'flow' ? 'render_code_visual_svg' : 'render_code_visual_html'
}

function readTargets(value: unknown, source: string): CodeVisualTarget[] | null {
  const labels = new Map<string, string>()
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'object' || item === null) continue
      const row = item as RawCodeVisualTarget
      const id = typeof row.id === 'string' ? row.id.trim() : ''
      const label = typeof row.label === 'string' ? row.label.trim().slice(0, 60) : ''
      if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && label) labels.set(id, label)
    }
  }

  const sourceIds = [...source.matchAll(/data-feedback-id\s*=\s*["']([^"']+)["']/gi)]
    .map((match) => match[1]?.trim() ?? '')
    .filter((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))
  const uniqueSourceIds = [...new Set(sourceIds)]
  if (uniqueSourceIds.length < 1 || uniqueSourceIds.length > 6) return null

  return uniqueSourceIds.map((id): CodeVisualTarget => {
    const fallbackLabel = id
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
      .slice(0, 60)
    return { id, label: labels.get(id) ?? fallbackLabel }
  })
}

export async function composeCodeVisual(note: FeedbackNote): Promise<CodeVisualArtifact> {
  if (note.representation.type !== 'code-visual') {
    throw new Error('Code Visual Composer requires a code-visual note')
  }
  const expectedToolName = codeVisualToolName(note.representation.visualType)
  const result = await generateText({
    model: createUntracedLanguageModel(modelConfigForSlot('meta-agent')),
    system: CODE_VISUAL_SYSTEM,
    prompt: renderCodeVisualComposerPrompt({
      visualType: note.representation.visualType,
      feedbackCue: note.text,
      goal: note.representationGoal,
      brief: note.representation.brief
    }),
    maxOutputTokens: 4096,
    providerOptions: backgroundProviderOptions('meta-agent'),
    tools: CODE_VISUAL_TOOLS,
    toolChoice: { type: 'tool', toolName: expectedToolName }
  })
  const call = result.staticToolCalls[0]
  if (call?.toolName === 'render_code_visual_html') {
    const input = call.input as RawHtmlArtifact
    const inspection = inspectCodeVisualHtml(input.html, input.css)
    const srcdoc = inspection.content
    const targets = readTargets(input.targets, typeof input.html === 'string' ? input.html : '')
    if (srcdoc && targets) {
      return {
        format: 'html',
        targets,
        srcdoc: buildInteractiveCodeVisualDocument({
          format: 'html',
          content: srcdoc,
          noteId: note.id,
          targets
        })
      }
    }
    throw new Error(
      `HTML artifact rejected (content=${srcdoc ? 'valid' : `invalid:${inspection.rejection}`}, targets=${targets ? 'valid' : 'invalid'}, ${typeof input.html === 'string' ? input.html.length : 0} HTML chars, ${typeof input.css === 'string' ? input.css.length : 0} CSS chars)`
    )
  }
  if (call?.toolName === 'render_code_visual_svg') {
    const input = call.input as RawSvgArtifact
    const inspection = inspectCodeVisualSvg(input.svg)
    const svg = inspection.content
    const targets = readTargets(input.targets, typeof input.svg === 'string' ? input.svg : '')
    if (svg && targets) {
      return {
        format: 'svg',
        targets,
        srcdoc: buildInteractiveCodeVisualDocument({
          format: 'svg',
          content: svg,
          noteId: note.id,
          targets
        })
      }
    }
    throw new Error(
      `SVG artifact rejected (content=${svg ? 'valid' : `invalid:${inspection.rejection}`}, targets=${targets ? 'valid' : 'invalid'}, ${typeof input.svg === 'string' ? input.svg.length : 0} chars)`
    )
  }
  const returnedTools = result.staticToolCalls.map((toolCall) => toolCall.toolName).join(',')
  throw new Error(
    `Code Visual Composer returned an invalid artifact (expected=${expectedToolName}, calls=${returnedTools || 'none'}, finish=${result.finishReason}, text=${result.text.length} chars)`
  )
}
