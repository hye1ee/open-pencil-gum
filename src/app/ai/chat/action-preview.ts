import { logTurnHeld } from '@/app/ai/chat/agent-log'
import { isTurnPaused } from '@/app/ai/chat/agent-turn'
import { hasWarnings } from '@/app/ai/chat/mismatch'
import { getActiveEditorStore } from '@/app/editor/active-store'
import type { EditorStore } from '@/app/editor/active-store'

/**
 * Shows what a tool call did before letting it stand: the nodes it touched are
 * drawn faint for a moment, then settle to full strength.
 *
 * The agent edits faster than anyone can watch. Without a beat here a whole
 * step lands between two frames and the user only ever sees the result, which
 * leaves them nothing to react to — and reacting is the point once the
 * meta-agent starts flagging things.
 *
 * `updateNodePreview` rather than `updateNode`: it exists for drag previews, so
 * it changes the node, busts the picture cache, and stops there — no scene
 * version bump, no change event, nothing downstream mistakes for a real edit.
 * The opacity written here must never reach the undo entry or the saved file.
 *
 * Deliberately outside the agent-mutation bracket in `tools/index.ts`. The hold
 * is exactly when the user is most likely to grab something, and inside the
 * bracket their edit would be filed as the agent's.
 *
 * A deletion cannot be previewed this way — there is no node left to fade. Those
 * calls pass through untouched, which is a gap to close when the tool call can
 * be held before it runs rather than after.
 */

/**
 * The preview breathes between these instead of holding one value.
 *
 * A fixed 0.3 did not land: a white card at 0.3 over a light canvas still looks
 * like a card someone drew, so the preview passed for the finished thing and the
 * wait looked like a slow render. Movement is what says "not yet" — a still
 * image at any opacity is just an image, and the eye reads a change over time as
 * something unfinished long before it reads a shade as provisional.
 */
const GHOST_MIN = 0.15
const GHOST_MAX = 0.32

/** One full breath. Slow, because it stands for seconds and a quick blink on
 * something that is not going away reads as an error. */
const PULSE_MS = 1600

/**
 * How often the opacity is rewritten. Not every frame: each write goes through
 * `updateNodePreview`, which invalidates the picture cache, so 60fps here would
 * redraw the whole subtree from scratch sixty times a second for five seconds.
 * 25 is smooth enough for a slow breath at a fraction of that.
 */
const TICK_MS = 40

/**
 * Every change gets this, so nothing ever just appears.
 *
 * Measured against a real run before settling on it: the agent spends 18-20
 * seconds thinking between steps, so a change lands into a screen the user has
 * been staring at, and a second of fade there reads as "it appeared" rather
 * than as a preview. Next to the thinking it costs little, and the whole point
 * of the beat is that there is time to react inside it.
 */
const BEAT_MS = 5000

/**
 * When the meta-agent has warned about something there is also a marker to read
 * and a decision to make, so the beat is not enough on its own. This window is
 * also what the warning is for: when it closes the change has stood, and the
 * warning comes off the canvas.
 */
const HOLD_MS = 8000

/** 0 at the start of a breath, 1 at its fullest, back to 0. */
function breath(elapsedMs: number): number {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * elapsedMs) / PULSE_MS)
}

/**
 * Told when a preview has run its course and the change stood.
 *
 * Registered rather than imported: the only listener is the meta-agent, and it
 * reads the tool log, so calling it from the tool loop directly would close the
 * ring `tools → meta-agent → tools`. Same reason as `setReasoningObserver`.
 */
let onSettled: ((nodeIds: readonly string[]) => void) | null = null

export function setPreviewSettledObserver(observer: (nodeIds: readonly string[]) => void): void {
  onSettled = observer
}

export function previewAgentChange(store: EditorStore, nodeIds: string[]): Promise<void> {
  const original = new Map<string, number>()
  for (const id of nodeIds) {
    const node = store.graph.getNode(id)
    if (node) original.set(id, node.opacity)
  }
  if (original.size === 0) return Promise.resolve()

  // Only a warning lengthens it. A question about the design is not something to
  // stop the change for — it is answered by looking at the result, which is
  // easier once the preview is out of the way.
  const previewIds = [...original.keys()]
  const duration = hasWarnings(previewIds) ? HOLD_MS : BEAT_MS
  const started = performance.now()

  function write(factor: number): void {
    for (const [id, opacity] of original) {
      // The user may have deleted it while it was faint.
      if (store.graph.getNode(id)) store.graph.updateNodePreview(id, { opacity: opacity * factor })
    }
    store.requestRepaint()
  }

  return new Promise((resolve) => {
    let lastWrite = -Infinity
    let lastFrame = started
    /** Time spent held while someone read a marker; it does not count. */
    let held = 0

    function frame(now: number): void {
      // The clock stops while the run is held rather than the preview ending
      // underneath the reader. Waiting only at the end would restore the node to
      // full strength first, which reads as "this is settled" at exactly the
      // moment the person is deciding whether it should be.
      if (isTurnPaused()) held += now - lastFrame
      lastFrame = now
      const elapsed = now - started - held
      if (elapsed >= duration) {
        // Straight back to what the tool actually set — the faint value must
        // never outlive the preview or it reaches the file.
        write(1)
        if (held > 0) logTurnHeld('preview', held)
        // Settling is what tells the meta-agent the change stood and its
        // warnings can retire. It cannot be reached while held, so by here the
        // person has let go and the change really did stand.
        onSettled?.(previewIds)
        resolve()
        return
      }
      if (now - lastWrite >= TICK_MS) {
        lastWrite = now
        write(GHOST_MIN + (GHOST_MAX - GHOST_MIN) * breath(elapsed))
      }
      requestAnimationFrame(frame)
    }

    write(GHOST_MIN)
    requestAnimationFrame(frame)
  })
}

// Dev handle, so the fade can be watched without paying for an agent run:
//   __preview(['0:3', '0:4'])
if (import.meta.env.DEV) {
  Object.assign(window, {
    __preview: (nodeIds: string[]) => previewAgentChange(getActiveEditorStore(), nodeIds),
    /** So a test can prove the faint opacity never outlives the preview. */
    __opacityOf: (nodeId: string) => getActiveEditorStore().graph.getNode(nodeId)?.opacity
  })
}
