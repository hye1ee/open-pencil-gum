import { pauseTurn, resumeTurn } from '@/app/ai/chat/agent-turn'
import { currentRunStepNumber } from '@/app/ai/tools'
import { createHandsOffCanvasSession } from '@/app/study/hands-off/canvas-session'

/**
 * Hands-off delegation binding for LenCanvas. The session holds the turn while
 * the participant annotates a step's reasoning and again while they judge the
 * executed step; released tool calls run exactly as the agent issued them.
 */
export const lencanvasHandsOffAnnotations = createHandsOffCanvasSession({
  hold: () => pauseTurn('hands-off-annotation'),
  release: () => resumeTurn('hands-off-annotation'),
  getCurrentStepNumber: () => currentRunStepNumber()
})
