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

/** Longest edge (px) of the injected canvas image. Larger = clearer but more
 * image tokens (Anthropic ≈ w×h/750). 1400 keeps a full page legible while
 * staying under the ~1568px/1.15MP ceiling where the API downscales anyway. */
const MAX_IMAGE_LONG_EDGE = 1400

/**
 * Master switch for the whole feature (default on). Set VITE_CANVAS_VISION=false
 * to run the same task without the image (e.g. to compare describe-call counts
 * and token usage with vision on vs off).
 */
export const CANVAS_VISION_ENABLED = import.meta.env.VITE_CANVAS_VISION !== 'false'

interface CachedImage {
  sceneVersion: number
  part: ImagePart
}

export interface CanvasVision {
  /** Clear the cache before a new run. */
  reset(): void
  /** The current canvas as an image part, or null (vision off / empty / no
   * renderer). Cached by sceneVersion so describe-only steps don't re-render. */
  imagePart(): Promise<ImagePart | null>
}

export function createCanvasVision(store: EditorStore): CanvasVision {
  let cache: CachedImage | null = null

  return {
    reset() {
      cache = null
    },
    async imagePart() {
      if (!CANVAS_VISION_ENABLED) return null

      const sceneVersion = store.state.sceneVersion
      if (cache && cache.sceneVersion === sceneVersion) return cache.part

      const pageId = store.state.currentPageId
      const ids = store.graph.getChildren(pageId).map((n) => n.id)
      if (ids.length === 0) return null

      const bounds = computeContentBounds(store.graph, ids)
      if (!bounds) return null
      const maxDim = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
      if (maxDim <= 0) return null
      const scale = Math.min(1, MAX_IMAGE_LONG_EDGE / maxDim)

      // Empty ids ⇒ whole page; returns null if there's no renderer (headless).
      const bytes = await store.renderExportImage([], scale, 'PNG')
      if (!bytes) return null

      const part: ImagePart = { type: 'image', image: bytes, mediaType: 'image/png' }
      cache = { sceneVersion, part }
      return part
    }
  }
}
