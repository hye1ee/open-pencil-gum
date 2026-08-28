import { generateText } from 'ai'

import { createUntracedLanguageModel } from '@/app/ai/chat/model'
import { backgroundProviderOptions, modelConfigForSlot } from '@/app/ai/model-routing'
import { buildInteractiveCodeVisualDocument } from '@/app/feedback-note/code-visual/document'
import { inspectCodeVisualHtml } from '@/app/feedback-note/code-visual/html'
import {
  CODE_VISUAL_SYSTEM,
  renderCodeVisualComposerPrompt
} from '@/app/feedback-note/code-visual/prompt'
import { inspectCodeVisualSvg } from '@/app/feedback-note/code-visual/svg'
import { CODE_VISUAL_TOOLS } from '@/app/feedback-note/code-visual/tools'
import type {
  CodeVisualArtifact,
  CodeVisualTarget,
  FeedbackNote,
  FeedbackNoteCodeVisualType
} from '@/app/feedback-note/types'

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readTargets(value: unknown, source: string): CodeVisualTarget[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) return null
  const targets = value.flatMap((item): CodeVisualTarget[] => {
    if (typeof item !== 'object' || item === null) return []
    const row = item as RawCodeVisualTarget
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    const label = typeof row.label === 'string' ? row.label.trim().slice(0, 60) : ''
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !label) return []
    return [{ id, label }]
  })
  if (
    targets.length !== value.length ||
    new Set(targets.map((target) => target.id)).size !== targets.length
  ) {
    return null
  }
  const everyTargetExists = targets.every((target) =>
    new RegExp(`data-feedback-id\\s*=\\s*["']${escapeRegExp(target.id)}["']`).test(source)
  )
  return everyTargetExists ? targets : null
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
