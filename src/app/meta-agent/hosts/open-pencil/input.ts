import { colorToHex } from '@open-pencil/core/color'
import type { SceneNode } from '@open-pencil/scene-graph'

import { targetNodeIds } from '@/app/ai/chat/tool-targets'
import { getToolLogEntries } from '@/app/ai/tools'
import type { EditorStore } from '@/app/editor/active-store'
import type { Proposition } from '@/app/meta-agent/core/types'
import type { DesignFeedbackNotePromptInput } from '@/app/meta-agent/domains/design/prompt'

/** Deep enough to see cards inside a row; past that it is implementation. */
const CANVAS_DEPTH = 3

/** A page listing longer than this is costing more than it tells. */
const MAX_CANVAS_NODES = 60

export interface OpenPencilMetaAgentContext {
  canvas: string
  actions: string[]
}

export interface OpenPencilFeedbackNoteSource {
  store: EditorStore
  request: string
  plan: string | null
  reasoning: string
  originStep: number
  originChunk: number
  propositions: Proposition[]
  generation: number
}

export interface OpenPencilFeedbackNoteInput extends DesignFeedbackNotePromptInput {
  originStep: number
  originChunk: number
  generation: number
}

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

/** A compact page listing with ids, sufficient to anchor a note to a node. */
function summariseCanvas(store: EditorStore): string {
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
function actionsSoFar(store: EditorStore): string[] {
  return getToolLogEntries(store)
    .filter((entry) => entry.mutates && !entry.error)
    .map((entry) => {
      const targets = targetNodeIds(entry.tool, entry.args)
      return targets.length > 0 ? `${entry.tool} → ${targets.join(', ')}` : entry.tool
    })
    .slice(-12)
}

export function readOpenPencilMetaAgentContext(store: EditorStore): OpenPencilMetaAgentContext {
  return {
    canvas: summariseCanvas(store),
    actions: actionsSoFar(store)
  }
}

export function buildOpenPencilFeedbackNoteInput(
  source: OpenPencilFeedbackNoteSource
): OpenPencilFeedbackNoteInput {
  const { store, ...input } = source
  return {
    ...input,
    ...readOpenPencilMetaAgentContext(store)
  }
}
