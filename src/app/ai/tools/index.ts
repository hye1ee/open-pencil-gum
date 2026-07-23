import { valibotSchema } from '@ai-sdk/valibot'
import { tool } from 'ai'
import * as v from 'valibot'

import { computeAllLayouts } from '@open-pencil/core/layout'
import type { FigmaAPI } from '@open-pencil/core/figma-api'
import { CORE_TOOLS, toolsToAI } from '@open-pencil/core/tools'
import type { StepBudget, ToolDef, ToolLogEntry } from '@open-pencil/core/tools'
import type { SceneNode } from '@open-pencil/scene-graph'

import { setAgentCursorTarget } from '@/app/ai/chat/agent-cursor'
import { logBlocked, logToolCall, logToolError, logToolResult } from '@/app/ai/chat/agent-log'
import { beginAgentMutation, endAgentMutation, guardMutation } from '@/app/ai/chat/intervention'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { getActiveEditorStore } from '@/app/editor/active-store'
import type { EditorStore } from '@/app/editor/active-store'
import { ensureGraphFonts } from '@/app/editor/fonts'

export const MAX_AGENT_STEPS = 50

export interface StepUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  timestamp: number
}

class RunState {
  toolLog: ToolLogEntry[] = []
  stepUsages: StepUsage[] = []
  currentSteps = 0

  recordStep(usage: StepUsage): void {
    this.stepUsages.push(usage)
    this.currentSteps++
  }

  /** Tokens from a call that isn't a step — the planning calls, which cost money
   * but execute no tools and must not eat into the step budget. */
  recordAux(usage: StepUsage): void {
    this.stepUsages.push(usage)
  }

  resetSteps(): void {
    this.currentSteps = 0
  }

  hitLimit(): boolean {
    return this.currentSteps >= MAX_AGENT_STEPS
  }

  clear(): void {
    this.toolLog = []
    this.stepUsages = []
    this.currentSteps = 0
  }
}

const runStates = new WeakMap<EditorStore, RunState>()

function getRunState(store?: EditorStore): RunState {
  const target = store ?? getActiveEditorStore()
  const existing = runStates.get(target)
  if (existing) return existing
  const created = new RunState()
  runStates.set(target, created)
  return created
}

export function getToolLogEntries(store?: EditorStore): ToolLogEntry[] {
  return getRunState(store).toolLog
}

export function getStepUsages(store?: EditorStore): StepUsage[] {
  return getRunState(store).stepUsages
}

export function recordStepUsage(usage: StepUsage, store?: EditorStore): void {
  getRunState(store).recordStep(usage)
}

export function recordAuxUsage(usage: StepUsage, store?: EditorStore): void {
  getRunState(store).recordAux(usage)
}

export function resetRunSteps(store?: EditorStore): void {
  getRunState(store).resetSteps()
}

export function didHitStepLimit(store?: EditorStore): boolean {
  return getRunState(store).hitLimit()
}

export function clearToolLogEntries(store?: EditorStore): void {
  getRunState(store).clear()
}

/** A call the intervention guard refused — `{ skipped: true, reason }` rather
 * than a real tool result. */
function isSkipped(result: unknown): result is { skipped: true; reason?: unknown } {
  return typeof result === 'object' && result !== null && 'skipped' in result
}

export function createAITools(store: EditorStore) {
  let beforeSnapshot: Map<string, SceneNode> | null = null
  const runState = getRunState(store)

  // Drop viewport_zoom_to_fit — a cosmetic view tool the agent wastes a step on;
  // app-scoped so core/MCP/CLI keep it. Then wrap each mutating tool so the hard
  // guard can skip/trim calls that would overwrite or delete user-edited nodes.
  const guardedTools: ToolDef[] = CORE_TOOLS.filter(
    (def) => def.name !== 'viewport_zoom_to_fit'
  ).map((def) =>
    def.mutates
      ? {
          ...def,
          execute: (figma: FigmaAPI, args: Record<string, unknown>) => {
            const guard = guardMutation(store, def.name, args)
            if (guard.blocked) return { skipped: true, reason: guard.reason }
            return def.execute(figma, guard.modifiedArgs ?? args)
          }
        }
      : def
  )

  return toolsToAI(
    guardedTools,
    {
      getFigma: () => makeFigmaFromStore(store),
      onBeforeExecute: (def) => {
        if (def.mutates) {
          beforeSnapshot = store.snapshotPage()
          beginAgentMutation(store)
        }
      },
      onAfterExecute: async (def) => {
        if (!def.mutates) return
        try {
          const pageId = store.state.currentPageId
          const pageNode = store.graph.getNode(pageId)
          if (pageNode) await ensureGraphFonts(store.graph, pageNode.childIds)
          computeAllLayouts(store.graph, pageId)
          store.requestRender()
          if (beforeSnapshot) {
            const before = beforeSnapshot
            const after = store.snapshotPage()
            store.pushUndoEntry({
              label: `AI: ${def.name}`,
              forward: () => store.restorePageFromSnapshot(after),
              inverse: () => store.restorePageFromSnapshot(before)
            })
            beforeSnapshot = null
          }
        } finally {
          // Always release the flag so user edits are attributed correctly,
          // even if font/layout work above throws.
          endAgentMutation(store)
        }
      },
      onFlashNodes: (nodeIds) => {
        store.renderer?.aiClearActive()
        if (nodeIds.length > 0) {
          store.aiFlashDone(nodeIds)
          setAgentCursorTarget(store, nodeIds[0])
        }
      },
      onToolLog: (entry) => {
        runState.toolLog.push(entry)
        logToolCall(entry.tool, entry.args)
        if (entry.error) logToolError(entry.tool, entry.error, entry.durationMs)
        else if (isSkipped(entry.result)) logBlocked(entry.tool, String(entry.result.reason ?? ''))
        else logToolResult(entry.tool, entry.result, entry.durationMs)
      },
      getStepBudget: (): StepBudget => ({
        current: runState.currentSteps,
        max: MAX_AGENT_STEPS
      })
    },
    { v, valibotSchema, tool }
  )
}

export type AITools = ReturnType<typeof createAITools>
