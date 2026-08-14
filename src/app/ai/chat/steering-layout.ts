import type { Vector } from '@open-pencil/scene-graph/primitives'

import { MAX_RATING } from '@/app/meta-agent/judge'
import type { Mark } from '@/app/meta-agent/judge'

/**
 * Where a mark sits in the steering space. The rating picks the ring, and the
 * angle is shared out evenly among whatever else is on that ring.
 */

/** Ten rings: following 5…1 innermost, then against 1…5. */
export const RING_COUNT = MAX_RATING * 2

export interface PlacedMark {
  mark: Mark
  /** 0 innermost. Matches the index into `RING_COLORS`. */
  ring: number
  /** Radians, 0 at twelve o'clock and growing clockwise. */
  angle: number
}

/** Off the scale — an unknown has no ring, and neither has a withdrawn mark. */
export function ringIndexFor(rating: number): number | null {
  if (rating === 0 || Math.abs(rating) > MAX_RATING) return null
  return rating > 0 ? MAX_RATING - rating : MAX_RATING - 1 - rating
}


function hash(id: string): number {
  let value = 0x81_1c_9d_c5
  for (let i = 0; i < id.length; i++) {
    value = Math.imul(value ^ id.charCodeAt(i), 0x01_00_01_93)
  }
  value ^= value >>> 16
  value = Math.imul(value, 0x85_eb_ca_6b)
  value ^= value >>> 13
  value = Math.imul(value, 0xc2_b2_ae_35)
  value ^= value >>> 16
  return (value >>> 0) / 0x1_00_00_00_00
}


export function placeMarks(marks: readonly Mark[]): PlacedMark[] {
  const placed: PlacedMark[] = []
  for (const mark of marks) {
    const ring = ringIndexFor(mark.rating)
    if (ring === null) continue
    placed.push({ mark, ring, angle: hash(mark.id) * Math.PI * 2 })
  }
  return placed
}

/** Screen offset from the centre. Twelve o'clock is −y, and the angle turns
 * clockwise from there. */
export function offsetFor(placed: PlacedMark, radius: number): Vector {
  return { x: Math.sin(placed.angle) * radius, y: -Math.cos(placed.angle) * radius }
}
