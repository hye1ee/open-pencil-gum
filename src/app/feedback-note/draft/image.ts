import type { FeedbackPoint, FeedbackSelection } from '@/app/feedback-note/draft/types'

const OVERVIEW_MAX_SIZE = 640
const CROP_MAX_SIZE = 480
const ANNOTATION_PADDING = 0.06

interface SelectionBounds {
  x: number
  y: number
  width: number
  height: number
}

function paddedBounds(points: FeedbackPoint[]): SelectionBounds | null {
  if (points.length === 0) return null
  const left = Math.min(...points.map((point) => point.x))
  const right = Math.max(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y))
  const bottom = Math.max(...points.map((point) => point.y))
  const x = Math.max(0, left - ANNOTATION_PADDING)
  const y = Math.max(0, top - ANNOTATION_PADDING)
  return {
    x,
    y,
    width: Math.min(1 - x, Math.max(ANNOTATION_PADDING * 2, right - left + ANNOTATION_PADDING * 2)),
    height: Math.min(1 - y, Math.max(ANNOTATION_PADDING * 2, bottom - top + ANNOTATION_PADDING * 2))
  }
}

function selectionBounds(selection: FeedbackSelection): SelectionBounds | null {
  switch (selection.type) {
    case 'region':
      return selection
    case 'point':
      return paddedBounds([selection])
    case 'arrow':
      return paddedBounds([selection.start, selection.end])
    case 'sequence':
    case 'freehand':
      return paddedBounds(selection.points)
    case 'text':
      return null
  }
}

async function canvasBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.82)
  })
  if (!blob) throw new Error('Could not encode feedback selection image')
  return new Uint8Array(await blob.arrayBuffer())
}

function fittedSize(width: number, height: number, maximum: number) {
  const scale = Math.min(1, maximum / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

export async function cropFeedbackImage(
  source: string,
  selection: FeedbackSelection
): Promise<{ overviewImage: Uint8Array; selectionImage?: Uint8Array }> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.src = source
  await image.decode()

  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = image.naturalWidth
  sourceCanvas.height = image.naturalHeight
  sourceCanvas.getContext('2d')?.drawImage(image, 0, 0)
  return cropFeedbackCanvas(sourceCanvas, selection)
}

export async function cropFeedbackCanvas(
  sourceCanvas: HTMLCanvasElement,
  selection: FeedbackSelection
): Promise<{ overviewImage: Uint8Array; selectionImage?: Uint8Array }> {
  const overviewSize = fittedSize(sourceCanvas.width, sourceCanvas.height, OVERVIEW_MAX_SIZE)
  const overview = document.createElement('canvas')
  overview.width = overviewSize.width
  overview.height = overviewSize.height
  overview
    .getContext('2d')
    ?.drawImage(
      sourceCanvas,
      0,
      0,
      sourceCanvas.width,
      sourceCanvas.height,
      0,
      0,
      overview.width,
      overview.height
    )
  const overviewImage = await canvasBytes(overview)
  const bounds = selectionBounds(selection)
  if (!bounds) return { overviewImage }

  const sourceX = Math.round(bounds.x * sourceCanvas.width)
  const sourceY = Math.round(bounds.y * sourceCanvas.height)
  const sourceWidth = Math.max(1, Math.round(bounds.width * sourceCanvas.width))
  const sourceHeight = Math.max(1, Math.round(bounds.height * sourceCanvas.height))
  const cropSize = fittedSize(sourceWidth, sourceHeight, CROP_MAX_SIZE)
  const crop = document.createElement('canvas')
  crop.width = cropSize.width
  crop.height = cropSize.height
  crop
    .getContext('2d')
    ?.drawImage(
      sourceCanvas,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      crop.width,
      crop.height
    )
  return { overviewImage, selectionImage: await canvasBytes(crop) }
}
