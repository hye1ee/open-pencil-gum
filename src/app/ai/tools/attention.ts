import { valibotSchema } from '@ai-sdk/valibot'
import { tool } from 'ai'
import * as v from 'valibot'

import { AI_ATTENTION_MAX_NODES } from '@open-pencil/core/constants'

import { isSameWorkingSet, setAttention } from '@/app/ai/chat/agent-attention'
import { logToolCall, logToolResult } from '@/app/ai/chat/agent-log'
import { sayAgent } from '@/app/ai/chat/agent-speech'
import type { EditorStore } from '@/app/editor/active-store'

/**
 * `set_attention` — the agent declares which nodes it is working on.
 *
 * App-scoped rather than a `CORE_TOOLS` entry: attention is editor UI state, and
 * `ToolDef.execute` only ever receives a `FigmaAPI`, which cannot reach it.
 * Keeping it here also means MCP and the CLI never see a tool that would glow a
 * canvas they don't have.
 *
 * Because it sidesteps the `toolsToAI` wrapper it also sidesteps the mutation
 * guard, the undo entry and the done-flash — none of which apply, since it
 * touches no nodes — but it does have to write its own log lines, or the run
 * trace in `agent-log.txt` would have a hole where every attention change was.
 */

const DESCRIPTION = `Declare which nodes you are building or editing right now. The user sees them highlighted on the canvas, so it is how they follow where you are.

Call it when your focus MOVES to a different part of the design — before you start working there, not after. Do not call it every step, and do not re-send a set that is already current.

This reads nothing and returns no node data. Use describe/get_node to inspect nodes.`

const WORKING_DESCRIPTION = `The nodes you are building or editing right now. Replaces the previous set entirely. Keep it to the few nodes actually in play (max ${AI_ATTENTION_MAX_NODES}).`

const NOTE_DESCRIPTION =
  'Very short phrase describing what you are doing with them, shown to the user (e.g. "tightening the hero spacing").'

export function createAttentionTool(store: EditorStore) {
  return tool({
    description: DESCRIPTION,
    inputSchema: valibotSchema(
      v.object({
        working: v.pipe(v.array(v.string()), v.description(WORKING_DESCRIPTION)),
        note: v.optional(v.pipe(v.string(), v.description(NOTE_DESCRIPTION)))
      })
    ),
    execute: async ({ working, note }: { working: string[]; note?: string }) => {
      const started = Date.now()
      logToolCall('set_attention', { working, note })

      const exists = (id: string) => !!store.graph.getNode(id)
      const known = working.filter(exists)
      const unknown = working.filter((id) => !exists(id))
      const noop = isSameWorkingSet(known)
      const kept = setAttention(store, known, note)

      const attending = kept.map((id) => {
        const node = store.graph.getNode(id)
        return { id, name: node?.name ?? id, type: node?.type ?? 'UNKNOWN' }
      })

      // The user may not have the chat open; the bubble is how a focus change
      // reaches them on the canvas itself.
      sayAgent(note ?? `Looking at ${attending.map((n) => n.name).join(', ')}`)

      const result = {
        working: attending,
        ...(unknown.length > 0 ? { unknown } : {}),
        ...(noop
          ? {
              warning:
                'Your working set was already exactly this — that call changed nothing and cost a step. Only call set_attention when your focus actually moves.'
            }
          : {}),
        ...(known.length > kept.length
          ? { dropped: `kept the first ${AI_ATTENTION_MAX_NODES} ids; the rest were ignored` }
          : {})
      }
      logToolResult('set_attention', result, Date.now() - started)
      return result
    }
  })
}
