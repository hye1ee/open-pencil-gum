import type { Mark } from '@/app/meta-agent/judge'

/**
 * One palette for everything that shows a mark's rating: the badge on the
 * canvas and the rings of the steering space read the same ten colours.
 */

/** Innermost ring outward: following 5…1, then against 1…5. Darker is stronger,
 * and the sign changes between index 4 and 5. */
export const RING_COLORS = [
  '#59BF73',
  '#8BD29D',
  '#ACDFB9',
  '#CDECD5',
  '#EEF9F1',
  '#FCF1F1',
  '#F5D4D4',
  '#EEB7B7',
  '#E79A9A',
  '#DA5F5F'
]

/** Off the scale — an unknown rests on no proposition, so it is neither side. */
export const UNKNOWN_COLOR = 'hsl(220 9% 60%)'

/** `rating` is −5…+5 and `RING_COLORS` runs +5 first, so +5 is index 0 and −5 is
 * the last. Rating 0 is a withdrawn mark and has no place on the scale. */
export function markColor(mark: Mark): string {
  if (mark.relation === 'unknown' || mark.rating === 0) return UNKNOWN_COLOR
  const index = mark.rating > 0 ? 5 - mark.rating : 4 - mark.rating
  return RING_COLORS[index] ?? UNKNOWN_COLOR
}
