type NodeReplacedObserver = (oldId: string, newId: string) => void

let onNodeReplaced: NodeReplacedObserver | null = null

/**
 * Keeps the AI tool adapter independent from the meta-agent model setup while
 * still letting a render replacement preserve marks anchored to the old node.
 */
export function setMetaAgentNodeReplacedObserver(observer: NodeReplacedObserver): void {
  onNodeReplaced = observer
}

export function notifyMetaAgentNodeReplaced(oldId: string, newId: string): void {
  if (oldId === newId) return
  onNodeReplaced?.(oldId, newId)
}
