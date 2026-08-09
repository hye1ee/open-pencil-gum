import type { SceneGraph } from '@open-pencil/scene-graph'

import { getInterventionState } from '@/app/ai/chat/intervention'
import type { InterventionState } from '@/app/ai/chat/intervention'
import type { EditorStore } from '@/app/editor/active-store'

/**
 * The hard guard: the half of intervention handling that runs *after* a user
 * edit has been detected. Split out of intervention.ts, which owns detection —
 * the two only meet at InterventionState.
 */

export interface GuardResult {
  /** True → the tool call must be skipped entirely. */
  blocked: boolean
  reason?: string
  /** If set, run the tool with these args instead (e.g. trimmed batch ops). */
  modifiedArgs?: Record<string, unknown>
}

// Property categories each mutating tool writes. A tool is blocked only if it
// writes a category the user changed on that node. Tools absent here (e.g.
// node_resize → geometry, reparent_node) never overwrite a protected category.
const TOOL_CATEGORIES: Record<string, ReadonlySet<string>> = {
  set_fill: new Set(['fill']),
  set_image_fill: new Set(['fill']),
  stock_photo: new Set(['fill']),
  set_stroke: new Set(['stroke']),
  set_text: new Set(['text']),
  set_text_properties: new Set(['text-style']),
  set_radius: new Set(['radius']),
  set_layout: new Set(['layout']),
  set_layout_child: new Set(['layout']),
  set_opacity: new Set(['opacity']),
  set_blend_mode: new Set(['blend']),
  set_drop_shadow: new Set(['effects']),
  set_inner_shadow: new Set(['effects'])
}
// Generic tools that can overwrite anything → blocked if the node has ANY
// protected category.
const BROAD_TOOLS = new Set(['update_node'])
/**
 * Writes that decide where a node sits, how big it is, and what it is called —
 * as opposed to how it looks. On a node the user made themselves these are off
 * limits: a measured run had the agent drag the user's copy from the y=-422 it
 * had been parked at into the middle of the layout, then spend four steps
 * untangling the overlap it had just created. Styling such a node is still
 * allowed; only its placement and identity are the user's alone.
 */
const OWNERSHIP_KEYS = new Set([
  'x',
  'y',
  'width',
  'height',
  'name',
  'visible',
  'sizing_horizontal',
  'sizing_vertical',
  'grow'
])
// Flagged "mutating" but only frame/navigate — never guarded.
const GUARD_EXEMPT_TOOLS = new Set(['viewport_zoom_to_fit'])

/** Category a batch_update op prop key writes, or null. */
function batchPropCategory(key: string): string | null {
  if (key === 'corner_radius') return 'radius'
  if (key === 'fill' || key === 'fills') return 'fill'
  if (key === 'opacity') return 'opacity'
  if (
    key === 'spacing' ||
    key === 'align' ||
    key === 'counter_align' ||
    key.startsWith('padding') ||
    key.startsWith('sizing') ||
    key === 'grow'
  ) {
    return 'layout'
  }
  return null
}

/** First node in the subtree (incl. root) that is protected or user-created. */
function subtreeProtectedHit(
  graph: SceneGraph,
  rootId: string,
  state: InterventionState
): string | null {
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined) break
    if (state.protectedProps.has(id) || state.userCreated.has(id)) return id
    const node = graph.getNode(id)
    if (node) stack.push(...node.childIds)
  }
  return null
}

