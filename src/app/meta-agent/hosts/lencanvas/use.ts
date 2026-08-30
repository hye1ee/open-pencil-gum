import { logMetaAgentLifecycle } from '@/app/ai/chat/agent-log'
import type { EditorStore } from '@/app/editor/active-store'
import type { Proposition } from '@/app/meta-agent/core/types'
import { propositionsForRun } from '@/app/meta-agent/hosts/lencanvas/context'
import { currentPlan, noteAgentPlan } from '@/app/meta-agent/hosts/lencanvas/events'
import {
  resetFeedbackNoteHistory,
  resetFeedbackNotes
} from '@/app/meta-agent/hosts/lencanvas/feedback-note/use'
import {
  installReasoningObserver,
  resetFeedbackNoteStreams
} from '@/app/meta-agent/hosts/lencanvas/reasoning-observer'
import { load as loadSavedUserModel } from '@/app/user-model/storage'
import { propositions as currentUserModelPropositions } from '@/app/user-model/store'
import { awaitUserModelSettled } from '@/app/user-model/use'
import { getStudyRuntime, isHandsOffDelegationCondition } from '@/app/study/runtime'

let request = ''
let runPropositions: Proposition[] = []
let runStore: EditorStore | null = null
let enabled = true

/** Start one task-agent turn with a stable snapshot of the current user model. */
export async function startMetaAgentTurn(
  store: EditorStore,
  userText: string,
  metaAgentEnabled = true
): Promise<void> {
  runStore = store
  enabled = metaAgentEnabled
  if (userText !== request) resetFeedbackNoteHistory()
  request = userText
  noteAgentPlan(null)

  resetFeedbackNotes()
  resetFeedbackNoteStreams()
  if (!enabled) {
    runPropositions = []
    logMetaAgentLifecycle('disabled for the active study condition')
    return
  }

  // A feedback retry may start while its user-model update is still running.
  // Wait so the retried reasoning is compared against the corrected model.
  await awaitUserModelSettled()

  const inMemory = currentUserModelPropositions.value
  const userModel = inMemory.length > 0 ? inMemory : await loadSavedUserModel()
  runPropositions = propositionsForRun(userModel)
  const withheld = runPropositions.filter((proposition) => !proposition.shownToAgent).length
  logMetaAgentLifecycle(`loaded ${runPropositions.length} propositions, ${withheld} withheld`)
}

// Registered here because the reasoning tap must not import model setup.
installReasoningObserver({
  isEnabled: () => enabled,
  isUserInitiated: () => getStudyRuntime().condition === 'user-initiated',
  isHandsOffDelegation: () => isHandsOffDelegationCondition(getStudyRuntime().condition),
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
