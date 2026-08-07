import { useEventListener, useIntervalFn } from '@vueuse/core'
import { onScopeDispose } from 'vue'

import { startPageCapture, type PageCapture } from '@/app/capture/page-capture'
import type { UserModel } from '@/app/user-model/pipeline'
import {
  beginSession,
  endSession,
  noteFrame,
  onReset,
  setPropositions
} from '@/app/user-model/store'
import { canBuildUserModel, clearSaved, createPropositionSink } from '@/app/user-model/use'

const INTERVAL_MS = 5000

/**
 * Records the page to `captures/<session>/` every few seconds so a session can
 * be reviewed afterwards. On for every dev-server session; the production build
 * never reaches it.
 *
 * The share prompt cannot open on load — browsers only allow it during a user
 * gesture — so it opens on the first click or keypress, which in practice is
 * the first thing anyone does here.
 */
export function usePageCapture(): void {
  if (!import.meta.env.DEV) return

  let capture: PageCapture | null = null
  let userModel: UserModel | null = null

  const { pause, resume } = useIntervalFn(
    () => {
      void capture
        ?.captureFrame()
        .then((alive) => {
          if (!alive) stop() // the user hit the browser's "Stop sharing"
        })
        .catch((error: unknown) => {
          console.warn('[page-capture] frame dropped:', error)
        })
    },
    INTERVAL_MS,
    { immediate: false }
  )

  function stop(): void {
    pause()
    capture?.stop()
    capture = null
    endSession()
  }

  console.warn('[page-capture] click anywhere to start recording this tab')
  const disarm = useEventListener(
    document,
    ['pointerdown', 'keydown'],
    () => {
      disarm()
      startPageCapture({
        endpoint: '/__page-capture',
        onFrame: (frame, meta) => {
          if (!userModel) return
          userModel.addFrame(frame, meta.signature)
          noteFrame()
        }
      })
        .then((started) => {
          capture = started
          // Frames go to disk either way; the user model only gets them when a
          // provider is configured, since each batch costs a model call.
          const infers = canBuildUserModel()
          if (infers) userModel = createPropositionSink(started.sessionId)
          beginSession(started.sessionId, { infers })
          onReset(() => {
            userModel?.clear()
            setPropositions([])
            void clearSaved()
          })
          resume()
        })
        .catch((error: unknown) => {
          console.warn('[page-capture] could not start:', error)
        })
    },
    { once: true, capture: true }
  )

  onScopeDispose(stop)
}
