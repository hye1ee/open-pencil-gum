import { valibotSchema } from '@ai-sdk/valibot'
import { tool } from 'ai'
import * as v from 'valibot'

const targets = v.array(v.object({ id: v.string(), label: v.string() }))

export const CODE_VISUAL_TOOLS = {
  render_code_visual_html: tool({
    description:
      'Render one UI artifact, a continuous spectrum, or a discrete layout, spacing, typography, or palette comparison.',
    inputSchema: valibotSchema(v.object({ html: v.string(), css: v.string(), targets }))
  }),
  render_code_visual_svg: tool({
    description: 'Render a flow, path, spatial relationship, or diagram.',
    inputSchema: valibotSchema(v.object({ svg: v.string(), targets }))
  })
}
