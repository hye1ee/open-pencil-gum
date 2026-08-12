import { colorToHex } from '@open-pencil/core/color'
import type { SceneNode } from '@open-pencil/scene-graph'

import { targetNodeIds } from '@/app/ai/chat/tool-targets'
import { shownToAgent } from '@/app/ai/chat/user-model-propositions'
import { getToolLogEntries } from '@/app/ai/tools'
import type { EditorStore } from '@/app/editor/active-store'
import type { Proposition } from '@/app/meta-agent/judge'
import type { SavedProposition } from '@/app/user-model/pipeline'

/** Deep enough to see cards inside a row; past that it is implementation. */
const CANVAS_DEPTH = 3

/** A page listing longer than this is costing more than it tells. */
const MAX_CANVAS_NODES = 60

/** The visual character of a node — what a judgment about taste turns on. */
function visualOf(node: SceneNode): string {
  const parts: string[] = []
  const fill = node.fills.find((candidate) => candidate.type === 'SOLID' && candidate.visible)
  if (fill) parts.push(`${colorToHex(fill.color)} fill`)
  if (node.strokes.length > 0 && node.strokes[0].visible) parts.push('bordered')
  if (node.cornerRadius > 0) parts.push(`rounded ${node.cornerRadius}`)
  for (const effect of node.effects) {
    if (!effect.visible) continue
    if (effect.type === 'DROP_SHADOW') parts.push('drop shadow')
    else if (effect.type === 'INNER_SHADOW') parts.push('inner shadow')
  }
  if (node.layoutMode !== 'NONE') {
    const direction = node.layoutMode === 'HORIZONTAL' ? 'row' : 'column'
    parts.push(`${direction} ${node.itemSpacing}gap`)
  }
  return parts.join(', ')
}

/** A compact page listing with ids, sufficient to anchor a mark to a node. */
export function summariseCanvas(store: EditorStore): string {
  const lines: string[] = []

  function walk(nodeId: string, depth: number): void {
    if (lines.length >= MAX_CANVAS_NODES) return
    const node = store.graph.getNode(nodeId)
    if (!node) return
    const indent = '  '.repeat(depth)
    const size = `${Math.round(node.width)}×${Math.round(node.height)}`
    const visual = visualOf(node)
    const label = node.type === 'TEXT' ? ` "${node.text.slice(0, 40)}"` : ''
    lines.push(
      `${indent}${node.name} (${nodeId}) ${node.type}${label} ${size}${visual ? ` — ${visual}` : ''}`
    )
    if (depth >= CANVAS_DEPTH) return
    for (const child of node.childIds) walk(child, depth + 1)
  }

  for (const child of store.graph.getChildren(store.state.currentPageId)) walk(child.id, 0)
  if (lines.length === 0) return '(empty)'
  if (lines.length >= MAX_CANVAS_NODES) lines.push('… (listing truncated)')
  return lines.join('\n')
}

/** Mutating calls made this run, reduced to names and targets. */
export function actionsSoFar(store: EditorStore): string[] {
  return getToolLogEntries(store)
    .filter((entry) => entry.mutates && !entry.error)
    .map((entry) => {
      const targets = targetNodeIds(entry.tool, entry.args)
      return targets.length > 0 ? `${entry.tool} → ${targets.join(', ')}` : entry.tool
    })
    .slice(-12)
}

/** The nodes a change landed on, plus their ancestors. A mark names a container
 * and the tool call edits a child of it, so exact id matching retired nothing. */
export function withAncestors(store: EditorStore, nodeIds: readonly string[]): string[] {
  const all = new Set<string>()
  for (const nodeId of nodeIds) {
    let current: string | null = nodeId
    while (current !== null && !all.has(current)) {
      all.add(current)
      current = store.graph.getNode(current)?.parentId ?? null
    }
  }
  return [...all]
}

/** `shownToAgent` comes from the same function the building side filters with,
 * so the two can never disagree about what the agent was told. */
export function propositionsForRun(saved: readonly SavedProposition[]): Proposition[] {
  return saved.map((proposition) => ({
    id: proposition.id,
    text: proposition.text,
    confidence: proposition.confidence,
    rationale: proposition.rationale ?? null,
    shownToAgent: shownToAgent(proposition.confidence)
  }))
}
