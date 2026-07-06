import type { FigmaNodeProxy } from '#core/figma-api'
import { parseColor } from '#core/color'
import { defineTool, nodeToResult } from '#core/tools/schema'

interface StyleArgs {
  fill?: string
  stroke?: string
  stroke_weight?: number
  stroke_align?: string
  corner_radius?: number
}

function applyStyle(node: FigmaNodeProxy, args: StyleArgs): void {
  if (args.fill) {
    node.fills = [{ type: 'SOLID', color: parseColor(args.fill), opacity: 1, visible: true }]
  }
  if (args.stroke) {
    node.strokes = [
      {
        color: parseColor(args.stroke),
        weight: args.stroke_weight ?? 1,
        opacity: 1,
        visible: true,
        align: (args.stroke_align ?? 'INSIDE') as 'INSIDE' | 'CENTER' | 'OUTSIDE'
      }
    ]
  }
  if (args.corner_radius !== undefined) node.cornerRadius = args.corner_radius
}

function attachToParent(
  figma: { getNodeById: (id: string) => FigmaNodeProxy | null },
  node: FigmaNodeProxy,
  parentId?: string
): void {
  if (!parentId) return
  const parent = figma.getNodeById(parentId)
  if (parent) parent.appendChild(node)
}

export const createRectangle = defineTool({
  name: 'create_rectangle',
  mutates: true,
  description: 'Create a rectangle node with position, size, fill, stroke, and corner radius.',
  params: {
    x: { type: 'number', description: 'X position', required: true },
    y: { type: 'number', description: 'Y position', required: true },
    width: { type: 'number', description: 'Width in pixels', required: true, min: 1 },
    height: { type: 'number', description: 'Height in pixels', required: true, min: 1 },
    name: { type: 'string', description: 'Node name' },
    parent_id: { type: 'string', description: 'Parent node ID to append into' },
    fill: { type: 'color', description: 'Fill color (hex)' },
    stroke: { type: 'color', description: 'Stroke color (hex)' },
    stroke_weight: { type: 'number', description: 'Stroke weight', min: 0 },
    stroke_align: {
      type: 'string',
      description: 'Stroke alignment',
      enum: ['INSIDE', 'CENTER', 'OUTSIDE']
    },
    corner_radius: { type: 'number', description: 'Corner radius', min: 0 }
  },
  execute: (figma, args) => {
    const node: FigmaNodeProxy = figma.createRectangle()
    node.x = args.x
    node.y = args.y
    node.resize(args.width, args.height)
    if (args.name) node.name = args.name
    applyStyle(node, args)
    attachToParent(figma, node, args.parent_id)
    return nodeToResult(node)
  }
})

export const createFrame = defineTool({
  name: 'create_frame',
  mutates: true,
  description:
    'Create a frame node with position, size, fill/stroke, and optional auto-layout. Pass `direction` to enable auto-layout immediately.',
  params: {
    x: { type: 'number', description: 'X position', required: true },
    y: { type: 'number', description: 'Y position', required: true },
    width: { type: 'number', description: 'Width in pixels', required: true, min: 1 },
    height: { type: 'number', description: 'Height in pixels', required: true, min: 1 },
    name: { type: 'string', description: 'Node name' },
    parent_id: { type: 'string', description: 'Parent node ID to append into' },
    fill: { type: 'color', description: 'Fill color (hex)' },
    stroke: { type: 'color', description: 'Stroke color (hex)' },
    stroke_weight: { type: 'number', description: 'Stroke weight', min: 0 },
    corner_radius: { type: 'number', description: 'Corner radius', min: 0 },
    direction: {
      type: 'string',
      description: 'Enable auto-layout in this direction',
      enum: ['HORIZONTAL', 'VERTICAL']
    },
    spacing: { type: 'number', description: 'Gap between children (auto-layout only)', min: 0 },
    padding: { type: 'number', description: 'Equal padding on all sides', min: 0 },
    align: {
      type: 'string',
      description: 'Primary axis alignment (auto-layout only)',
      enum: ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']
    },
    counter_align: {
      type: 'string',
      description: 'Cross axis alignment (auto-layout only)',
      enum: ['MIN', 'CENTER', 'MAX', 'STRETCH']
    }
  },
  execute: (figma, args) => {
    const node: FigmaNodeProxy = figma.createFrame()
    node.x = args.x
    node.y = args.y
    node.resize(args.width, args.height)
    if (args.name) node.name = args.name
    applyStyle(node, args)

    if (args.direction) {
      node.layoutMode = args.direction as 'HORIZONTAL' | 'VERTICAL'
      if (args.spacing !== undefined) node.itemSpacing = args.spacing
      if (args.align !== undefined) node.primaryAxisAlignItems = args.align
      if (args.counter_align !== undefined) node.counterAxisAlignItems = args.counter_align
      if (args.padding !== undefined) {
        node.paddingTop = args.padding
        node.paddingRight = args.padding
        node.paddingBottom = args.padding
        node.paddingLeft = args.padding
      }
    }

    attachToParent(figma, node, args.parent_id)
    return nodeToResult(node)
  }
})

