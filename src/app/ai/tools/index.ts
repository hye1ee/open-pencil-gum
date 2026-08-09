import { valibotSchema } from '@ai-sdk/valibot'
import { tool } from 'ai'
import * as v from 'valibot'
import { shallowRef } from 'vue'

import type { FigmaAPI } from '@open-pencil/core/figma-api'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { CORE_TOOLS, toolsToAI } from '@open-pencil/core/tools'
import type { StepBudget, ToolDef, ToolLogEntry } from '@open-pencil/core/tools'
import type { SceneNode } from '@open-pencil/scene-graph'

import { previewAgentChange } from '@/app/ai/chat/action-preview'
import { setAgentCursorTarget } from '@/app/ai/chat/agent-cursor'
import { logBlocked, logToolCall, logToolError, logToolResult } from '@/app/ai/chat/agent-log'
import { guardMutation } from '@/app/ai/chat/guard'
import { beginAgentMutation, endAgentMutation } from '@/app/ai/chat/intervention'
import { targetNodeIds } from '@/app/ai/chat/tool-targets'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { getActiveEditorStore } from '@/app/editor/active-store'
import type { EditorStore } from '@/app/editor/active-store'
import { ensureGraphFonts } from '@/app/editor/fonts'
import { notifyMetaAgentNodeReplaced } from '@/app/meta-agent/events'

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

  /**
   * A ref, not a plain number, because the chat's step bar reads it.
   *
   * The bar used to invalidate off the message list instead, which does not
   * work: `@ai-sdk/vue` updates a streaming message in place, so the array's
   * identity only changes when a message is added. A whole build streams into
   * one assistant message, and the bar sat on whatever count it happened to see
   * when that message was pushed. Nothing else here needs to be reactive.
   */
  readonly steps = shallowRef(0)

  get currentSteps(): number {
    return this.steps.value
  }

  recordStep(usage: StepUsage): void {
    this.stepUsages.push(usage)
    this.steps.value++
  }

  /** Tokens from a call that isn't a step — the planning calls, which cost money
   * but execute no tools and must not eat into the step budget. */
  recordAux(usage: StepUsage): void {
    this.stepUsages.push(usage)
  }

  resetSteps(): void {
    this.steps.value = 0
  }

  hitLimit(): boolean {
    return this.steps.value >= MAX_AGENT_STEPS
  }

  clear(): void {
    this.toolLog = []
    this.stepUsages = []
    this.steps.value = 0
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

/**
 * Set when the next turn is really the same piece of work carrying on.
 *
 * Answering a marker stops the turn and starts a new one from the same request,
 * because there is no way to rewind a single step inside a run. That is an
 * implementation detail: to the person it is one build that paused, so the step
 * budget has to carry over. Otherwise every answer buys another fifty steps and
 * the ceiling means nothing.
 */
const continuing = new WeakSet<EditorStore>()

export function continueRunSteps(store?: EditorStore): void {
  continuing.add(store ?? getActiveEditorStore())
}

/** Peeks without consuming, so the log can say so before the reset clears it. */
export function isContinuingRun(store?: EditorStore): boolean {
  return continuing.has(store ?? getActiveEditorStore())
}

export function resetRunSteps(store?: EditorStore): void {
  const target = store ?? getActiveEditorStore()
  if (continuing.delete(target)) return
  getRunState(target).resetSteps()
}

export function didHitStepLimit(store?: EditorStore): boolean {
  return getRunState(store).hitLimit()
}

/** How many steps this run has spent. The step the person interrupted. */
export function currentRunSteps(store?: EditorStore): number {
  return getRunState(store).currentSteps
}

export function clearToolLogEntries(store?: EditorStore): void {
  getRunState(store).clear()
}

/** A call the intervention guard refused — `{ skipped: true, reason }` rather
 * than a real tool result. */
function isSkipped(result: unknown): result is { skipped: true; reason?: unknown } {
  return typeof result === 'object' && result !== null && 'skipped' in result
}

function resultNodeId(result: unknown): string | null {
  if (typeof result !== 'object' || result === null || !('id' in result)) return null
  return typeof result.id === 'string' ? result.id : null
}

export function createAITools(store: EditorStore) {
  let beforeSnapshot: Map<string, SceneNode> | null = null
  /** Nodes this tool call is about, for the preview to fade. Read off the
   * arguments up front and replaced by the result ids when there are any —
   * a create has no id to name until it exists. */
  let touched: string[] = []
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
          execute: async (figma: FigmaAPI, args: Record<string, unknown>) => {
            const guard = guardMutation(store, def.name, args)
            if (guard.blocked) return { skipped: true, reason: guard.reason }
            const effective = guard.modifiedArgs ?? args
            // After the guard, so a trimmed batch never previews a node it was
            // refused.
            touched = targetNodeIds(def.name, effective)
            const result = await def.execute(figma, effective)
            const replacedId = def.name === 'render' ? effective.replace_id : undefined
            const createdId = resultNodeId(result)
            if (typeof replacedId === 'string' && createdId) {
              notifyMetaAgentNodeReplaced(replacedId, createdId)
            }
            return result
          }
        }
      : def
  )

  const coreTools = toolsToAI(
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
        const previewIds = touched
        touched = []
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
        // Outside the bracket on purpose: the preview holds for seconds, and an
        // edit the user makes during it is theirs, not the agent's.
        await previewAgentChange(store, previewIds)
      },
      onFlashNodes: (nodeIds) => {
        store.renderer?.aiClearActive()
        if (nodeIds.length > 0) {
          // The result names what was actually created or changed; prefer it
          // over the guess made from the arguments.
          touched = nodeIds
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
      }),
      // The tool log spans the whole chat, which is the same window the model's
      // transcript spans — so a match really does mean it already has the result.
      isRepeatCall: (toolName, args) => {
        const key = JSON.stringify(args)
        return runState.toolLog.some(
          (entry) => entry.tool === toolName && !entry.error && JSON.stringify(entry.args) === key
        )
      }
    },
    { v, valibotSchema, tool }
  )

  return coreTools
}

export type AITools = ReturnType<typeof createAITools>
