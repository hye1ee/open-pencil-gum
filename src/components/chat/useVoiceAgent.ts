import { onBeforeUnmount, ref } from 'vue'

const WAKE_WORD_RE = /\bagent\b/i
const DEFAULT_SILENCE_MS = 4000

export type VoicePhase = 'idle' | 'listening'

export interface UseVoiceAgentOptions {
  /** Called with the accumulated command once N ms pass with no new speech. */
  onSubmit: (text: string) => void
  /** Called on unrecoverable errors (e.g. mic permission denied). */
  onError?: (message: string) => void
  /** Silence timeout after the last speech before auto-submitting. Default 4000ms. */
  silenceMs?: number
}

/**
 * Always-on voice control for the chat: say "agent" to start dictating, keep
 * talking, and after `silenceMs` of no new speech the accumulated text is
 * auto-submitted. Modeled on Kixlab/gpt-talk-to-figma's StreamingService
 * (Google Cloud streamingRecognize + a final-timer that interim results
 * cancel and final results restart) — ported onto the browser's
 * SpeechRecognition instead of a server-side Google Cloud stream.
 *
 * SpeechRecognition sessions don't stay open forever (browsers end them after
 * a period of silence even with `continuous: true`), so this restarts the
 * recognizer on `onend` to stay listening indefinitely. `accumulated`/`phase`
 * live outside any single recognizer instance so a restart never loses state.
 */
export function useVoiceAgent(options: UseVoiceAgentOptions) {
  const ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition
  const isSupported = !!ctor
  const silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS

  const enabled = ref(false)
  const phase = ref<VoicePhase>('idle')
  const liveText = ref('')

  let recognition: SpeechRecognition | null = null
  let accumulated = ''
  let silenceTimer: ReturnType<typeof setTimeout> | null = null
  let stopping = false

  function clearSilenceTimer(): void {
    if (silenceTimer !== null) {
      clearTimeout(silenceTimer)
      silenceTimer = null
    }
  }

  function armSilenceTimer(): void {
    clearSilenceTimer()
    silenceTimer = setTimeout(() => {
      const text = accumulated.trim()
      resetToIdle()
      if (text) options.onSubmit(text)
    }, silenceMs)
  }

  function resetToIdle(): void {
    clearSilenceTimer()
    accumulated = ''
    liveText.value = ''
    phase.value = 'idle'
  }

  function handleResult(event: SpeechRecognitionEvent): void {
    let finalChunk = ''
    let interimChunk = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]
      const transcript = result.item(0).transcript
      if (result.isFinal) finalChunk += transcript
      else interimChunk += transcript
    }
    if (!finalChunk && !interimChunk) return

    if (phase.value === 'idle') {
      const match = (finalChunk + interimChunk).match(WAKE_WORD_RE)
      if (match?.index === undefined) return
      phase.value = 'listening'
      accumulated = (finalChunk + interimChunk).slice(match.index + match[0].length).trim()
      liveText.value = accumulated
      if (interimChunk) clearSilenceTimer()
      else if (accumulated) armSilenceTimer()
      return
    }

    if (finalChunk) {
      accumulated = accumulated ? `${accumulated} ${finalChunk.trim()}` : finalChunk.trim()
    }
    liveText.value = interimChunk ? `${accumulated} ${interimChunk}`.trim() : accumulated

    if (interimChunk) clearSilenceTimer()
    else if (finalChunk) armSilenceTimer()
  }

  function attachInstance(): void {
    if (!ctor) return
    recognition = new ctor()
    recognition.continuous = true
    recognition.interimResults = true
    // Fixed to English, not navigator.language: the wake word ("agent") is matched
    // as literal English text, so a non-English recognizer would never transcribe
    // it and the wake word could never fire.
    recognition.lang = 'en-US'

    recognition.onresult = handleResult
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        stopping = true
        enabled.value = false
        resetToIdle()
        options.onError?.('Microphone permission denied.')
      }
      // Other errors (no-speech, network, aborted) are transient — onend restarts it.
    }
    recognition.onend = () => {
      recognition = null
      if (enabled.value && !stopping) attachInstance()
    }

    try {
      recognition.start()
    } catch (err) {
      // start() throws if a session is already active on rapid re-entry — ignore.
      console.warn('[voice-agent] recognition.start() failed:', err)
    }
  }

  function enable(): void {
    if (!ctor || enabled.value) return
    stopping = false
    enabled.value = true
    resetToIdle()
    attachInstance()
  }

  function disable(): void {
    stopping = true
    enabled.value = false
    resetToIdle()
    recognition?.stop()
    recognition = null
  }

  function toggle(): void {
    if (enabled.value) disable()
    else enable()
  }

  onBeforeUnmount(() => {
    stopping = true
    recognition?.abort()
    recognition = null
    clearSilenceTimer()
  })

  return { isSupported, enabled, phase, liveText, enable, disable, toggle }
}
