import type { Editor } from '@open-pencil/core/editor'

export function createFlashActions(editor: Editor) {
  let flashRafId = 0

  // `requestRepaint`, not a bare `renderVersion++`: the render loop only wakes on
  // an editor event (`render-loop.ts` subscribes to `repaint:requested`), so
  // bumping the counter leaves every frame of the animation unpainted until
  // something unrelated asks for one.
  function pumpFlashes() {
    if (!editor.renderer?.hasActiveFlashes) {
      flashRafId = 0
      return
    }
    editor.requestRepaint()
    flashRafId = requestAnimationFrame(pumpFlashes)
  }

  function flashNodes(nodeIds: string[]) {
    const renderer = editor.renderer
    if (!renderer) return
    for (const id of nodeIds) renderer.flashNode(id)
    if (!flashRafId) pumpFlashes()
  }

  function aiMarkActive(nodeIds: string[]) {
    if (!editor.renderer) return
    editor.renderer.aiMarkActive(nodeIds)
    if (!flashRafId) pumpFlashes()
  }

  function aiMarkDone(nodeIds: string[]) {
    if (!editor.renderer) return
    editor.renderer.aiMarkDone(nodeIds)
    if (!flashRafId) pumpFlashes()
  }

  function aiFlashDone(nodeIds: string[]) {
    if (!editor.renderer) return
    editor.renderer.aiFlashDone(nodeIds)
    if (!flashRafId) pumpFlashes()
  }

  function aiClearAll() {
    editor.renderer?.aiClearAll()
  }

  function aiSetMismatch(entries: Array<[string, number]>) {
    if (!editor.renderer) return
    editor.renderer.aiSetMismatch(entries)
    if (!flashRafId) pumpFlashes()
  }

  function aiClearMismatch() {
    if (!editor.renderer) return
    editor.renderer.aiClearMismatch()
    // The pump stops on its own once the set is empty, but it stops *before*
    // drawing the empty frame — without this the last glow stays painted.
    editor.requestRepaint()
  }

  return {
    flashNodes,
    aiMarkActive,
    aiMarkDone,
    aiFlashDone,
    aiClearAll,
    aiSetMismatch,
    aiClearMismatch
  }
}
