import type { Canvas } from 'canvaskit-wasm'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { drawNodeHighlightRect, ensureGlowPaint } from '#core/canvas/highlight-rect'
import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  AI_ACTIVE_COLOR,
  AI_MISMATCH_BLUR_SIGMA,
  AI_MISMATCH_COLOR,
  AI_MISMATCH_EDGE_WIDTH,
  AI_MISMATCH_GLOW_WIDTH,
  AI_MISMATCH_MAX_SEVERITY,
  AI_MISMATCH_PADDING,
  AI_MISMATCH_PULSE_DEPTH,
  AI_MISMATCH_PULSE_MS,
  AI_DONE_COLOR,
  AI_PULSE_PERIOD_MS,
  AI_DONE_DURATION_MS
} from '#core/constants'

/**
 * Where what the agent is about to do looks unlike what this user wants.
 *
 * Brightness comes from the meta-agent's severity, not from the pulse. How often
 * the agent has returned to the idea is a separate thing and is shown as a number
 * on the badge instead — a mild idea pursued four times and a serious one raised
 * once both want attention, but the user has to be able to tell which is which.
 * The pulse rides on top at a fixed depth, so it says "still waiting on you"
 * without ever making a one-hit node look like a four-hit one. Slower than the
 * agent's own flashes — this stands for as long as the marker does, and a fast
 * blink on something that is not going away is just nagging.
 *
 * Two passes per node: a wide blurred stroke for the glow, then a thin crisp
 * one so the shape stays readable against busy artwork.
 */
function drawMismatch(r: SkiaRenderer, canvas: Canvas, graph: SceneGraph, now: number): void {
  if (r._aiMismatch.size === 0) return
  const paint = ensureGlowPaint(r)
  const phase = (now % AI_MISMATCH_PULSE_MS) / AI_MISMATCH_PULSE_MS
  const pulse = 1 - AI_MISMATCH_PULSE_DEPTH * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2))
  // 1 maps to nothing rather than a tenth, so the mildest objection is the
  // faintest glow the scale allows instead of an already-visible one.
  const strength = (severity: number) =>
    Math.min(1, Math.max(0, (severity - 1) / (AI_MISMATCH_MAX_SEVERITY - 1)))

  paint.setMaskFilter(r.getCachedMaskBlur(AI_MISMATCH_BLUR_SIGMA))
  for (const [nodeId, severity] of r._aiMismatch) {
    const opacity = (0.12 + 0.33 * strength(severity)) * pulse
    drawNodeHighlightRect(r, canvas, graph, nodeId, AI_MISMATCH_COLOR, opacity, 0, {
      paint,
      strokeWidth: AI_MISMATCH_GLOW_WIDTH,
      padding: AI_MISMATCH_PADDING
    })
  }

  // Always reset — the paint is reused next frame and a stale filter would blur
  // the crisp edge too (same convention as the shadow renderer).
  paint.setMaskFilter(null)
  for (const [nodeId, severity] of r._aiMismatch) {
    const opacity = (0.25 + 0.45 * strength(severity)) * pulse
    drawNodeHighlightRect(r, canvas, graph, nodeId, AI_MISMATCH_COLOR, opacity, 0, {
      paint,
      strokeWidth: AI_MISMATCH_EDGE_WIDTH,
      padding: AI_MISMATCH_PADDING
    })
  }
}

export function drawAiOverlays(r: SkiaRenderer, canvas: Canvas, graph: SceneGraph): void {
  const now = performance.now()

  // First, so a done-flash on the same node still reads on top of the glow.
  drawMismatch(r, canvas, graph, now)

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
