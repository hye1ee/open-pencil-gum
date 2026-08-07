import type { Canvas, Paint } from 'canvaskit-wasm'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { FLASH_PADDING, FLASH_STROKE_WIDTH, FLASH_RADIUS } from '#core/constants'

import type { SkiaRenderer } from './renderer'

export function ensureFlashPaint(r: SkiaRenderer): Paint {
  if (!r._flashPaint) {
    r._flashPaint = new r.ck.Paint()
    r._flashPaint.setStyle(r.ck.PaintStyle.Stroke)
    r._flashPaint.setAntiAlias(true)
  }
  return r._flashPaint
}

/** Separate from the flash paint because the glow pass hangs a blur mask
 * filter on it — sharing one paint would leak that blur into every flash. */
export function ensureGlowPaint(r: SkiaRenderer): Paint {
  if (!r._aiGlowPaint) {
    r._aiGlowPaint = new r.ck.Paint()
    r._aiGlowPaint.setStyle(r.ck.PaintStyle.Stroke)
    r._aiGlowPaint.setAntiAlias(true)
  }
  return r._aiGlowPaint
}

export function drawNodeHighlightRect(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  nodeId: string,
  color: { r: number; g: number; b: number },
  opacity: number,
  extraPad = 0,
  overrides?: { paint?: Paint; strokeWidth?: number; padding?: number }
): boolean {
  const node = graph.getNode(nodeId)
  if (!node) return false

  const abs = graph.getAbsolutePosition(nodeId)
  const cx = (abs.x + node.width / 2) * r.zoom + r.panX
  const cy = (abs.y + node.height / 2) * r.zoom + r.panY
  const hw = (node.width / 2) * r.zoom
  const hh = (node.height / 2) * r.zoom
  const pad = (overrides?.padding ?? FLASH_PADDING) + extraPad

  const paint = overrides?.paint ?? ensureFlashPaint(r)
  paint.setColor(r.ck.Color4f(color.r, color.g, color.b, opacity))
  paint.setStrokeWidth(overrides?.strokeWidth ?? FLASH_STROKE_WIDTH)

  canvas.save()
  if (node.rotation !== 0) canvas.rotate(node.rotation, cx, cy)
  const rect = r.ck.RRectXY(
    r.ck.LTRBRect(cx - hw - pad, cy - hh - pad, cx + hw + pad, cy + hh + pad),
    FLASH_RADIUS,
    FLASH_RADIUS
  )
  canvas.drawRRect(rect, paint)
  canvas.restore()
  return true
}