/** Drop batch_update ops that would overwrite a protected category. */
function guardBatch(args: Record<string, unknown>, state: InterventionState): GuardResult {
  let ops: unknown
  try {
    ops = JSON.parse(String(args.operations))
  } catch {
    return { blocked: false }
  }
  if (!Array.isArray(ops)) return { blocked: false }
  const kept = ops.filter((op) => {
    const id = (op as { id?: unknown }).id
    if (typeof id !== 'string') return true
    const props = (op as { props?: unknown }).props
    if (!props || typeof props !== 'object') return true
    const keys = Object.keys(props)
    // The user's own node: never rename, hide or resize it.
    if (state.userCreated.has(id) && keys.some((key) => OWNERSHIP_KEYS.has(key))) return false
    const protectedCats = state.protectedProps.get(id)
    if (!protectedCats) return true
    for (const key of keys) {
      const cat = batchPropCategory(key)
      if (cat && protectedCats.has(cat)) return false
    }
    return true
  })
  if (kept.length === ops.length) return { blocked: false }
  if (kept.length === 0) {
    return { blocked: true, reason: 'all batch_update operations overwrite user-edited properties' }
  }
  return {
    blocked: false,
    modifiedArgs: { ...args, operations: JSON.stringify(kept) },
    reason: `dropped ${ops.length - kept.length} batch op(s) overwriting user-edited properties`
  }
}

/**
 * Decide whether a mutating tool call may proceed against the user's edits.
 * Property-level: only blocks a tool that would overwrite the exact category the
 * user changed (or delete/replace a user-created node) — never the whole node.
 */
export function guardMutation(
  store: EditorStore,
  toolName: string,
  args: Record<string, unknown>
): GuardResult {
  if (GUARD_EXEMPT_TOOLS.has(toolName)) return { blocked: false }
  const state = getInterventionState(store)
  if (state.protectedProps.size === 0 && state.userCreated.size === 0) return { blocked: false }
  const graph = store.graph

  // render: block only when replacing a subtree that holds a protected/user node.
  if (toolName === 'render') {
    const replaceId = args.replace_id
    if (typeof replaceId === 'string') {
      const hit = subtreeProtectedHit(graph, replaceId, state)
      if (hit) {
        const reason = `render would overwrite user-owned node ${hit} (replace_id=${replaceId})`
        return { blocked: true, reason }
      }
    }
    return { blocked: false }
  }

  if (toolName === 'batch_update') {
    return guardBatch(args, state)
  }

  const id = typeof args.id === 'string' ? args.id : undefined
  if (!id) return { blocked: false }
  return guardSingleTarget(toolName, id, args, state)
}

/**
 * Strip the placement/identity writes from a call aimed at a node the user made.
 * The rest of the call goes through, so restyling the user's copy still works —
 * only where it sits and what it is called are left alone. Blocks outright when
 * placement was the whole point of the call.
 */
function guardUserCreated(
  id: string,
  args: Record<string, unknown>,
  state: InterventionState
): GuardResult {
  if (!state.userCreated.has(id)) return { blocked: false }
  const owned = Object.keys(args).filter((key) => OWNERSHIP_KEYS.has(key))
  if (owned.length === 0) return { blocked: false }
  const reason = `${id} is the user's own node — its ${owned.join(', ')} was left unchanged`
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (!OWNERSHIP_KEYS.has(key)) kept[key] = value
  }
  // Nothing but the id survived: the call was only ever about placement.
  if (Object.keys(kept).length <= 1) return { blocked: true, reason }
  return { blocked: false, modifiedArgs: kept, reason }
}

/** Guard a single-target tool (delete_node or a property-writing setter). */
function guardSingleTarget(
  toolName: string,
  id: string,
  args: Record<string, unknown>,
  state: InterventionState
): GuardResult {
  // delete_node: block if the node is user-created or has any protected property.
  if (toolName === 'delete_node') {
    if (state.userCreated.has(id) || state.protectedProps.has(id)) {
      const reason = `delete_node target ${id} is user-created/edited; left unchanged`
      return { blocked: true, reason }
    }
    return { blocked: false }
  }

  // Property-writing tools: block only on a category the user actually changed.
  const protectedCats = state.protectedProps.get(id)
  if (protectedCats && protectedCats.size > 0) {
    if (BROAD_TOOLS.has(toolName)) {
      return { blocked: true, reason: `${toolName} would overwrite user-edited node ${id}` }
    }

    const cats = TOOL_CATEGORIES[toolName]
    if (cats) {
      for (const cat of cats) {
        if (protectedCats.has(cat)) {
          return { blocked: true, reason: `${toolName} would overwrite the user's ${cat} on ${id}` }
        }
      }
    }
  }

  return guardUserCreated(id, args, state)
}
