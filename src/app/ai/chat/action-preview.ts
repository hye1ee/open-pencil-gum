import { logTurnHeld } from '@/app/ai/chat/agent-log'
import { isTurnPaused } from '@/app/ai/chat/agent-turn'
import { getActiveEditorStore } from '@/app/editor/active-store'
import type { EditorStore } from '@/app/editor/active-store'

const REVEAL_MS = 2000
const REVEAL_START = 0

const stagedOriginals = new WeakMap<EditorStore, Map<string, number>>()

/** Hide a just-created result before its first paint. The tool only learns a
 * created node's id after execution, so this is called as soon as that result
 * is decoded and hands the original opacity to `previewAgentChange`. */
export function stageAgentChange(store: EditorStore, nodeIds: string[]): boolean {
  const originals = stagedOriginals.get(store) ?? new Map<string, number>()
  for (const id of nodeIds) {
    const node = store.graph.getNode(id)
    if (!node || originals.has(id)) continue
    originals.set(id, node.opacity)
    store.graph.updateNodePreview(id, { opacity: node.opacity * REVEAL_START })
  }
  if (originals.size === 0) return false
  stagedOriginals.set(store, originals)
  store.requestRepaint()
  return true
}

export function previewAgentChange(store: EditorStore, nodeIds: string[]): Promise<void> {
  const staged = stagedOriginals.get(store)
  const original = new Map<string, number>()
  for (const id of nodeIds) {
    const node = store.graph.getNode(id)
    const opacity = staged?.get(id) ?? node?.opacity
    if (opacity !== undefined) original.set(id, opacity)
    staged?.delete(id)
  }
  if (staged?.size === 0) stagedOriginals.delete(store)
  if (original.size === 0) return Promise.resolve()

  function write(factor: number): void {
    for (const [id, opacity] of original) {
      // The user may have deleted it while it was faint.
      if (store.graph.getNode(id)) store.graph.updateNodePreview(id, { opacity: opacity * factor })
    }
    store.requestRepaint()
  }

  const started = performance.now()
  return new Promise((resolve) => {
    let lastFrame = started
    let held = 0

    function frame(now: number): void {
      if (isTurnPaused()) held += now - lastFrame
      lastFrame = now
      const progress = Math.min(1, (now - started - held) / REVEAL_MS)
      const eased = 1 - (1 - progress) ** 3
      write(REVEAL_START + (1 - REVEAL_START) * eased)
      if (progress < 1) requestAnimationFrame(frame)
      else {
        if (held > 0) logTurnHeld('preview', held)
        resolve()
      }
    }

    write(REVEAL_START)
    requestAnimationFrame(frame)
  })
}

// Dev handle, so the fade can be watched without paying for an agent run:
//   __preview(['0:3', '0:4'])
if (import.meta.env.DEV) {
  Object.assign(window, {
    __preview: (nodeIds: string[]) => previewAgentChange(getActiveEditorStore(), nodeIds),
    /** So a test can prove the faint opacity never outlives the preview. */
    __opacityOf: (nodeId: string) => getActiveEditorStore().graph.getNode(nodeId)?.opacity
  })
}
