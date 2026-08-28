import type {
  FeedbackPoint,
  FeedbackSelection,
  FeedbackVisualTarget
} from '@/app/meta-agent/feedback-note/draft/types'
import type { CodeVisualTarget } from '@/app/meta-agent/feedback-note/types'

interface NormalizedRect {
  x: number
  y: number
  width: number
  height: number
}

interface PositionedTarget extends FeedbackVisualTarget {
  bounds: NormalizedRect
}

function contains(rect: NormalizedRect, point: FeedbackPoint): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

function intersectionArea(a: NormalizedRect, b: NormalizedRect): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return width * height
}

function pointBounds(points: FeedbackPoint[]): NormalizedRect | null {
  if (points.length === 0) return null
  const left = Math.min(...points.map((point) => point.x))
  const right = Math.max(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y))
  const bottom = Math.max(...points.map((point) => point.y))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function selectionPoints(selection: FeedbackSelection): FeedbackPoint[] {
  switch (selection.type) {
    case 'none':
      return []
    case 'point':
      return [selection]
    case 'arrow':
      return [selection.end, selection.start]
    case 'sequence':
      return selection.points.toReversed()
    case 'freehand':
      return selection.points
    case 'region':
      return [{ x: selection.x + selection.width / 2, y: selection.y + selection.height / 2 }]
    case 'text':
      return []
    default:
      throw new Error(`Unknown feedback selection: ${String(selection satisfies never)}`)
  }
}

function selectionBounds(selection: FeedbackSelection): NormalizedRect | null {
  switch (selection.type) {
    case 'none':
      return null
    case 'region':
      return selection
    case 'arrow':
      return pointBounds([selection.start, selection.end])
    case 'sequence':
    case 'freehand':
      return pointBounds(selection.points)
    case 'point':
      return { x: selection.x, y: selection.y, width: 0, height: 0 }
    case 'text':
      return null
    default:
      throw new Error(`Unknown feedback selection: ${String(selection satisfies never)}`)
  }
}

function targetScore(target: PositionedTarget, selection: FeedbackSelection): number {
  const points = selectionPoints(selection)
  const pointsInside = points.filter((point) => contains(target.bounds, point)).length
  if (pointsInside > 0) return 10 + pointsInside / Math.max(1, points.length)
  const bounds = selectionBounds(selection)
  if (!bounds) return 0
  const overlap = intersectionArea(target.bounds, bounds)
  if (overlap === 0) return 0
  const selectionArea = Math.max(0.0001, bounds.width * bounds.height)
  return overlap / selectionArea
}

function positionedTargets(
  frame: HTMLIFrameElement,
  container: HTMLElement,
  targets: CodeVisualTarget[]
): PositionedTarget[] {
  const frameDocument = frame.contentDocument
  if (!frameDocument) return []
  const containerBounds = container.getBoundingClientRect()
  const frameBounds = frame.getBoundingClientRect()
  if (containerBounds.width === 0 || containerBounds.height === 0) return []
  const elements = [
    ...frameDocument.querySelectorAll<HTMLElement | SVGElement>('[data-feedback-id]')
  ]
  return targets.flatMap((target) => {
    const element = elements.find((candidate) => candidate.dataset.feedbackId === target.id)
    if (!element) return []
    const bounds = element.getBoundingClientRect()
    return [
      {
        ...target,
        bounds: {
          x: (frameBounds.left + bounds.left - containerBounds.left) / containerBounds.width,
          y: (frameBounds.top + bounds.top - containerBounds.top) / containerBounds.height,
          width: bounds.width / containerBounds.width,
          height: bounds.height / containerBounds.height
        }
      }
    ]
  })
}

export function resolveCodeVisualTarget(input: {
  frame: HTMLIFrameElement
  container: HTMLElement
  targets: CodeVisualTarget[]
  selection: FeedbackSelection
}): FeedbackVisualTarget | null {
  if (input.selection.type === 'none' || input.selection.type === 'text') return null
  const ranked = positionedTargets(input.frame, input.container, input.targets)
    .map((target) => ({ target, score: targetScore(target, input.selection) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
  const match = ranked.at(0)?.target
  return match ? { id: match.id, label: match.label } : null
}
