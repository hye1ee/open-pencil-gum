import type { Canvas } from 'canvaskit-wasm'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { drawNodeHighlightRect, ensureGlowPaint } from '#core/canvas/highlight-rect'
import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  AI_ACTIVE_COLOR,
  AI_DONE_COLOR,
  AI_DONE_DURATION_MS,
  AI_FEEDBACK_HIGHLIGHT_ALIGNMENT_COLOR,
  AI_FEEDBACK_HIGHLIGHT_BLUR_SIGMA,
  AI_FEEDBACK_HIGHLIGHT_CONFLICT_COLOR,
  AI_FEEDBACK_HIGHLIGHT_EDGE_WIDTH,
  AI_FEEDBACK_HIGHLIGHT_GLOW_WIDTH,
  AI_FEEDBACK_HIGHLIGHT_MAX_STRENGTH,
  AI_FEEDBACK_HIGHLIGHT_PADDING,
  AI_FEEDBACK_HIGHLIGHT_PULSE_DEPTH,
  AI_FEEDBACK_HIGHLIGHT_PULSE_MS,
  AI_FEEDBACK_HIGHLIGHT_UNCOVERED_COLOR,
  AI_PULSE_PERIOD_MS
} from '#core/constants'

/**
 * Highlights the canvas node linked to an active Feedback Note. Two passes per
 * node create a wide glow and a crisp edge while the signed relationship value
 * selects conflict, alignment, or uncovered styling.
 */
const UNCOVERED_STRENGTH = 0.45

function drawFeedbackHighlights(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  now: number
): void {
  if (r._aiFeedbackHighlights.size === 0) return
  const paint = ensureGlowPaint(r)
  const phase = (now % AI_FEEDBACK_HIGHLIGHT_PULSE_MS) / AI_FEEDBACK_HIGHLIGHT_PULSE_MS
  const pulse = 1 - AI_FEEDBACK_HIGHLIGHT_PULSE_DEPTH * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2))
  const strength = (relationshipLevel: number) =>
    relationshipLevel === 0
      ? UNCOVERED_STRENGTH
      : Math.min(
          1,
          Math.max(0, (Math.abs(relationshipLevel) - 1) / (AI_FEEDBACK_HIGHLIGHT_MAX_STRENGTH - 1))
        )
  const color = (relationshipLevel: number) => {
    if (relationshipLevel === 0) return AI_FEEDBACK_HIGHLIGHT_UNCOVERED_COLOR
    return relationshipLevel < 0
      ? AI_FEEDBACK_HIGHLIGHT_CONFLICT_COLOR
      : AI_FEEDBACK_HIGHLIGHT_ALIGNMENT_COLOR
  }

  paint.setMaskFilter(r.getCachedMaskBlur(AI_FEEDBACK_HIGHLIGHT_BLUR_SIGMA))
  for (const [nodeId, relationshipLevel] of r._aiFeedbackHighlights) {
    const opacity = (0.12 + 0.33 * strength(relationshipLevel)) * pulse
    drawNodeHighlightRect(r, canvas, graph, nodeId, color(relationshipLevel), opacity, 0, {
      paint,
      strokeWidth: AI_FEEDBACK_HIGHLIGHT_GLOW_WIDTH,
      padding: AI_FEEDBACK_HIGHLIGHT_PADDING
    })
  }

  // Always reset — the paint is reused next frame and a stale filter would blur
  // the crisp edge too (same convention as the shadow renderer).
  paint.setMaskFilter(null)
  for (const [nodeId, relationshipLevel] of r._aiFeedbackHighlights) {
    const opacity = (0.25 + 0.45 * strength(relationshipLevel)) * pulse
    drawNodeHighlightRect(r, canvas, graph, nodeId, color(relationshipLevel), opacity, 0, {
      paint,
      strokeWidth: AI_FEEDBACK_HIGHLIGHT_EDGE_WIDTH,
      padding: AI_FEEDBACK_HIGHLIGHT_PADDING
    })
  }
}

export function drawAiOverlays(r: SkiaRenderer, canvas: Canvas, graph: SceneGraph): void {
  const now = performance.now()

  // First, so a done-flash on the same node still reads on top of the glow.
  drawFeedbackHighlights(r, canvas, graph, now)

  for (const nodeId of r._aiActiveNodes) {
    const phase = (now % AI_PULSE_PERIOD_MS) / AI_PULSE_PERIOD_MS
    const opacity = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2))
    drawNodeHighlightRect(r, canvas, graph, nodeId, AI_ACTIVE_COLOR, opacity)
  }

  for (let i = r._aiDoneFlashes.length - 1; i >= 0; i--) {
    const flash = r._aiDoneFlashes[i]
    const elapsed = now - flash.startTime
    if (elapsed > AI_DONE_DURATION_MS) {
      r._aiDoneFlashes.splice(i, 1)
      continue
    }
    const t = elapsed / AI_DONE_DURATION_MS
    const opacity = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7
    drawNodeHighlightRect(r, canvas, graph, flash.nodeId, AI_DONE_COLOR, opacity)
  }
}
