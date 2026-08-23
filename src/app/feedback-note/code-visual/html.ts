const FORBIDDEN_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'img',
  'video',
  'audio',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'textarea',
  'select'
])

const MAX_HTML_LENGTH = 12_000
const MAX_CSS_LENGTH = 16_000
const MAX_ELEMENTS = 120

export type CodeVisualHtmlRejection =
  | 'invalid-input'
  | 'empty-html'
  | 'html-too-long'
  | 'css-too-long'
  | 'event-handler'
  | 'external-reference'
  | 'executable-content'
  | 'css-url'
  | 'css-markup'
  | 'too-many-elements'
  | `forbidden-tag:${string}`

export type CodeVisualHtmlInspection =
  | { content: string; rejection: null }
  | { content: null; rejection: CodeVisualHtmlRejection }

export function inspectCodeVisualHtml(
  htmlValue: unknown,
  cssValue: unknown
): CodeVisualHtmlInspection {
  if (typeof htmlValue !== 'string' || typeof cssValue !== 'string') {
    return { content: null, rejection: 'invalid-input' }
  }
  const html = htmlValue.trim()
  const css = cssValue.trim()
  if (!html) return { content: null, rejection: 'empty-html' }
  if (html.length > MAX_HTML_LENGTH) return { content: null, rejection: 'html-too-long' }
  if (css.length > MAX_CSS_LENGTH) return { content: null, rejection: 'css-too-long' }
  if (/\son[a-z-]+\s*=/i.test(html) || /\son[a-z-]+\s*=/i.test(css)) {
    return { content: null, rejection: 'event-handler' }
  }
  if (/\b(?:href|src)\s*=/i.test(html) || /\b(?:href|src)\s*=/i.test(css)) {
    return { content: null, rejection: 'external-reference' }
  }
  if (/\b(?:javascript|data|https?):|@import/i.test(html + css)) {
    return { content: null, rejection: 'executable-content' }
  }
  if (/url\s*\(/i.test(html) || /url\s*\(/i.test(css)) {
    return { content: null, rejection: 'css-url' }
  }
  if (/[<>]/.test(css)) return { content: null, rejection: 'css-markup' }
  const tags = [...html.matchAll(/<\/?([a-z][\w-]*)\b/gi)]
  if (tags.length > MAX_ELEMENTS * 2) {
    return { content: null, rejection: 'too-many-elements' }
  }
  for (const match of tags) {
    const name = match[1]?.toLowerCase()
    if (!name) return { content: null, rejection: 'invalid-input' }
    if (FORBIDDEN_TAGS.has(name)) {
      return { content: null, rejection: `forbidden-tag:${name}` }
    }
  }
  const base = `*{box-sizing:border-box}html,body{width:100%;min-height:100%;margin:0;background:transparent}html{overflow:hidden}body{overflow:visible;color:#2f2b33;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.code-visual-viewport{width:720px;min-height:440px;overflow:visible;zoom:calc(100vw / 720px)}.code-visual-root{width:720px;min-height:440px;height:auto;padding:0;overflow:visible}`
  return {
    content: `<!doctype html><html><head><meta charset="utf-8"><style>${css}${base}</style></head><body><div class="code-visual-viewport"><main class="code-visual-root">${html}</main></div></body></html>`,
    rejection: null
  }
}

export function sanitizeCodeVisualHtml(htmlValue: unknown, cssValue: unknown): string | null {
  return inspectCodeVisualHtml(htmlValue, cssValue).content
}
