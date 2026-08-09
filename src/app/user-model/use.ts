import {
  logPropositionChange,
  logRationaleChange,
  logUserModelStage
} from '@/app/ai/chat/agent-log'
import { agentTurn } from '@/app/ai/chat/agent-turn'
import { userEditsSince } from '@/app/ai/chat/user-edits'
import { getToolLogEntries } from '@/app/ai/tools'
import { canBuildUserModel, modelCalls } from '@/app/user-model/calls'
import { createUserModel, type FeedbackNote, type UserModel } from '@/app/user-model/pipeline'
import { appendAudit, clearSaved, load, save } from '@/app/user-model/storage'
import { noteError, noteIdleBatch, noteStage, setPropositions } from '@/app/user-model/store'

/**
 * The app-specific half of the user model: what this app knows about the moment
 * a frame was taken, and where the propositions are kept. `pipeline.ts` knows
 * none of this; `calls.ts` holds the model configuration.
 */

export { canBuildUserModel }

/** A frame's worth of tool history; the capture cadence is five seconds. */
const NOTE_WINDOW_MS = 6000

/**
 * What this moment looks like from inside the app, for the frames to be read
 * against — the thing screenshots can never show, which is who was acting.
 *
 * Both can be true at once: the agent builds over many steps and the user is
 * free to edit the canvas the whole time, which is what `intervention.ts`
 * exists to untangle. So the note reports both sides rather than declaring the
 * canvas to be one party's work.
 */
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

/**
 * The live model, whoever made it.
 *
 * Two instances would both hold propositions and both write the same file, so
 * the second one's saves would silently undo the first's. Feedback has to reach
 * the model whether or not capture is running, so it reuses whatever exists and
 * builds one only if nothing does.
 */
let current: UserModel | null = null

/**
 * Revise from the notes shown beside the canvas rather than from the screen.
 *
 * Deliberately not gated on capture. This is the only place this person tells
 * us about themselves in words, and losing it because they declined a
 * screen-share prompt would throw away the best evidence the model can get.
 */
export async function observeMarkNotes(notes: FeedbackNote[]): Promise<void> {
  if (notes.length === 0 || !canBuildUserModel()) return
  current ??= createPropositionSink('answers')
  const replied = notes.filter((note) => note.reply !== null).length
  logUserModelStage('observing', `${replied} answered, ${notes.length - replied} left alone`)
  pending = current.observe(notes).finally(() => {
    pending = null
    logUserModelStage('observed', 'user model up to date')
  })
  await pending
}

let pending: Promise<void> | null = null

/**
 * Wait for an in-flight revision to land.
 *
 * The meta-agent reads the model once per turn and holds it. When a turn is
 * restarted because someone answered a marker, the revision they caused is
 * still two model calls from being written — so without this the restarted turn
 * would be judged against the very beliefs they just corrected, which is the
 * one outcome the whole feature exists to prevent.
 */
export function awaitUserModelSettled(): Promise<void> {
  return pending ?? Promise.resolve()
}

export function createPropositionSink(sessionId: string): UserModel {
  const model = createUserModel({
    deps: modelCalls(),

    onStage: (stage) => {
      noteStage(stage)
      // Only this one reaches the log. The others fire every thirty seconds
      // from the capture loop; this one fires when a person said something, and
      // it is the only way to tell a rationale call that returned nothing from
      // a rationale call that never happened.
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
    // Read back rather than reusing `saved`: `load` fills in the drift fields
    // an older file is missing, and the panel should show the filled-in set.
    setPropositions(model.propositions)
  })

  current = model
  return model
}

export { clearSaved }
