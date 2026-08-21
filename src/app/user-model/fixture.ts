import type { Proposition } from '@/app/user-model/pipeline'

const AT = '2026-01-01T00:00:00.000Z'

const ITEMS = [
  ['Map the order, dependencies, and groups in a workflow before acting.', 0.9],
  ['Evaluate visual choices through rendered color, spacing, and proportion.', 0.88],
  ['Explore ambiguous goals through concrete scenarios or metaphors.', 0.86],
  ['Favor dense information layouts with compact spacing.', 0.84],
  ['Avoid blue and purple accents; use one warm amber accent.', 0.87],
  ['Prefer top navigation over a persistent sidebar.', 0.85],
  ['Use explicit text labels rather than icon-only controls.', 0.8],
  ['Use monospace typography for metadata and system information.', 0.78],
  ['Keep imagery secondary and let textual content dominate.', 0.76],
  ['Keep advanced controls visible instead of hiding them progressively.', 0.74]
] as const

export const USER_MODEL_FIXTURE: Proposition[] = ITEMS.map(([text, confidence], index) => {
  const embedding = ITEMS.map((_, embeddingIndex) => (embeddingIndex === index ? 1 : 0))
  return {
    id: `fixture-${index + 1}`,
    text,
    confidence,
    decay: 0.2,
    reasoning: 'Stable test proposition for feedback-note evaluation.',
    rationale: 'Loaded from the deterministic development fixture.',
    rationaleGrounds: 'Development fixture',
    rationaleFrom: [],
    createdAt: AT,
    updatedAt: AT,
    observations: 1,
    embedding,
    originalText: text,
    originalEmbedding: [...embedding],
    revisions: 0
  }
})

export const userModelFixtureEnabled =
  import.meta.env.DEV && import.meta.env.VITE_USER_MODEL_FIXTURE === 'true'
