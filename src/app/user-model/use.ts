import {
  logPropositionChange,
  logRationaleChange,
  logUserModelFeedback,
  logUserModelStage
} from '@/app/ai/chat/agent-log'
import type { UserModelAskUserBatch } from '@/app/user-model/ask-user/types'
import {
  canBuildUserModel,
  canUpdateUserModelFromFeedback,
  modelCalls
} from '@/app/user-model/calls'
import { hydrateMissingPropositionEmbeddings } from '@/app/user-model/embeddings'
import { userModelFixtureEnabled } from '@/app/user-model/fixture'
import {
  createUserModel,
  type Proposition,
  type UserModel,
  type UserModelFeedbackBatch
} from '@/app/user-model/pipeline'
import { hydrateUserModelReplacement } from '@/app/user-model/replacement'
import { appendAudit, clearSaved, load, save } from '@/app/user-model/storage'
import { noteError, noteIdleBatch, noteStage, setPropositions } from '@/app/user-model/store'
import { logUserInitiatedRetrieval } from '@/app/user-model/user-initiated/log'
import type { UserModelReasoningFeedbackBatch } from '@/app/user-model/user-initiated/types'

/** App-specific wiring for where observations come from and propositions live. */

export { canBuildUserModel }

/** One instance only: two would both write the same file and the second's saves
 * would undo the first's. Built on demand, since feedback outlives capture. */
let current: UserModel | null = null
let currentReady: Promise<void> = Promise.resolve()
let auditSessionId = 'feedback-notes'

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
  if (batch.notes.length === 0 || !canUpdateUserModelFromFeedback()) return
  current ??= createPropositionSink('feedback-notes')
  const explicit = batch.notes.filter((note) => note.resolution === 'explicit-feedback').length
  const items = batch.notes.reduce((sum, note) => sum + note.feedbackItems.length, 0)
  logUserModelFeedback(
    batch.step ?? 0,
    'queued',
    `notes=${batch.notes.length} explicit=${explicit} implicit=${batch.notes.length - explicit} items=${items}`
  )
  try {
    await enqueueObservation(async () => {
      await currentReady
      await current?.observeFeedback(batch)
    })
  } catch (error) {
    logUserModelFeedback(
      batch.step ?? 0,
      'failed',
      error instanceof Error ? error.message : String(error)
    )
  }
}

export async function observeAskUserAnswers(batch: UserModelAskUserBatch): Promise<void> {
  if (batch.answers.length === 0 || !canUpdateUserModelFromFeedback()) return
  current ??= createPropositionSink('ask-user')
  logUserModelFeedback(
    0,
    'queued',
    `condition=ask-user request=${batch.requestId} questions=${batch.answers.length}`
  )
  try {
    await enqueueObservation(async () => {
      await currentReady
      await current?.observeAskUser(batch)
    })
  } catch (error) {
    logUserModelFeedback(0, 'failed', error instanceof Error ? error.message : String(error))
  }
}

export async function observeUserInitiatedFeedback(
  batch: UserModelReasoningFeedbackBatch
): Promise<void> {
  if (batch.items.length === 0 || !canUpdateUserModelFromFeedback()) return
  current ??= createPropositionSink('user-initiated')
  logUserModelFeedback(
    batch.step ?? 0,
    'queued',
    `condition=user-initiated request=${batch.requestId} feedback=${batch.items.length}`
  )
  try {
    await enqueueObservation(async () => {
      await currentReady
      await current?.observeUserInitiated(batch)
    })
  } catch (error) {
    logUserModelFeedback(
      batch.step ?? 0,
      'failed',
      error instanceof Error ? error.message : String(error)
    )
  }
}

/** Makes the shared app User Model available to hosts that do not start the
 * screen-capture lifecycle. LenCanvas capture and LenChat feedback must reuse
 * this one instance because they read and write the same proposition store. */
export async function initializeUserModel(): Promise<void> {
  current ??= createPropositionSink('feedback-notes')
  await currentReady
}

/** The meta-agent reads the model once per turn. A restart after an answer is
 * two model calls ahead of the revision that answer caused. */
export function awaitUserModelSettled(): Promise<void> {
  return pending ?? currentReady
}

export function createPropositionSink(sessionId: string): UserModel {
  auditSessionId = sessionId
  if (current) return current
  const deps = modelCalls()
  const model = createUserModel({
    deps,

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

    onFeedbackRetrieval: (trace) => {
      for (const note of trace.notes) {
        logUserModelStage(
          'retrieval',
          `${note.noteId} direct → ${note.directIds.join(', ') || '(none)'}`
        )
        logUserModelStage(
          'retrieval',
          `${note.noteId} embedding → ${
            note.embedding
              .map((candidate) => `${candidate.id}:${candidate.score.toFixed(3)}`)
              .join(', ') || '(none above threshold)'
          }`
        )
      }
      logUserModelStage(
        'retrieval',
        `shown-to-feedback-model → ${trace.shownIds.join(', ') || '(none)'}`
      )
    },

    onAskUserRetrieval: (trace) => {
      for (const question of trace.questions) {
        logUserModelStage(
          'retrieval',
          `ask-user ${question.questionId} embedding → ${
            question.embedding
              .map((candidate) => `${candidate.id}:${candidate.score.toFixed(3)}`)
              .join(', ') || '(none above threshold)'
          }`
        )
      }
      logUserModelStage(
        'retrieval',
        `shown-to-ask-user-model → ${trace.shownIds.join(', ') || '(none)'}`
      )
    },

    onUserInitiatedRetrieval: logUserInitiatedRetrieval,

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
      void appendAudit(auditSessionId, propositions)
    },

    onError: (error: unknown) => {
      console.warn('[user-model] pipeline failed:', error)
      noteError(error)
    }
  })

  currentReady = load().then(async (saved) => {
    if (saved.length === 0) return
    let hydrated = saved
    if (userModelFixtureEnabled) {
      try {
        hydrated = await hydrateMissingPropositionEmbeddings(saved, (texts) => deps.embed(texts))
      } catch (error) {
        noteError(error)
      }
    }
    model.load(hydrated)
    // Read back, not `saved`: `load` fills in drift fields an older file lacks.
    setPropositions(model.propositions)
  })

  current = model
  return model
}

export async function clearUserModel(): Promise<void> {
  await initializeUserModel()
  current?.clear()
  setPropositions([])
  await clearSaved()
}

export async function replaceUserModel(items: readonly Proposition[]): Promise<void> {
  await initializeUserModel()
  await (pending ?? Promise.resolve()).catch(() => undefined)
  const deps = modelCalls()
  const next = await hydrateUserModelReplacement(items, (texts) => deps.embed(texts), noteError)
  current?.load(next)
  const loaded = (current?.propositions ?? next).map((item) => structuredClone(item))
  setPropositions(loaded)
  await save(loaded)
}

export { clearSaved }
