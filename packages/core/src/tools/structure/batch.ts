import type { FigmaNodeProxy } from '#core/figma-api'
import { defineTool } from '#core/tools/schema'

interface BatchOp {
  id: string
  props: Record<string, unknown>
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

/**
 * Every prop key `applyBatchProps` understands. Anything else in an op is
 * silently dropped, so this list is reported back when nothing applied — a run
 * where the model passed `{color: "#10172E"}` got `{updated: 0}` with no error,
 * read it as success, and spent fifteen steps working around a change that had
 * never happened.
 */
const SUPPORTED_PROPS = [
  'spacing',
  'padding',
  'padding_horizontal',
  'padding_vertical',
  'align',
  'counter_align',
  'sizing_horizontal',
  'sizing_vertical',
  'grow',
  'name',
  'visible',
  'corner_radius',
  'opacity',
  'auto_resize',
  'direction'
] as const

function applyBatchProps(node: FigmaNodeProxy, props: Record<string, unknown>): string[] {
  const updated: string[] = []

  if (props.spacing !== undefined) {
    node.itemSpacing = num(props.spacing)
    updated.push('spacing')
  }
  if (props.padding !== undefined) {
    const value = num(props.padding)
    node.paddingTop = value
    node.paddingRight = value
    node.paddingBottom = value
    node.paddingLeft = value
    updated.push('padding')
  }
  if (props.padding_horizontal !== undefined) {
    node.paddingLeft = num(props.padding_horizontal)
    node.paddingRight = num(props.padding_horizontal)
    updated.push('padding_horizontal')
  }
  if (props.padding_vertical !== undefined) {
    node.paddingTop = num(props.padding_vertical)
    node.paddingBottom = num(props.padding_vertical)
    updated.push('padding_vertical')
  }
  if (props.counter_align !== undefined) {
    node.counterAxisAlignItems = str(props.counter_align)
    updated.push('counter_align')
  }
  if (props.align !== undefined) {
    node.primaryAxisAlignItems = str(props.align)
    updated.push('align')
  }
  if (props.sizing_horizontal !== undefined) {
    node.layoutSizingHorizontal = str(props.sizing_horizontal)
    updated.push('sizing_horizontal')
  }
  if (props.sizing_vertical !== undefined) {
    node.layoutSizingVertical = str(props.sizing_vertical)
    updated.push('sizing_vertical')
  }
  if (props.grow !== undefined) {
    node.layoutGrow = num(props.grow)
    updated.push('grow')
  }
  if (props.name !== undefined) {
    node.name = str(props.name)
    updated.push('name')
  }
  if (props.visible !== undefined) {
    node.visible = Boolean(props.visible)
    updated.push('visible')
  }
  if (props.corner_radius !== undefined) {
    node.cornerRadius = num(props.corner_radius)
    updated.push('corner_radius')
  }
  if (props.opacity !== undefined) {
    node.opacity = num(props.opacity)
    updated.push('opacity')
  }
  if (props.auto_resize !== undefined) {
    node.textAutoResize = str(props.auto_resize)
    updated.push('auto_resize')
  }
  if (props.direction !== undefined) {
    node.layoutMode = str(props.direction) as 'HORIZONTAL' | 'VERTICAL'
    updated.push('direction')
  }

  return updated
}

export const batchUpdate = defineTool({
  name: 'batch_update',
  mutates: true,
  description: `Execute multiple modifications in one call. Each operation is {id, props}. Props MUST come from this list — anything else is ignored: ${SUPPORTED_PROPS.join(', ')}. Colors, strokes, radius per-corner and text content are NOT here — use set_fill / set_stroke / set_radius / set_text / set_text_properties for those. Runs all updates with one layout recompute.`,
  params: {
    operations: {
      type: 'string',
      description:
        'JSON array: [{"id":"0:5","props":{"spacing":8}},{"id":"0:6","props":{"sizing_horizontal":"FILL","grow":1}}]',
      required: true
    }
  },
  execute: (figma, { operations }) => {
    let ops: BatchOp[]
    try {
      ops = JSON.parse(String(operations))
    } catch {
      return { error: 'Invalid JSON in operations' }
    }
    if (!Array.isArray(ops)) return { error: 'operations must be a JSON array' }

    const results: Array<{ id: string; updated: string[] }> = []
    const ignored: Array<{ id: string; props: string[] }> = []
    const errors: string[] = []

    for (const op of ops) {
      const node = figma.getNodeById(op.id)
      if (!node) {
        errors.push(`Node "${op.id}" not found`)
        continue
      }
      const updated = applyBatchProps(node, op.props)
      if (updated.length > 0) results.push({ id: op.id, updated })
      const dropped = Object.keys(op.props ?? {}).filter((key) => !updated.includes(key))
      if (dropped.length > 0) ignored.push({ id: op.id, props: dropped })
    }

    const out: Record<string, unknown> = { updated: results.length }
    if (results.length > 0) out.results = results
    if (ignored.length > 0) out.ignored = ignored
    if (errors.length > 0) out.errors = errors

    // Nothing applied and nothing else to report: say so as an error. Returning a
    // bare {updated: 0} reads as success, and the model moves on believing the
    // canvas changed when it did not.
    if (results.length === 0 && errors.length === 0) {
      const dropped = [...new Set(ignored.flatMap((entry) => entry.props))]
      out.error =
        `No property was applied. batch_update ignored: ${dropped.join(', ') || '(no props given)'}. ` +
        `It only handles ${SUPPORTED_PROPS.join(', ')} — use set_fill / set_stroke / set_radius / ` +
        `set_text / set_text_properties for anything else.`
    }
    return out
  }
})
