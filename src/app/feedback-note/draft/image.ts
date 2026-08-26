import type { FeedbackPoint, FeedbackSelection } from '@/app/feedback-note/draft/types'

const OVERVIEW_MAX_SIZE = 640
const ANNOTATION_COLOR = '#7c3aed'

async function canvasBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.86)
  })
  if (!blob) throw new Error('Could not encode feedback annotation image')
  return new Uint8Array(await blob.arrayBuffer())
}

function scaledCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const scale = Math.min(1, OVERVIEW_MAX_SIZE / Math.max(source.width, source.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.width * scale))
  canvas.height = Math.max(1, Math.round(source.height * scale))
  canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

function canvasPoint(canvas: HTMLCanvasElement, point: FeedbackPoint): FeedbackPoint {
  return { x: point.x * canvas.width, y: point.y * canvas.height }
}

function drawArrowHead(
  context: CanvasRenderingContext2D,
  start: FeedbackPoint,
  end: FeedbackPoint,
  size: number
) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  context.moveTo(end.x, end.y)
  context.lineTo(
    end.x - size * Math.cos(angle - Math.PI / 6),
    end.y - size * Math.sin(angle - Math.PI / 6)
  )
  context.moveTo(end.x, end.y)
  context.lineTo(
    end.x - size * Math.cos(angle + Math.PI / 6),
    end.y - size * Math.sin(angle + Math.PI / 6)
  )
}

function drawAnnotation(canvas: HTMLCanvasElement, selection: FeedbackSelection) {
  if (selection.type === 'none' || selection.type === 'text') return
  const context = canvas.getContext('2d')
  if (!context) return
  const scale = Math.max(1, Math.min(canvas.width, canvas.height) / 360)
  context.save()
  context.strokeStyle = ANNOTATION_COLOR
  context.fillStyle = ANNOTATION_COLOR
  context.lineWidth = 4 * scale
  context.lineCap = 'round'
  context.lineJoin = 'round'

  if (selection.type === 'region') {
    context.strokeRect(
      selection.x * canvas.width,
      selection.y * canvas.height,
      selection.width * canvas.width,
      selection.height * canvas.height
    )
  } else if (selection.type === 'point') {
    const point = canvasPoint(canvas, selection)
    context.beginPath()
    context.arc(point.x, point.y, 8 * scale, 0, Math.PI * 2)
    context.fill()
    context.beginPath()
    context.arc(point.x, point.y, 13 * scale, 0, Math.PI * 2)
    context.stroke()
  } else if (selection.type === 'arrow') {
    const start = canvasPoint(canvas, selection.start)
    const end = canvasPoint(canvas, selection.end)
    context.beginPath()
    context.moveTo(start.x, start.y)
    context.lineTo(end.x, end.y)
    drawArrowHead(context, start, end, 14 * scale)
    context.stroke()
  } else if (selection.type === 'sequence') {
    context.font = `600 ${12 * scale}px sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    selection.points.forEach((value, index) => {
      const point = canvasPoint(canvas, value)
      context.beginPath()
      context.arc(point.x, point.y, 11 * scale, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#ffffff'
      context.fillText(String(index + 1), point.x, point.y)
      context.fillStyle = ANNOTATION_COLOR
    })
  } else {
    const [first, ...rest] = selection.points
    const start = canvasPoint(canvas, first)
    context.beginPath()
    context.moveTo(start.x, start.y)
    for (const value of rest) {
      const point = canvasPoint(canvas, value)
      context.lineTo(point.x, point.y)
    }
    context.stroke()
  }
  context.restore()
}

export async function annotateFeedbackImage(
  source: string,
  selection: FeedbackSelection
): Promise<{ overviewImage: Uint8Array; annotatedImage?: Uint8Array }> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.src = source
  await image.decode()
  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = image.naturalWidth
  sourceCanvas.height = image.naturalHeight
  sourceCanvas.getContext('2d')?.drawImage(image, 0, 0)
  return annotateFeedbackCanvas(sourceCanvas, selection)
}

export async function annotateFeedbackCanvas(
  sourceCanvas: HTMLCanvasElement,
  selection: FeedbackSelection
): Promise<{ overviewImage: Uint8Array; annotatedImage?: Uint8Array }> {
  const overview = scaledCanvas(sourceCanvas)
  const overviewImage = await canvasBytes(overview)
  if (selection.type === 'none' || selection.type === 'text') return { overviewImage }
  const annotated = scaledCanvas(sourceCanvas)
  drawAnnotation(annotated, selection)
  return { overviewImage, annotatedImage: await canvasBytes(annotated) }
}
