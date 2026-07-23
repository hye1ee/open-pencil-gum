import type { ImagePart } from 'ai'

import { computeContentBounds } from '@open-pencil/core/io'

import type { EditorStore } from '@/app/editor/active-store'

/**
 * Hybrid canvas vision for the AI tool loop.
 *
 * The ToolLoopAgent has no native vision — it perceives the canvas only through
 * text `describe`/`get_node` JSON, and repeatedly re-reads whole subtrees to see
 * its own work. That cost grows O(node count) as the design fills up.
 *
 * This injects a bounded canvas PNG into each step so the model grasps the
 * overall layout at ~fixed cost (one image ≈ O(1) tokens), while it keeps using
 * cheap targeted reads for exact ids/hex/positions. The image is a per-step,
 * non-persisted user message (assembled in transports), so it's always fresh and
 * never accumulates in history.
 *
 * Reuses the existing export pipeline (`renderExportImage` / `renderNodesToImage`)
 * — no new capture code. Only adds scale calc + a sceneVersion cache so idle /
 * describe-only steps don't trigger a re-render.
 */

/**
 * Longest edge (px) of the whole-page overview. Larger = clearer but more image
 * tokens (Anthropic ≈ w×h/750).
 *
 * Deliberately lower than the ~1568px/1.15MP ceiling: the overview only has to
 * carry composition and balance, because the attention capture below now carries
 * the detail. Spending the saved tokens on a tight crop buys far more than
 * spending them on a slightly sharper full page.
 */
const MAX_IMAGE_LONG_EDGE = 1000

/** Longest edge of the attention capture. Applied to a much smaller region, so
 * the effective resolution is several times the overview's. */
const MAX_ATTENTION_LONG_EDGE = 900

/** World px of surrounding canvas kept around the attention bounds. Without it
 * the crop can't answer "is this aligned with the thing next to it". */
const ATTENTION_CONTEXT_PADDING = 64

/**
 * Master switch for the whole feature (default on). Set VITE_CANVAS_VISION=false
 * to run the same task without the image (e.g. to compare describe-call counts
 * and token usage with vision on vs off).
 */
export const CANVAS_VISION_ENABLED = import.meta.env.VITE_CANVAS_VISION !== 'false'

interface CachedImage {
  sceneVersion: number
  /** Attention ids the capture was rendered for; '' for the whole-page overview. */
  key: string
  part: ImagePart
}

export interface CanvasVision {
  /** Clear the cache before a new run. */
  reset(): void
  /** The current canvas as an image part, or null (vision off / empty / no
   * renderer). Cached by sceneVersion so describe-only steps don't re-render. */
  imagePart(): Promise<ImagePart | null>
  /** A tight capture of what the agent said it is attending to, with a margin of
   * surrounding canvas. Null when nothing is in the attention set. Cached by
   * sceneVersion *and* the attention ids — the crop changes when either moves. */
  attentionPart(nodeIds: string[]): Promise<ImagePart | null>
}

/** Scale that lands the region's longest edge on `longEdge`, never upscaling. */
function fitScale(store: EditorStore, nodeIds: string[], longEdge: number, pad = 0): number | null {
  const bounds = computeContentBounds(store.graph, nodeIds)
  if (!bounds) return null
  const maxDim = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) + pad * 2
  if (maxDim <= 0) return null
  return Math.min(1, longEdge / maxDim)
}

export function createCanvasVision(store: EditorStore): CanvasVision {
  let cache: CachedImage | null = null
  let attentionCache: CachedImage | null = null

  return {
    reset() {
      cache = null
      attentionCache = null
    },
    async imagePart() {
      if (!CANVAS_VISION_ENABLED) return null

      const sceneVersion = store.state.sceneVersion
      if (cache && cache.sceneVersion === sceneVersion) return cache.part

      const pageId = store.state.currentPageId
      const ids = store.graph.getChildren(pageId).map((n) => n.id)
      if (ids.length === 0) return null

      const scale = fitScale(store, ids, MAX_IMAGE_LONG_EDGE)
      if (scale === null) return null

      // Empty ids ⇒ whole page; returns null if there's no renderer (headless).
      const bytes = await store.renderExportImage([], scale, 'PNG')
      if (!bytes) return null

      const part: ImagePart = { type: 'image', image: bytes, mediaType: 'image/png' }
      cache = { sceneVersion, key: '', part }
      return part
    },
    async attentionPart(nodeIds) {
      if (!CANVAS_VISION_ENABLED) return null

      // Nodes can be deleted mid-run; rendering a dead id throws in the bounds math.
      const live = nodeIds.filter((id) => store.graph.getNode(id))
      if (live.length === 0) return null

      const sceneVersion = store.state.sceneVersion
      const key = live.join(',')
      if (attentionCache && attentionCache.sceneVersion === sceneVersion && attentionCache.key === key) {
        return attentionCache.part
      }

      const scale = fitScale(store, live, MAX_ATTENTION_LONG_EDGE, ATTENTION_CONTEXT_PADDING)
      if (scale === null) return null

      const bytes = await store.renderExportImage(live, scale, 'PNG', ATTENTION_CONTEXT_PADDING)
      if (!bytes) return null

      const part: ImagePart = { type: 'image', image: bytes, mediaType: 'image/png' }
      attentionCache = { sceneVersion, key, part }
      return part
    }
  }
}
