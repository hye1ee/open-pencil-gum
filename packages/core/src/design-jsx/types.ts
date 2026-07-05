export interface RenderOptions {
  x?: number
  y?: number
  parentId?: string
  /** Commit the tree in batches of this many nodes for a progressive reveal. */
  chunkSize?: number
  /** Called after each batch (app injects repaint + frame wait). */
  onChunk?: () => Promise<void> | void
}
