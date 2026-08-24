import type { FeedbackPoint, FeedbackSelection } from '@/app/feedback-note/draft/types'

function copyPoint(point: FeedbackPoint): FeedbackPoint {
  return { x: point.x, y: point.y }
}

export function copyFeedbackSelection(selection: FeedbackSelection): FeedbackSelection {
  switch (selection.type) {
    case 'region':
      return { ...selection }
    case 'point':
      return { ...selection }
    case 'arrow':
      return { type: 'arrow', start: copyPoint(selection.start), end: copyPoint(selection.end) }
    case 'sequence':
      return { type: 'sequence', points: selection.points.map(copyPoint) }
    case 'freehand':
      return { type: 'freehand', points: selection.points.map(copyPoint) }
    case 'text':
      return { ...selection }
  }
}

function pointText(point: FeedbackPoint): string {
  return `(${point.x.toFixed(2)}, ${point.y.toFixed(2)})`
}

export function feedbackSelectionLabel(selection: FeedbackSelection): string {
  switch (selection.type) {
    case 'region':
      return `visual region x=${selection.x.toFixed(2)}, y=${selection.y.toFixed(2)}, w=${selection.width.toFixed(2)}, h=${selection.height.toFixed(2)}`
    case 'point':
      return `position ${pointText(selection)}`
    case 'arrow':
      return `direction ${pointText(selection.start)} → ${pointText(selection.end)}`
    case 'sequence':
      return `ordered positions ${selection.points.map((point, index) => `${index + 1}:${pointText(point)}`).join(' → ')}`
    case 'freehand':
      return `freehand path through ${selection.points.length} points`
    case 'text':
      return `${selection.source} text: "${selection.text}"`
  }
}
