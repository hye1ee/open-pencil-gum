import { reactive } from 'vue'

/**
 * What the agent says *on the canvas* — a speech bubble next to the agent
 * cursor carrying its own step text, so the user sees what it is doing without
 * having the AI tab open.
 *
 * Fed from the tool loop (`onStepFinish`), not from the chat component: the
 * panel is unmounted whenever the user is on another tab, which is exactly when
 * the bubble matters. Each line replaces the previous one and expires on its own
 * so a finished run doesn't leave a stale bubble hanging over the canvas.
 */

export const agentSpeech = reactive<{ text: string }>({ text: '' })

const MIN_MS = 2500
const MAX_MS = 9000
const MS_PER_CHAR = 55
/** A glance, not a transcript — the full text is still in the chat. */
const MAX_CHARS = 120

let timer = 0

/** First meaningful line, stripped of the markdown the chat renders and we don't. */
function condense(text: string): string {
  const line = text
    .split('\n')
    .map((l) => l.replaceAll(/^[\s>#*\-•\d.]+/g, '').trim())
    .find((l) => l.length > 0)
  if (!line) return ''
  const flat = line.replaceAll(/[*_`]/g, '').replaceAll(/\s+/g, ' ').trim()
  if (flat.length <= MAX_CHARS) return flat
  const cut = flat.slice(0, MAX_CHARS)
  const space = cut.lastIndexOf(' ')
  return (space > MAX_CHARS * 0.6 ? cut.slice(0, space) : cut) + '…'
}

/** Show a line the agent produced. No-op for an empty/whitespace-only step. */
export function sayAgent(text: string): void {
  const message = condense(text)
  if (!message) return
  agentSpeech.text = message
  clearTimeout(timer)
  timer = window.setTimeout(
    clearAgentSpeech,
    Math.min(MAX_MS, Math.max(MIN_MS, message.length * MS_PER_CHAR))
  )
}

export function clearAgentSpeech(): void {
  clearTimeout(timer)
  timer = 0
  agentSpeech.text = ''
}
