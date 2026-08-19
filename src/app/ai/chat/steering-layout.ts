import { SPECTRUM, isUnrelated } from '@/app/meta-agent/judge'
import type { Mark, SpectrumStep } from '@/app/meta-agent/judge'

export const TIMELINE_HEIGHT = 180
export const TIMELINE_PADDING_X = 112
export const TIMELINE_EVENT_GAP = 92
export const TIMELINE_EMPTY_STEP_WIDTH = 64
export const TIMELINE_STEP_WIDTH = 180

export interface TimelinePoint {
  mark: Mark
  x: number
  y: number
  unknown: boolean
}

export interface TimelineRegion {
  key: string
  kind: 'rated' | 'unknown'
  start: number
  end: number
}

export interface TimelineStep {
  number: number
  label: string
  start: number
  end: number
}

export interface TimelineLayout {
  points: TimelinePoint[]
  regions: TimelineRegion[]
  steps: TimelineStep[]
  width: number
}

/** Five even rows, our end on top. A mark with no spectrum has no row of its
 * own and sits on the middle line. */
export function positionY(step: SpectrumStep | null, height = TIMELINE_HEIGHT): number {
  const middle = height / 2
  if (step === null) return middle
  const index = SPECTRUM.indexOf(step)
  const top = 30
  const bottom = height - 30
  return bottom - (index / (SPECTRUM.length - 1)) * (bottom - top)
}

export function layoutTimeline(
  marks: readonly Mark[],
  recordedSteps: readonly number[] = [],
  height = TIMELINE_HEIGHT
): TimelineLayout {
  const ordered = [...marks].sort(
    (a, b) => a.raisedInStep - b.raisedInStep || a.raisedOrder - b.raisedOrder
  )
  const stepNumbers = [
    ...new Set([...recordedSteps, ...ordered.map((mark) => mark.raisedInStep)])
  ].sort((a, b) => a - b)
  const stepEntries: Array<{ number: number; label: string; gap: boolean }> = []
  for (const number of stepNumbers) {
    const previous = stepEntries.at(-1)
    if (previous && number - previous.number > 1) {
      const first = previous.number + 1
      const last = number - 1
      stepEntries.push({
        number: first,
        label: first === last ? `Step ${first}` : `Steps ${first}–${last}`,
        gap: true
      })
    }
    stepEntries.push({ number, label: `Step ${number}`, gap: false })
  }
  const padding = TIMELINE_PADDING_X
  let cursor = padding
  /** A skipped range is a thin marker, an empty step is narrow, and a step with
   * marks widens to fit them. */
  function widthOf(count: number, gap: boolean): number {
    if (gap) return 56
    if (count === 0) return TIMELINE_EMPTY_STEP_WIDTH
    return Math.max(TIMELINE_STEP_WIDTH, TIMELINE_STEP_WIDTH + (count - 1) * TIMELINE_EVENT_GAP)
  }

  const steps = stepEntries.map(({ number, label, gap }) => {
    const count = ordered.filter((mark) => mark.raisedInStep === number).length
    const stepWidth = widthOf(count, gap)
    const step = { number, label, start: cursor, end: cursor + stepWidth }
    cursor = step.end
    return step
  })
  const points = ordered.map((mark) => {
    const step = steps.find((candidate) => candidate.number === mark.raisedInStep)
    const peers = ordered.filter((candidate) => candidate.raisedInStep === mark.raisedInStep)
    const peerIndex = peers.indexOf(mark)
    const start = step?.start ?? padding
    const x = start + TIMELINE_STEP_WIDTH / 2 + peerIndex * TIMELINE_EVENT_GAP
    return { mark, x, y: positionY(mark.position, height), unknown: isUnrelated(mark) }
  })

  const width = Math.max(360, cursor + padding)
  // Only where marks landed. A step the meta-agent found nothing in stays empty,
  // and so do the margins — the band is a record of what happened, not a track
  // laid ahead of the run.
  const regions = points.map((point) => {
    const step = steps.find((candidate) => candidate.number === point.mark.raisedInStep)
    const peers = points.filter(
      (candidate) => candidate.mark.raisedInStep === point.mark.raisedInStep
    )
    const index = peers.indexOf(point)
    return {
      key: `${point.mark.id}:${point.mark.raisedInStep}:${point.mark.raisedOrder}`,
      kind: point.unknown ? ('unknown' as const) : ('rated' as const),
      start: index === 0 ? (step?.start ?? 0) : (peers[index - 1].x + point.x) / 2,
      end: index === peers.length - 1 ? (step?.end ?? width) : (point.x + peers[index + 1].x) / 2
    }
  })
  return { points, regions, steps, width }
}

export function curvePath(points: readonly TimelinePoint[]): string {
  if (points.length === 0) return ''
  let path = `M ${points[0].x} ${points[0].y}`
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]
    const point = points[index]
    const middle = (previous.x + point.x) / 2
    path += ` C ${middle} ${previous.y}, ${middle} ${point.y}, ${point.x} ${point.y}`
  }
  return path
}
