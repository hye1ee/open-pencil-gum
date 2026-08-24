import html2canvas from 'html2canvas'

import { annotateFeedbackCanvas } from '@/app/feedback-note/draft/image'
import type { FeedbackSelection } from '@/app/feedback-note/draft/types'

async function svgCanvas(svg: SVGSVGElement): Promise<HTMLCanvasElement> {
  const bounds = svg.viewBox.baseVal
  const width = Math.max(1, Math.ceil(bounds.width || svg.getBoundingClientRect().width))
  const height = Math.max(1, Math.ceil(bounds.height || svg.getBoundingClientRect().height))
  const source = new XMLSerializer().serializeToString(svg)
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')?.drawImage(image, 0, 0, width, height)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function htmlCanvas(root: HTMLElement | null): Promise<HTMLCanvasElement> {
  if (!root) throw new Error('Code visual root is unavailable')
  return html2canvas(root, {
    backgroundColor: '#ffffff',
    logging: false,
    scale: 1,
    width: Math.max(1, root.scrollWidth),
    height: Math.max(1, root.scrollHeight),
    windowWidth: Math.max(1, root.scrollWidth),
    windowHeight: Math.max(1, root.scrollHeight)
  })
}

export async function captureCodeVisualSelection(
  frame: HTMLIFrameElement,
  selection: FeedbackSelection
): Promise<{ overviewImage: Uint8Array; annotatedImage?: Uint8Array }> {
  const frameDocument = frame.contentDocument
  if (!frameDocument) throw new Error('Code visual document is unavailable')
  const svg = frameDocument.querySelector('svg')
  const canvas = svg
    ? await svgCanvas(svg)
    : await htmlCanvas(frameDocument.querySelector<HTMLElement>('.code-visual-root'))
  return annotateFeedbackCanvas(canvas, selection)
}
