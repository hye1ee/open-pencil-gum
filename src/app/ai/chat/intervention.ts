import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'

/**
 * User-intervention tracking for the AI tool loop (canvas-edit channel).
 *
 * The agent builds over many steps; the user may manually edit the canvas at any
 * moment. Detection is by WHOLE-STATE comparison, not per-event subscription: we
 * keep a `baseline` snapshot of the page as the agent last left it, and diff the
 * current page against it. Any difference is a user edit — reorder, delete, a new
 * node, any property — nothing to enumerate, nothing to miss. The agent's own
 * mutations are folded into the baseline as they run (begin/endAgentMutation), so
 * they're never mistaken for the user's. This is the deterministic sibling of the
 * previous agent's before/after LLM diff, minus the extra model calls.
 */

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return 'none'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(1)
  if (typeof value === 'string')
    return value.length > 40 ? `"${value.slice(0, 40)}…"` : `"${value}"`
  const json = JSON.stringify(value)
  return json.length > 60 ? `${json.slice(0, 60)}…` : json
}

type RawColor = { r?: number; g?: number; b?: number }
type RawPaint = {
  type?: string
  color?: RawColor
  gradientStops?: Array<{ color?: RawColor }>
  opacity?: number
  visible?: boolean
}

function colorToHex(color: RawColor): string {
  const { r = 0, g = 0, b = 0 } = color
  const channel = (c: number) =>
    Math.max(0, Math.min(255, Math.round(c * 255)))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase()
}

/**
 * Render a single paint as a readable token so the model can understand what the
 * user actually chose.
 *
 * Anything that isn't a hex here is a dead end for the model — a measured run
 * produced `strokes=paint`, which says nothing about what changed, because the
 * old fallback returned the paint's type name. So we reach for a colour wherever
 * one exists: solids by their own colour, gradients by their end stops, and a
 * paint with no `type` (but a colour) by that colour rather than the literal
 * word "paint".
 */
function paintToString(paint: unknown): string {
  if (!paint || typeof paint !== 'object') return 'none'
  const p = paint as RawPaint
  if (p.visible === false) return 'hidden'

  if (p.color) {
    const hex = colorToHex(p.color)
    return p.opacity !== undefined && p.opacity < 1 ? `${hex}@${p.opacity.toFixed(2)}` : hex
  }
  const stops = p.gradientStops
  if (stops?.length) {
    const first = stops[0].color
    const last = stops.at(-1)?.color
    const ends = [first, last].filter((c): c is RawColor => !!c).map(colorToHex)
    return `gradient(${[...new Set(ends)].join('→')})`
  }
  if (p.type === 'IMAGE') return 'image'
  return p.type ?? 'paint'
}

function formatChangeValue(key: string, value: unknown): string {
  if ((key === 'fills' || key === 'strokes') && Array.isArray(value)) {
    return value.length > 0 ? value.map(paintToString).join(', ') : 'none'
  }
  return formatValue(value)
}

// ── Snapshot diff (whole-state comparison, not per-event) ────────────────────

type PageSnapshot = Map<string, SceneNode>

