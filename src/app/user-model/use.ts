import {
  logPropositionChange,
  logRationaleChange,
  logUserModelFeedback,
  logUserModelStage
} from '@/app/ai/chat/agent-log'
import { agentTurn } from '@/app/ai/chat/agent-turn'
import { userEditsSince } from '@/app/ai/chat/user-edits'
import { getToolLogEntries } from '@/app/ai/tools'
import { canBuildUserModel, modelCalls } from '@/app/user-model/calls'
import {
  createUserModel,
  type FeedbackNote,
  type UserModel,
  type UserModelFeedbackBatch
} from '@/app/user-model/pipeline'
import { appendAudit, clearSaved, load, save } from '@/app/user-model/storage'
import { noteError, noteIdleBatch, noteStage, setPropositions } from '@/app/user-model/store'

/** The app-specific half: what this app knows about the moment a frame was taken,
 * and where the propositions are kept. `pipeline.ts` knows none of it. */

export { canBuildUserModel }

/** A frame's worth of tool history; the capture cadence is five seconds. */
const NOTE_WINDOW_MS = 6000

/** Who was acting, which a screenshot cannot show. Both sides are reported: the
 * agent builds over many steps and the user can edit throughout. */
export function frameNote(): string | undefined {
  const since = Date.now() - NOTE_WINDOW_MS
  const edits = userEditsSince(since)
  if (!agentTurn.running && edits.length === 0) return undefined

  const parts: string[] = []
  if (agentTurn.running) {
    const tools = [
      ...new Set(
        getToolLogEntries()
          .filter((entry) => entry.mutates && entry.timestamp >= since)
          .map((entry) => entry.tool)
      )
    ]
    parts.push(
      tools.length === 0
        ? "An AI agent is carrying out the user's request."
        : `An AI agent is carrying out the user's request, changing the canvas with: ${tools.join(', ')}.`
    )
  }
  if (edits.length > 0) {
    parts.push(`Meanwhile the user edited the canvas by hand:\n${edits.join('\n')}`)
  }
  return parts.join('\n')
}

/** One instance only: two would both write the same file and the second's saves
 * would undo the first's. Built on demand, since feedback outlives capture. */
let current: UserModel | null = null

/** Not gated on capture: this is the only place the person tells us anything in
 * words, and it is the best evidence the model gets. */
export async function observeMarkNotes(notes: FeedbackNote[]): Promise<void> {
  if (notes.length === 0 || !canBuildUserModel()) return
  current ??= createPropositionSink('answers')
  const replied = notes.filter((note) => note.reply !== null).length
  logUserModelStage('observing', `${replied} answered, ${notes.length - replied} left alone`)
  await enqueueObservation(() => current?.observe(notes) ?? Promise.resolve())
}

let pending: Promise<void> | null = null

async function enqueueObservation(observe: () => Promise<void>): Promise<void> {
  const before = pending ?? Promise.resolve()
  const queued = before.catch(() => undefined).then(observe)
  pending = queued
  try {
    await queued
  } finally {
    if (pending === queued) {
      pending = null
      logUserModelStage('observed', 'user model up to date')
    }
  }
}

export async function observeFeedbackNotes(batch: UserModelFeedbackBatch): Promise<void> {
  if (batch.notes.length === 0 || !canBuildUserModel()) return
  current ??= createPropositionSink('feedback-notes')
  const explicit = batch.notes.filter((note) => note.resolution === 'explicit-feedback').length
  const items = batch.notes.reduce((sum, note) => sum + note.feedbackItems.length, 0)
  logUserModelFeedback(
    batch.step ?? 0,
    'queued',
    `notes=${batch.notes.length} explicit=${explicit} implicit=${batch.notes.length - explicit} items=${items}`
  )
  try {
    await enqueueObservation(() => current?.observeFeedback(batch) ?? Promise.resolve())
  } catch (error) {
    logUserModelFeedback(
      batch.step ?? 0,
      'failed',
      error instanceof Error ? error.message : String(error)
    )
  }
}

/** The meta-agent reads the model once per turn. A restart after an answer is
 * two model calls ahead of the revision that answer caused. */
export function awaitUserModelSettled(): Promise<void> {
  return pending ?? Promise.resolve()
}

export function createPropositionSink(sessionId: string): UserModel {
  const model = createUserModel({
    deps: modelCalls(),

    onStage: (stage) => {
      noteStage(stage)
      // Only this one is logged: the others fire on the capture timer, and this
      // is how an empty rationale call is told from one that never happened.
      if (stage === 'reasoning') logUserModelStage('rationale', 'working out why')
    },

    onCandidates: (candidates) => {
      for (const candidate of candidates) {
        // Stored 0-1 like every other confidence here, shown out of ten.
        const shown = (candidate.confidence * 9 + 1).toFixed(0)
        logUserModelStage('read', `(${shown}/10) ${candidate.text}`)
      }
    },

    onRevision: logPropositionChange,

    onRationale: logRationaleChange,

    onRationaleDropped: (reason) => logUserModelStage('rationale', `dropped — ${reason}`),

    onIdle: (pixelChange) => {
      console.debug(`[user-model] screen still (${pixelChange.toFixed(2)}), batch skipped`)
      noteIdleBatch()
    },

    onChange: (propositions) => {
      for (const proposition of propositions) {
        console.debug(`[user-model] ${proposition.text}`)
      }
      logUserModelStage('saved', `${propositions.length} propositions`)
      setPropositions(propositions)
      void save(propositions)
      void appendAudit(sessionId, propositions)
    },

    onError: (error: unknown) => {
      console.warn('[user-model] pipeline failed:', error)
      noteError(error)
    }
  })

  void load().then((saved) => {
    if (saved.length === 0) return
    model.load(saved)
    // Read back, not `saved`: `load` fills in drift fields an older file lacks.
    setPropositions(model.propositions)
  })

  current = model
  return model
}

export { clearSaved }
