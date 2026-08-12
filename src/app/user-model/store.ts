import { reactive, shallowRef } from 'vue'

import type { PipelineStage, Proposition } from '@/app/user-model/pipeline'

/** The in-memory mirror of `captures/user-model.json` plus the status the panel
 * shows. The propositions themselves live on disk and survive reloads. */

export type UserModelStatus =
  /** Capture hasn't been armed yet — nobody has clicked. */
  | 'idle'
  /** Watching and inferring. */
  | 'observing'
  /** Watching, but with no provider configured there is nothing to infer with. */
  | 'unconfigured'
  | 'stopped'

export const userModel = reactive({
  status: 'idle' as UserModelStatus,
  sessionId: '',
  /** Frames handed to the model since the session started. */
  frames: 0,
  /** Batches dropped because the screen had not moved. */
  idleBatches: 0,
  stage: 'idle' as PipelineStage,
  lastError: '',
  /** Reactive, so the panel's reset button appears once there is one to reset. */
  canReset: false
})

/** Most recently revised first — that is where the activity is. */
export const propositions = shallowRef<Proposition[]>([])

/** Set once capture starts, so the panel's reset button has something to call. */
let resetHandler: (() => void) | null = null

export function beginSession(sessionId: string, options: { infers: boolean }): void {
  userModel.status = options.infers ? 'observing' : 'unconfigured'
  userModel.sessionId = sessionId
  userModel.frames = 0
  userModel.idleBatches = 0
  userModel.stage = 'idle'
  userModel.lastError = ''
}

export function endSession(): void {
  if (userModel.status === 'idle') return
  userModel.status = 'stopped'
  userModel.stage = 'idle'
}

export function noteFrame(): void {
  userModel.frames++
}

export function noteIdleBatch(): void {
  userModel.idleBatches++
}

export function noteStage(stage: PipelineStage): void {
  userModel.stage = stage
}

export function setPropositions(items: Proposition[]): void {
  userModel.lastError = ''
  propositions.value = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function noteError(error: unknown): void {
  userModel.lastError = error instanceof Error ? error.message : String(error)
}

export function onReset(handler: () => void): void {
  resetHandler = handler
  userModel.canReset = true
}

export function resetUserModel(): void {
  resetHandler?.()
}
