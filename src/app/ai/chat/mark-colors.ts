import type { Mark, SpectrumStep } from '@/app/meta-agent/judge'

/**
 * Two ends and the mixes between them. Violet is ours and is the app accent;
 * blue is the agent's own and is `AI_ACTIVE_COLOR`, the colour of its cursor.
 * Neither is the wrong end, so green and red stay out — they would read as a
 * verdict on the decision, which nothing here makes any more.
 */
const USER_MODEL_END = [0x6b, 0x5b, 0xd6] as const
const REASONING_END = [0x42, 0x85, 0xf5] as const
/** `--color-muted`. The middle is neither end, and a marker nobody has moved
 * sits there — so it reads as untouched rather than as a weak choice. */
const NEUTRAL = [0x77, 0x71, 0x6a] as const

/** Each half fades to neutral at the middle rather than mixing the two ends into
 * each other: violet and blue are close enough that a straight blend gives five
 * shades nobody can tell apart. */
function toward(end: readonly number[], amount: number): string {
  const channel = (index: number) =>
    Math.round(NEUTRAL[index] + ((end[index] ?? 0) - NEUTRAL[index]) * amount)
  return `#${[0, 1, 2].map((index) => channel(index).toString(16).padStart(2, '0')).join('')}`
}

export const STEP_COLORS: Record<SpectrumStep, string> = {
  as_reasoned: toward(REASONING_END, 1),
  mostly_reasoned: toward(REASONING_END, 0.5),
  halfway: toward(NEUTRAL, 1),
  mostly_user_model: toward(USER_MODEL_END, 0.5),
  as_user_model: toward(USER_MODEL_END, 1)
}

/**
 * Two chevrons, drawn in a 20×20 box centred on the marker. A mark with a
 * spectrum can be dragged up and down it, and that is the one thing a person has
 * to work out unprompted. Shared so the canvas badge and the steering space are
 * one shape and cannot drift apart.
 */
export const STEERABLE_GLYPH = 'M -3.4 -1.6 L 0 -5 L 3.4 -1.6 M -3.4 1.6 L 0 5 L 3.4 1.6'

/** A mark no proposition covers has no scale to sit on. */
export const UNKNOWN_COLOR = 'hsl(220 9% 60%)'

export function stepColor(step: SpectrumStep | null): string {
  return step === null ? UNKNOWN_COLOR : STEP_COLORS[step]
}

export function markColor(mark: Mark): string {
  return stepColor(mark.position)
}