// Semantic node properties we diff, each mapped to a coarse category the guard
// understands. Every OTHER key (geometry x/y/w/h, rotation, derived geometry,
// styleRuns, visible/locked, constraints…) is deliberately absent: those are
// reflow / side-effects, not design decisions, so they never enter the diff or
// protection. This allowlist is what keeps the whole-state diff clean.
const KEY_CATEGORY: Record<string, string> = {
  fills: 'fill',
  strokes: 'stroke',
  strokeCap: 'stroke',
  strokeJoin: 'stroke',
  dashPattern: 'stroke',
  borderTopWeight: 'stroke',
  borderRightWeight: 'stroke',
  borderBottomWeight: 'stroke',
  borderLeftWeight: 'stroke',
  strokeMiterLimit: 'stroke',
  independentStrokeWeights: 'stroke',
  effects: 'effects',
  opacity: 'opacity',
  blendMode: 'blend',
  cornerRadius: 'radius',
  topLeftRadius: 'radius',
  topRightRadius: 'radius',
  bottomRightRadius: 'radius',
  bottomLeftRadius: 'radius',
  independentCorners: 'radius',
  cornerSmoothing: 'radius',
  // 'text' is the copy itself and the face it is set in — rewriting either
  // destroys what the user wrote. 'text-style' is everything about how that copy
  // is laid out. They are split because a user who centres a heading must not
  // thereby lock the agent out of centring its siblings: with both in one
  // category, `set_text_properties` was blocked from applying the user's *own*
  // alignment to the rest of the design.
  text: 'text',
  fontFamily: 'text',
  fontWeight: 'text',
  italic: 'text',
  fontSize: 'text-style',
  textAlignHorizontal: 'text-style',
  textAlignVertical: 'text-style',
  textCase: 'text-style',
  textDecoration: 'text-style',
  lineHeight: 'text-style',
  letterSpacing: 'text-style',
  maxLines: 'text-style',
  layoutMode: 'layout',
  layoutDirection: 'layout',
  layoutWrap: 'layout',
  primaryAxisAlign: 'layout',
  counterAxisAlign: 'layout',
  primaryAxisSizing: 'layout',
  counterAxisSizing: 'layout',
  itemSpacing: 'layout',
  counterAxisSpacing: 'layout',
  paddingTop: 'layout',
  paddingRight: 'layout',
  paddingBottom: 'layout',
  paddingLeft: 'layout',
  layoutPositioning: 'layout',
  layoutGrow: 'layout',
  layoutAlignSelf: 'layout'
}
const SEMANTIC_KEYS = Object.keys(KEY_CATEGORY)

function nodeLabel(node: SceneNode): string {
  return `${node.type} "${node.name ?? node.id}" (${node.id})`
}

/** Deep-ish equality: primitives by ===, objects/arrays by JSON (snapshot nodes
 * are structuredClone'd plain data, so this is safe). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return false
}

/** Semantic keys whose value differs between two snapshots of the same node. */
function changedSemanticKeys(before: SceneNode, after: SceneNode): string[] {
  return SEMANTIC_KEYS.filter(
    (key) => !sameValue(Reflect.get(before, key), Reflect.get(after, key))
  )
}

/** True if `after` is a reordering of `before` (same child set, different order). */
function isReorder(before: string[], after: string[]): boolean {
  if (before.length !== after.length || before.length === 0) return false
  if (before.join(' ') === after.join(' ')) return false // unchanged order
  const set = new Set(before)
  return after.every((id) => set.has(id))
}

/** Add the categories of `keys` to the node's protected set (guard input), and
 * stamp the step so the protection can expire once it has been reported. */
function protectCategories(state: InterventionState, id: string, keys: string[]): void {
  let cats = state.protectedProps.get(id)
  for (const key of keys) {
    const cat = KEY_CATEGORY[key]
    if (!cat) continue
    cats ??= new Set()
    cats.add(cat)
  }
  if (!cats) return
  state.protectedProps.set(id, cats)
  state.protectedAt.set(id, state.currentStep)
}

/**
 * Drop property protections the model has already been told about.
 *
 * A protection has to survive from the moment the edit is detected through the
 * end of the step whose injected `[User edit]` block reports it — that is the
 * window where the model doesn't yet know, and would overwrite blindly. After
 * that the prompt rule ("leave the user's changes alone") is what keeps them
 * safe; this is how previous_agent works too, clearing `userActionHistory` every
 * turn.
 *
 * Holding them for the whole run instead meant an edit at step 3 was still
 * silently blocking tools at step 30 — in the measured run a fill change was
 * still refusing a call 73 seconds later, and the agent read that as "the tool
 * doesn't work" and rebuilt the design from scratch.
 *
 * `userCreated` is deliberately not expired: deleting a node the user made or
 * copied is unrecoverable, so that guard stands for the whole run.
 */
function expireProtections(state: InterventionState): void {
  for (const [id, at] of state.protectedAt) {
    if (at >= state.currentStep - 1) continue
    state.protectedProps.delete(id)
    state.protectedAt.delete(id)
  }
}

