import { useEventListener } from '@vueuse/core'
import type { ComputedRef } from 'vue'

import { setAttentionPeek } from '@/app/ai/chat/agent-attention'
import type { EditorStore } from '@/app/editor/active-store'

/**
 * Hold ` to see what the agent is attending to. Same shape as the space/hand
 * tool: a peek, not a mode — release and the canvas is clean again.
 *
 * The `window` blur reset matters as much as the keyup: Cmd-Tab away while the
 * key is down and the keyup never arrives, leaving the glow stuck on.
 */
export function bindAttentionPeek(inputFocused: ComputedRef<boolean>, store: EditorStore) {
  function stop() {
    setAttentionPeek(store, false)
  }

  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    if (event.code !== 'Backquote') return
    if (inputFocused.value || store.state.editingTextId) return
    // Cmd+` is the OS window cycler and Ctrl+` is a common terminal toggle —
    // don't swallow either.
    if (event.metaKey || event.ctrlKey || event.altKey) return
    event.preventDefault()
    setAttentionPeek(store, true)
  })

  useEventListener(window, 'keyup', (event: KeyboardEvent) => {
    if (event.code === 'Backquote') stop()
  })

  useEventListener(window, 'blur', stop)
}
