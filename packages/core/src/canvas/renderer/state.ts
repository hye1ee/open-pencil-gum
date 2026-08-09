import type { SkiaRenderer } from '#core/canvas/renderer'

export function invalidateScenePicture(r: SkiaRenderer): void {
  r.scenePicture?.delete()
  r.scenePicture = null
  r.scenePictureVersion = -1
  r.sceneBacking?.image.delete()
  r.sceneBacking = null
  r.sceneBackingBuild?.surface.delete()
  r.sceneBackingBuild = null
}

export function clearSubtreePictureCache(r: SkiaRenderer): void {
  for (const entry of r.subtreePictureCache.values()) entry.picture.delete()
  r.subtreePictureCache.clear()
  r.subtreePictureCachePageId = null
  r.subtreePictureCacheSceneVersion = -1
  r.subtreePictureCachePositionPreviewVersion = -1
}

export function invalidateAllPictures(r: SkiaRenderer): void {
  invalidateScenePicture(r)
  for (const pic of r.nodePictureCache.values()) pic?.delete()
  r.nodePictureCache.clear()
  clearSubtreePictureCache(r)
}

export function invalidateNodePicture(r: SkiaRenderer, nodeId: string): void {
  const pic = r.nodePictureCache.get(nodeId)
  if (pic) {
    pic.delete()
    r.nodePictureCache.delete(nodeId)
  }
  const subtree = r.subtreePictureCache.get(nodeId)
  if (subtree) {
    subtree.picture.delete()
    r.subtreePictureCache.delete(nodeId)
  }
}

export function flashNode(r: SkiaRenderer, nodeId: string): void {
  r._flashes.push({ nodeId, startTime: performance.now() })
}

export function aiMarkActive(r: SkiaRenderer, nodeIds: string[]): void {
  for (const id of nodeIds) r._aiActiveNodes.add(id)
}

export function aiMarkDone(r: SkiaRenderer, nodeIds: string[]): void {
  const now = performance.now()
  for (const id of nodeIds) {
    if (r._aiActiveNodes.delete(id)) {
      r._aiDoneFlashes.push({ nodeId: id, startTime: now })
    }
  }
}

export function aiFlashDone(r: SkiaRenderer, nodeIds: string[]): void {
  const now = performance.now()
  for (const id of nodeIds) {
    r._aiDoneFlashes.push({ nodeId: id, startTime: now })
  }
}

export function aiClearActive(r: SkiaRenderer): void {
  r._aiActiveNodes.clear()
}

export function aiClearAll(r: SkiaRenderer): void {
  r._aiActiveNodes.clear()
  r._aiDoneFlashes = []
  r._aiMismatch.clear()
}

/** Replaces the whole set, so a node the meta-agent has taken back simply is
 * not in `entries` — there is no separate unflag path to keep in step. */
export function aiSetMismatch(r: SkiaRenderer, entries: Array<[string, number]>): void {
  r._aiMismatch = new Map(entries)
}

export function aiClearMismatch(r: SkiaRenderer): void {
  r._aiMismatch.clear()
}

/** Drives the rAF pump in the app's flash actions. The mismatch glow pulses,
 * so it has to keep the loop alive for as long as a marker is on screen. */
export function hasActiveFlashes(r: SkiaRenderer): boolean {
  return (
    r._flashes.length > 0 ||
    r._aiActiveNodes.size > 0 ||
    r._aiDoneFlashes.length > 0 ||
    r._aiMismatch.size > 0
  )
}
