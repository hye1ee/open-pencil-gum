import { evalCode } from './analyze'
import { calc } from './calc'
import {
  createEllipse,
  createFrame,
  createLine,
  createPolygon,
  createRectangle,
  createStar,
  createTextNode,
  render
} from './create'
import { describe } from './describe'
import {
  setFill,
  setLayout,
  setLayoutChild,
  setRadius,
  setStroke,
  setText,
  setTextProperties,
  updateNode
} from './modify'
import { findNodes, getJsx, getNode, getSelection } from './read'
import type { ToolDef } from './schema'
import { stockPhoto } from './stock-photo'
import { batchUpdate, deleteNode, nodeResize, reparentNode } from './structure'
import { viewportZoomToFit } from './vector'

/**
 * RENDER env flag (VITE_RENDER for the browser, RENDER for Node/Bun contexts like
 * the MCP server and CLI). Defaults to true (JSX `render` tool) unless explicitly
 * set to "false", which swaps in the per-element create_* tools instead.
 */
function isRenderOnly(): boolean {
  const metaEnv = (import.meta as { env?: Record<string, string | undefined> }).env
  const value =
    metaEnv?.VITE_RENDER ?? (typeof process !== 'undefined' ? process.env.RENDER : undefined)
  return value !== 'false'
}

const CREATE_TOOLS: ToolDef[] = isRenderOnly()
  ? [render]
  : [
      createRectangle,
      createFrame,
      createEllipse,
      createTextNode,
      createPolygon,
      createStar,
      createLine
    ]

/**
 * Core tools registered by default in AI chat (~30 tools, ~3K schema tokens).
 * Covers 90%+ of design sessions: render, describe, modify, structure, icons.
 */
export const CORE_TOOLS: ToolDef[] = [
  // Read
  getSelection,
  getNode,
  findNodes,
  getJsx,
  // Create
  ...CREATE_TOOLS,
  // Modify
  updateNode,
  setLayout,
  setLayoutChild,
  setRadius,
  setFill,
  setStroke,
  setText,
  setTextProperties,
  // Structure
  deleteNode,
  reparentNode,
  nodeResize,
  batchUpdate,
  // Stock photos
  stockPhoto,
  // Inspect & utility
  describe,
  calc,
  evalCode,
  viewportZoomToFit
]
