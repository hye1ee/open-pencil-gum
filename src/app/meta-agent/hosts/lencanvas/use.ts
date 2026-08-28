import { logMetaAgentLifecycle } from '@/app/ai/chat/agent-log'
import type { EditorStore } from '@/app/editor/active-store'
import { resetFeedbackNoteHistory, resetFeedbackNotes } from '@/app/meta-agent/hosts/lencanvas/feedback-note/use'
import { propositionsForRun } from '@/app/meta-agent/hosts/lencanvas/context'
import type { Proposition } from '@/app/meta-agent/core/types'
import { currentPlan, noteAgentPlan } from '@/app/meta-agent/hosts/lencanvas/events'
import {
  installReasoningObserver,
  resetFeedbackNoteStreams
} from '@/app/meta-agent/hosts/lencanvas/reasoning-observer'
import { load as loadSavedUserModel } from '@/app/user-model/storage'
import { propositions as currentUserModelPropositions } from '@/app/user-model/store'
import { awaitUserModelSettled } from '@/app/user-model/use'

let request = ''
let runPropositions: Proposition[] = []
let runStore: EditorStore | null = null

/** Start one task-agent turn with a stable snapshot of the current user model. */
export async function startMetaAgentTurn(store: EditorStore, userText: string): Promise<void> {
  runStore = store
  if (userText !== request) resetFeedbackNoteHistory()
  request = userText
  noteAgentPlan(null)

  // A feedback retry may start while its user-model update is still running.
  // Wait so the retried reasoning is compared against the corrected model.
  await awaitUserModelSettled()

  const inMemory = currentUserModelPropositions.value
  const userModel = inMemory.length > 0 ? inMemory : await loadSavedUserModel()
  runPropositions = propositionsForRun(userModel)
  const withheld = runPropositions.filter((proposition) => !proposition.shownToAgent).length
  logMetaAgentLifecycle(`loaded ${runPropositions.length} propositions, ${withheld} withheld`)

  resetFeedbackNotes()
  resetFeedbackNoteStreams()
}

// Registered here because the reasoning tap must not import model setup.
installReasoningObserver({
  getStore: () => runStore,
  getRequest: () => request,
  getPlan: currentPlan,
  getPropositions: () => runPropositions
})

/** Preserve the original request across an internal feedback retry. */
export function currentMetaRequest(): string {
  return request
}

/** Stable user-model snapshot shared by the Task Agent and Meta Agent this turn. */
export function runUserModel(): Proposition[] {
  return runPropositions
}