export const createEllipse = defineTool({
  name: 'create_ellipse',
  mutates: true,
  description: 'Create an ellipse node with position, size, fill, and stroke.',
  params: {
    x: { type: 'number', description: 'X position', required: true },
    y: { type: 'number', description: 'Y position', required: true },
    width: { type: 'number', description: 'Width in pixels', required: true, min: 1 },
    height: { type: 'number', description: 'Height in pixels', required: true, min: 1 },
    name: { type: 'string', description: 'Node name' },
    parent_id: { type: 'string', description: 'Parent node ID to append into' },
    fill: { type: 'color', description: 'Fill color (hex)' },
    stroke: { type: 'color', description: 'Stroke color (hex)' },
    stroke_weight: { type: 'number', description: 'Stroke weight', min: 0 },
    stroke_align: {
      type: 'string',
      description: 'Stroke alignment',
      enum: ['INSIDE', 'CENTER', 'OUTSIDE']
    }
  },
  execute: (figma, args) => {
    const node: FigmaNodeProxy = figma.createEllipse()
    node.x = args.x
    node.y = args.y
    node.resize(args.width, args.height)
    if (args.name) node.name = args.name
    applyStyle(node, args)
    attachToParent(figma, node, args.parent_id)
    return nodeToResult(node)
  }
})

export const createTextNode = defineTool({
  name: 'create_text',
  mutates: true,
  description:
    'Create a text node with content, font, and color. Omit width/height to auto-size to content.',
  params: {
    x: { type: 'number', description: 'X position', required: true },
    y: { type: 'number', description: 'Y position', required: true },
    text: { type: 'string', description: 'Text content', required: true },
    width: { type: 'number', description: 'Fixed width (omit to hug content)', min: 1 },
    height: { type: 'number', description: 'Fixed height (omit to hug content)', min: 1 },
    name: { type: 'string', description: 'Node name (defaults to text content)' },
    parent_id: { type: 'string', description: 'Parent node ID to append into' },
    font_size: { type: 'number', description: 'Font size', min: 1 },
    font_family: { type: 'string', description: 'Font family name' },
    font_style: { type: 'string', description: 'Font style (e.g. "Bold", "Regular")' },
    color: { type: 'color', description: 'Text color (hex)' },
    align_horizontal: {
      type: 'string',
      description: 'Horizontal text alignment',
      enum: ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']
    },
    align_vertical: {
      type: 'string',
      description: 'Vertical text alignment',
      enum: ['TOP', 'CENTER', 'BOTTOM']
    }
  },
  execute: (figma, args) => {
    const node: FigmaNodeProxy = figma.createText()
    node.x = args.x
    node.y = args.y
    node.characters = args.text
    node.name = args.name ?? args.text

    if (args.font_size !== undefined) node.fontSize = args.font_size
    if (args.font_family || args.font_style) {
      const current = node.fontName
      node.fontName = {
        family: args.font_family ?? current.family,
        style: args.font_style ?? current.style
      }
    }
    if (args.color) {
      node.fills = [{ type: 'SOLID', color: parseColor(args.color), opacity: 1, visible: true }]
    }
    if (args.align_horizontal) node.textAlignHorizontal = args.align_horizontal
    if (args.align_vertical) node.textAlignVertical = args.align_vertical

    if (args.width !== undefined && args.height !== undefined) {
      node.textAutoResize = 'NONE'
      node.resize(args.width, args.height)
    } else {
      node.textAutoResize = 'WIDTH_AND_HEIGHT'
    }

    attachToParent(figma, node, args.parent_id)
    return nodeToResult(node)
  }
})

