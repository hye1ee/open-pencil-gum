import { computeAllLayouts } from '@open-pencil/core/layout'
import { FigmaAPI } from '@open-pencil/core/figma-api'

import type { EditorStore } from '@/app/editor/active-store'
import { ensureGraphFonts, listFamilies, listFonts } from '@/app/editor/fonts'

/** Progressive render tuning — reveal this many finished elements, then repaint + pause.
 *  Smaller size = more granular; larger delay = slower, more deliberate build. */
const RENDER_CHUNK_SIZE = 1
const RENDER_CHUNK_DELAY_MS = 500

/** Wait ~one paint: yields to the event loop long enough for the renderer's rAF to draw. */
function waitForPaint(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export function makeFigmaFromStore(store: EditorStore): FigmaAPI {
  const api = new FigmaAPI(store.graph)
  api.setRenderer(store.renderer ?? null)
  api.currentPage = api.wrapNode(store.state.currentPageId)
  api.currentPage.selection = [...store.state.selectedIds]
    .map((id) => api.getNodeById(id))
    .filter((n): n is NonNullable<typeof n> => n !== null)
  api.viewport = {
    center: {
      x: (-store.state.panX + window.innerWidth / 2) / store.state.zoom,
      y: (-store.state.panY + window.innerHeight / 2) / store.state.zoom
    },
    zoom: store.state.zoom
  }
  api.exportImage = (nodeIds, opts) =>
    store.renderExportImage(nodeIds, opts.scale ?? 1, opts.format ?? 'PNG')
  api.renderChunk = {
    size: RENDER_CHUNK_SIZE,
    flush: async () => {
      // Load fonts for text created so far BEFORE painting, otherwise CanvasKit
      // caches tofu (□) glyphs shaped without the font. ensureGraphFonts clears
      // those cached pictures and returns true when new fonts actually loaded.
      const pageId = store.state.currentPageId
      const pageNode = store.graph.getNode(pageId)
      if (pageNode) {
        const loaded = await ensureGraphFonts(store.graph, pageNode.childIds)
        if (loaded) computeAllLayouts(store.graph, pageId)
      }
      store.requestRender()
      await waitForPaint(RENDER_CHUNK_DELAY_MS)
    }
  }
  api.listAvailableFontsAsync = async () => {
    const [systemFonts, familyOptions] = await Promise.all([listFonts(), listFamilies()])
    const fonts = systemFonts.flatMap(({ family, styles }) =>
      styles.map((style) => ({ fontName: { family, style } }))
    )
    const seenFamilies = new Set(systemFonts.map(({ family }) => family))
    for (const { family } of familyOptions) {
      if (!seenFamilies.has(family)) fonts.push({ fontName: { family, style: 'Regular' } })
    }
    return fonts
  }
  return api
}
