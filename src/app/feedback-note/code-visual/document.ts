import type { CodeVisualArtifact, CodeVisualTarget } from '@/app/feedback-note/types'

const SIZE_BRIDGE_SOURCE = 'feedback-note-code-visual-size'

function sizingScript(noteId: string, format: CodeVisualArtifact['format']): string {
  const config = JSON.stringify({ noteId, format }).replaceAll('<', '\\u003c')
  return `<script>(()=>{const config=${config};const report=()=>{const target=config.format==='html'?document.querySelector('.code-visual-root'):document.querySelector('svg');if(!target)return;const width=config.format==='svg'?(target.viewBox?.baseVal?.width||720):720;const height=config.format==='svg'?(target.viewBox?.baseVal?.height||1):Math.max(1,Math.ceil(target.getBoundingClientRect().height),target.scrollHeight);window.parent.postMessage({source:'${SIZE_BRIDGE_SOURCE}',noteId:config.noteId,width,height},'*')};const target=config.format==='html'?document.querySelector('.code-visual-root'):document.querySelector('svg');if(target)new ResizeObserver(report).observe(target);[0,50,200,500,1000,2000].forEach(delay=>setTimeout(report,delay))})();</script>`
}

export function buildInteractiveCodeVisualDocument(input: {
  format: CodeVisualArtifact['format']
  content: string
  noteId: string
  targets: CodeVisualTarget[]
}): string {
  void input.targets
  const script = sizingScript(input.noteId, input.format)
  if (input.format === 'html') {
    return input.content.replace('</body>', `${script}</body>`)
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}svg{display:block;width:100%;height:auto;max-width:100%}</style></head><body>${input.content}${script}</body></html>`
}

export const CODE_VISUAL_SIZE_BRIDGE_SOURCE = SIZE_BRIDGE_SOURCE
