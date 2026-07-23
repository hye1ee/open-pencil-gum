import type { Canvas } from 'canvaskit-wasm'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { drawNodeHighlightRect, ensureAttentionPaint } from '#core/canvas/highlight-rect'
import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  AI_ACTIVE_COLOR,
  AI_ATTENTION_BLUR_SIGMA,
  AI_ATTENTION_COLOR,
  AI_ATTENTION_EDGE_WIDTH,
  AI_ATTENTION_GLOW_WIDTH,
  AI_ATTENTION_PADDING,
  AI_DONE_COLOR,
  AI_PULSE_PERIOD_MS,
  AI_DONE_DURATION_MS
} from '#core/constants'

/**
 * The agent's attention: nodes it has declared it is working on, drawn as a
 * soft pulsing glow. Only visible while the user peeks (` held) or during the
 * brief auto-reveal right after the agent moves it — the rest of the time the
 * canvas stays clean.
 *
 * Two passes per node: a wide blurred stroke for the glow, then a thin crisp
 * one so the shape stays readable against busy artwork.
 */
function drawAttention(r: SkiaRenderer, canvas: Canvas, graph: SceneGraph, now: number): void {
  if (!r._aiAttentionVisible || r._aiAttentionNodes.size === 0) return

  const phase = (now % AI_PULSE_PERIOD_MS) / AI_PULSE_PERIOD_MS
  const pulse = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2)
  const paint = ensureAttentionPaint(r)

  paint.setMaskFilter(r.getCachedMaskBlur(AI_ATTENTION_BLUR_SIGMA))
  for (const nodeId of r._aiAttentionNodes) {
    drawNodeHighlightRect(r, canvas, graph, nodeId, AI_ATTENTION_COLOR, 0.3 + 0.35 * pulse, 0, {
      paint,
      strokeWidth: AI_ATTENTION_GLOW_WIDTH,
      padding: AI_ATTENTION_PADDING
    })
  }

  // Always reset — the paint is reused next frame and a stale filter would blur
  // the crisp edge too (same convention as the shadow renderer).
  paint.setMaskFilter(null)
  for (const nodeId of r._aiAttentionNodes) {
    drawNodeHighlightRect(r, canvas, graph, nodeId, AI_ATTENTION_COLOR, 0.5 + 0.4 * pulse, 0, {
      paint,
      strokeWidth: AI_ATTENTION_EDGE_WIDTH,
      padding: AI_ATTENTION_PADDING
    })
  }
}

export function drawAiOverlays(r: SkiaRenderer, canvas: Canvas, graph: SceneGraph): void {
  const now = performance.now()

  // First, so a done-flash on the same node still reads on top of the glow.
  drawAttention(r, canvas, graph, now)

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