/**
 * Diff the agent's baseline snapshot against the current page. Because the
 * baseline is refreshed right after every agent mutation, anything that differs
 * here is a USER edit. Produces readable text AND updates guard state
 * (protectedProps / userCreated). Returns null if nothing meaningful changed.
 */
function computeUserDiff(
  baseline: PageSnapshot,
  current: PageSnapshot,
  state: InterventionState
): string | null {
  const added: string[] = []
  const modified: string[] = []
  const reordered: string[] = []
  const removed: string[] = []

  for (const [id, node] of current) {
    const before = baseline.get(id)
    if (!before) {
      // New id. Brand-new → a real user create; already-seen → undo/redo restore.
      added.push(`- Added ${nodeLabel(node)}`)
      if (!state.everSeenIds.has(id)) state.userCreated.add(id)
      continue
    }
    if (before.parentId !== node.parentId && node.parentId) {
      modified.push(`- Moved ${nodeLabel(node)} into parent ${node.parentId}`)
    }
    if (isReorder(before.childIds, node.childIds)) {
      const order = node.childIds.map((c) => current.get(c)?.name ?? c).join(', ')
      reordered.push(`- Reordered children of ${nodeLabel(node)}: now [${order}]`)
    }
    const changed = changedSemanticKeys(before, node)
    if (changed.length > 0) {
      const detail = changed
        .map((k) => `${k}=${formatChangeValue(k, Reflect.get(node, k))}`)
        .join(', ')
      modified.push(`- Modified ${nodeLabel(node)}: ${detail}`)
      protectCategories(state, id, changed)
    }
  }

  for (const [id, node] of baseline) {
    if (current.has(id)) continue
    removed.push(`- Deleted ${nodeLabel(node)}`)
    state.protectedProps.delete(id)
    state.userCreated.delete(id)
  }

  const lines = [...added, ...modified, ...reordered, ...removed]
  return lines.length > 0 ? lines.join('\n') : null
}

/** Adopt `snapshot` (taken at scene version `version`) as the new baseline and
 * remember all its ids (so a later undo/redo restore of any of them isn't
 * mistaken for a fresh user create). */
function setBaseline(state: InterventionState, snapshot: PageSnapshot, version: number): void {
  state.baseline = snapshot
  state.baselineVersion = version
  for (const id of snapshot.keys()) state.everSeenIds.add(id)
}

/**
 * Report what the user changed — as fact, not as instruction.
 *
 * This block used to carry four lines of standing policy, re-sent with every
 * single edit. Two of them actively caused damage: "apply that same decision to
 * the remaining elements" fought the guard, which then blocked the agent from
 * matching the user's own value; and "if the user recolored something, that
 * color is now the design's accent" promoted a recoloured icon to the whole
 * design's accent — twice in one run, costing ten steps of re-painting that the
 * next intervention then undid.
 *
 * The policy now lives once in the system prompt (see "When the user edits while
 * you work"). Here we only say what changed, so the diff isn't buried under
 * boilerplate the model has already read.
 */
function buildInterventionText(diff: string): string {
  return (
    `[User edit] The user changed the canvas while you were working. ` +
    `These changes are theirs, not yours:\n${diff}\n\n` +
    `Leave them as they are and carry on with what is still missing. The ids and values ` +
    `above are exact — do not re-read them to confirm.`
  )
}

// ── Per-store shared state (baseline snapshot + guard state) ─────────────────

export interface InterventionState {
  /** The page as the agent last left it. Anything the current page differs from
   * this by is a user edit (agent mutations are folded in as they happen). */
  baseline: PageSnapshot
  /** store.state.sceneVersion at the moment `baseline` was taken. If it hasn't
   * moved, nothing changed at all — skip the snapshot+diff entirely. */
  baselineVersion: number
  /** User edits captured mid-step (before an agent tool overwrote them), drained
   * at the next step boundary. Keeps the "model was thinking" window from being
   * silently absorbed into the baseline. */
  pending: string[]
  /** node id → property CATEGORIES the user changed (fill, text, layout…); the
   * guard blocks a tool only if it overwrites one of these, not the whole node. */
  protectedProps: Map<string, Set<string>>
  /** node id → the step its protection was last refreshed in, so a protection
   * can expire once the model has been told about it. See `expireProtections`. */
  protectedAt: Map<string, number>
  /** Steps finished so far in this run — the clock `protectedAt` is measured on. */
  currentStep: number
  /** Nodes the user deliberately created; the guard blocks delete/replace so the
   * agent can't wipe the user's variation. */
  userCreated: Set<string>
  /** Every node id ever seen — tells a new user creation (brand-new id) from an
   * undo/redo restore (reuses an existing id). */
  everSeenIds: Set<string>
}

