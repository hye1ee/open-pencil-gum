const ALLOWED_TAGS = new Set([
  'svg',
  'g',
  'defs',
  'style',
  'marker',
  'mask',
  'pattern',
  'filter',
  'fedropshadow',
  'fegaussianblur',
  'feoffset',
  'feflood',
  'fecomposite',
  'femerge',
  'femergenode',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'foreignobject',
  'div',
  'span',
  'p',
  'rect',
  'circle',
  'ellipse',
  'line',
  'path',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'title',
  'desc'
])

const MAX_SVG_LENGTH = 30_000
const MAX_ELEMENTS = 160

function stripMarkdownFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:svg|xml)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

export type CodeVisualSvgRejection =
  | 'invalid-input'
  | 'empty-svg'
  | 'svg-too-long'
  | 'invalid-root'
  | 'invalid-viewbox'
  | 'event-handler'
  | 'external-reference'
  | 'executable-content'
  | 'external-css-url'
  | 'too-many-elements'
  | `forbidden-tag:${string}`

export type CodeVisualSvgInspection =
  | { content: string; rejection: null }
  | { content: null; rejection: CodeVisualSvgRejection }

function readViewBox(source: string): { width: number; height: number } | null {
  const match = source.match(
    /\bviewBox\s*=\s*["']\s*0(?:\.0+)?\s+0(?:\.0+)?\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*["']/i
  )
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width < 1 || width > 1440 || height < 1 || height > 720) return null
  return { width, height }
}

export function inspectCodeVisualSvg(value: unknown): CodeVisualSvgInspection {
  if (typeof value !== 'string') return { content: null, rejection: 'invalid-input' }
  const source = stripMarkdownFence(value)
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
  if (!source) return { content: null, rejection: 'empty-svg' }
  if (source.length > MAX_SVG_LENGTH) return { content: null, rejection: 'svg-too-long' }
  if (!/^<svg\b[^>]*>[\s\S]*<\/svg>$/i.test(source)) {
    return { content: null, rejection: 'invalid-root' }
  }
  if (/\son[a-z-]+\s*=/i.test(source)) {
    return { content: null, rejection: 'event-handler' }
  }
  if (/\b(?:href|src)\s*=/i.test(source)) {
    return { content: null, rejection: 'external-reference' }
  }
  if (/\b(?:javascript|data):|@import/i.test(source)) {
    return { content: null, rejection: 'executable-content' }
  }
  if (/url\s*\(\s*(?!#)/i.test(source)) {
    return { content: null, rejection: 'external-css-url' }
  }

  const tags = [...source.matchAll(/<\/?([a-z][\w-]*)\b/gi)]
  if (tags.length > MAX_ELEMENTS * 2) {
    return { content: null, rejection: 'too-many-elements' }
  }
  for (const match of tags) {
    const name = match[1]?.toLowerCase()
    if (!name) return { content: null, rejection: 'invalid-input' }
    if (!ALLOWED_TAGS.has(name)) {
      return { content: null, rejection: `forbidden-tag:${name}` }
    }
  }

  const openingEnd = source.indexOf('>')
  const closingStart = source.toLowerCase().lastIndexOf('</svg>')
  if (openingEnd === -1 || closingStart <= openingEnd) {
    return { content: null, rejection: 'invalid-root' }
  }
  const viewBox = readViewBox(source.slice(0, openingEnd + 1))
  if (!viewBox) return { content: null, rejection: 'invalid-viewbox' }
  const content = source.slice(openingEnd + 1, closingStart)
  return {
    content: `<svg xmlns="http://www.w3.org/2000/svg" width="${viewBox.width}" height="${viewBox.height}" viewBox="0 0 ${viewBox.width} ${viewBox.height}" preserveAspectRatio="xMidYMid meet" role="img">${content}</svg>`,
    rejection: null
  }
}

export function sanitizeCodeVisualSvg(value: unknown): string | null {
  return inspectCodeVisualSvg(value).content
}

export function codeVisualSvgToUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