export const createPolygon = defineTool({
  name: 'create_polygon',
  mutates: true,
  description: 'Create a regular polygon node (triangle, pentagon, hexagon, ...).',
  params: {
    x: { type: 'number', description: 'X position', required: true },
    y: { type: 'number', description: 'Y position', required: true },
    width: { type: 'number', description: 'Width in pixels', required: true, min: 1 },
    height: { type: 'number', description: 'Height in pixels', required: true, min: 1 },
    point_count: { type: 'number', description: 'Number of sides', required: true, min: 3 },
    name: { type: 'string', description: 'Node name' },
    parent_id: { type: 'string', description: 'Parent node ID to append into' },
    fill: { type: 'color', description: 'Fill color (hex)' },
    stroke: { type: 'color', description: 'Stroke color (hex)' },
    stroke_weight: { type: 'number', description: 'Stroke weight', min: 0 }
  },
  execute: (figma, args) => {
    const node: FigmaNodeProxy = figma.createPolygon()
    node.x = args.x
    node.y = args.y
    node.resize(args.width, args.height)
    if (args.name) node.name = args.name
    applyStyle(node, args)
    figma.graph.updateNode(node.id, { pointCount: args.point_count })
    attachToParent(figma, node, args.parent_id)
    return nodeToResult(node)
  }
})

export const createStar = defineTool({
  name: 'create_star',
  mutates: true,
  description: 'Create a star node with a given number of points and inner radius ratio.',
  params: {
    x: { type: 'number', description: 'X position', required: true },
    y: { type: 'number', description: 'Y position', required: true },
    width: { type: 'number', description: 'Width in pixels', required: true, min: 1 },
    height: { type: 'number', description: 'Height in pixels', required: true, min: 1 },
    point_count: { type: 'number', description: 'Number of star points', required: true, min: 3 },
    inner_radius: {
      type: 'number',
      description: 'Inner radius ratio (0-1, default 0.38)',
      min: 0,
      max: 1
    },
    name: { type: 'string', description: 'Node name' },
    parent_id: { type: 'string', description: 'Parent node ID to append into' },
    fill: { type: 'color', description: 'Fill color (hex)' },
    stroke: { type: 'color', description: 'Stroke color (hex)' },
    stroke_weight: { type: 'number', description: 'Stroke weight', min: 0 }
  },
  execute: (figma, args) => {
    const node: FigmaNodeProxy = figma.createStar()
    node.x = args.x
    node.y = args.y
    node.resize(args.width, args.height)
    if (args.name) node.name = args.name
    applyStyle(node, args)
    figma.graph.updateNode(node.id, {
      pointCount: args.point_count,
      starInnerRadius: args.inner_radius ?? 0.38
    })
    attachToParent(figma, node, args.parent_id)
    return nodeToResult(node)
  }
})

export const createLine = defineTool({
  name: 'create_line',
  mutates: true,
  description: 'Create a straight line node between two points.',
  params: {
    start_x: { type: 'number', description: 'Start X position', required: true },
    start_y: { type: 'number', description: 'Start Y position', required: true },
    end_x: { type: 'number', description: 'End X position', required: true },
    end_y: { type: 'number', description: 'End Y position', required: true },
    name: { type: 'string', description: 'Node name' },
    parent_id: { type: 'string', description: 'Parent node ID to append into' },
    stroke: { type: 'color', description: 'Stroke color (hex)' },
    stroke_weight: { type: 'number', description: 'Stroke weight', default: 1, min: 0.1 },
    stroke_cap: {
      type: 'string',
      description: 'Line end cap style',
      enum: ['NONE', 'ROUND', 'SQUARE', 'ARROW_LINES', 'ARROW_EQUILATERAL']
    },
    dash_pattern: {
      type: 'string',
      description: 'Comma-separated dash/gap lengths, e.g. "4,2"'
    }
  },
  execute: (figma, args) => {
    const dx = args.end_x - args.start_x
    const dy = args.end_y - args.start_y
    const length = Math.hypot(dx, dy)
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI

    const node: FigmaNodeProxy = figma.createLine()
    if (args.name) node.name = args.name
    node.resize(length, 0)
    node.x = args.start_x
    node.y = args.start_y
    node.rotation = angleDeg

    const dashPattern = args.dash_pattern
      ? args.dash_pattern.split(',').map((n) => Number(n.trim()))
      : undefined

    node.strokes = [
      {
        color: parseColor(args.stroke ?? '#000000'),
        weight: args.stroke_weight ?? 1,
        opacity: 1,
        visible: true,
        align: 'CENTER' as const,
        ...(args.stroke_cap
          ? {
              cap: args.stroke_cap as
                | 'NONE'
                | 'ROUND'
                | 'SQUARE'
                | 'ARROW_LINES'
                | 'ARROW_EQUILATERAL'
            }
          : {}),
        ...(dashPattern ? { dashPattern } : {})
      }
    ]

    attachToParent(figma, node, args.parent_id)
    return { ...nodeToResult(node), length, angle: angleDeg }
  }
})