const states = new WeakMap<EditorStore, InterventionState>()

/** Per-store state. Exported for guard.ts, which reads what this file writes. */
export function getInterventionState(store: EditorStore): InterventionState {
  const existing = states.get(store)
  if (existing) return existing

  const state: InterventionState = {
    baseline: store.snapshotPage(),
    baselineVersion: store.state.sceneVersion,
    pending: [],
    protectedProps: new Map(),
    protectedAt: new Map(),
    currentStep: 0,
    userCreated: new Set(),
    everSeenIds: new Set()
  }
  for (const id of state.baseline.keys()) state.everSeenIds.add(id)
  states.set(store, state)
  return state
}

/**
 * Called before each agent mutating tool. Captures any user edits made while the
 * model was thinking (before the tool overwrites state) into `pending`, then
 * rebases so the tool's own change is attributed to the agent, not the user.
 */
export function beginAgentMutation(store: EditorStore): void {
  const state = getInterventionState(store)
  // Nothing has changed since the baseline → no user edit to capture.
  if (store.state.sceneVersion === state.baselineVersion) return
  const current = store.snapshotPage()
  const diff = computeUserDiff(state.baseline, current, state)
  if (diff) state.pending.push(diff)
  setBaseline(state, current, store.state.sceneVersion)
}

/** Called after each agent mutating tool. Folds the agent's change into the
 * baseline so it is never later reported as a user edit. */
export function endAgentMutation(store: EditorStore): void {
  const state = getInterventionState(store)
  setBaseline(state, store.snapshotPage(), store.state.sceneVersion)
}

// ── Tracker (wired into the ToolLoopAgent in transports.ts) ──────────────────

export interface InterventionTracker {
  /** Reset before a new run (new user message). */
  reset(): void
  /** Called after each step; advances the step counter (paces from the 2nd). */
  onStepFinish(): void
  /**
   * Called before each step. Paces the build, then drains any user edits
   * captured since the last step. Returns the intervention text to inject, or
   * null if there's nothing to report. The caller assembles the final message
   * (so the canvas image and this text share one user message).
   */
  prepareStep(): Promise<string | null>
}

export function createInterventionTracker(store: EditorStore): InterventionTracker {
  const state = getInterventionState(store)

  return {
    reset() {
      state.pending = []
      state.protectedProps.clear()
      state.protectedAt.clear()
      state.userCreated.clear()
      state.everSeenIds.clear()
      setBaseline(state, store.snapshotPage(), store.state.sceneVersion)
      state.currentStep = 0
    },
    onStepFinish() {
      state.currentStep++
    },
    async prepareStep() {
      // First step: nothing has been built yet, so there cannot be an edit diff.
      if (state.currentStep === 0) return null

      expireProtections(state)

      // Diff the current page against the agent's baseline (= user edits since
      // its last mutation / pause), then combine with anything captured while the
      // model was thinking. Rebase so these edits aren't re-reported next step.
      // Skip the snapshot when nothing changed at all (scene version unmoved).
      let boundaryDiff: string | null = null
      if (store.state.sceneVersion !== state.baselineVersion) {
        const current = store.snapshotPage()
        boundaryDiff = computeUserDiff(state.baseline, current, state)
        setBaseline(state, current, store.state.sceneVersion)
      }
      const parts = [...state.pending, boundaryDiff].filter((d): d is string => !!d)
      state.pending = []

      if (parts.length === 0) return null
      return buildInterventionText(parts.join('\n'))
    }
  }
}
