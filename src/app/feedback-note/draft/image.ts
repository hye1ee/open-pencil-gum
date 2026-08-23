import type { FeedbackSelection } from '@/app/feedback-note/draft/types'

const OVERVIEW_MAX_SIZE = 640
const CROP_MAX_SIZE = 480

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

  const overviewSize = fittedSize(image.naturalWidth, image.naturalHeight, OVERVIEW_MAX_SIZE)
  const overview = document.createElement('canvas')
  overview.width = overviewSize.width
  overview.height = overviewSize.height
  overview.getContext('2d')?.drawImage(image, 0, 0, overview.width, overview.height)
  const overviewImage = await canvasBytes(overview)
  if (selection.type !== 'region') return { overviewImage }

  const sourceX = Math.round(selection.x * image.naturalWidth)
  const sourceY = Math.round(selection.y * image.naturalHeight)
  const sourceWidth = Math.max(1, Math.round(selection.width * image.naturalWidth))
  const sourceHeight = Math.max(1, Math.round(selection.height * image.naturalHeight))
  const cropSize = fittedSize(sourceWidth, sourceHeight, CROP_MAX_SIZE)
  const crop = document.createElement('canvas')
  crop.width = cropSize.width
  crop.height = cropSize.height
  crop
    .getContext('2d')
    ?.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, crop.width, crop.height)
  return { overviewImage, selectionImage: await canvasBytes(crop) }
}
