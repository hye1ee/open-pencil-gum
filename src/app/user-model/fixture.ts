import type { Proposition } from '@/app/user-model/pipeline'

const AT = '2026-01-01T00:00:00.000Z'

const ITEMS = [
  [
    'Uses one warm amber accent while keeping secondary and tertiary controls neutral.',
    0.87,
    'Concentrating color on one control makes the primary action immediately identifiable.'
  ],
  [
    'Keeps button hierarchy explicit with a filled primary, outlined secondary, and text-only tertiary style.',
    0.86,
    'Distinct treatments let people compare action importance without reading every label first.'
  ],
  [
    'Uses concise explicit action labels rather than icon-only buttons.',
    0.82,
    'Text labels make each action understandable without requiring familiarity with an icon.'
  ],
  [
    'Arranges related button variants in a compact horizontal row.',
    0.78,
    'Placing variants together makes their hierarchy and differences easier to compare.'
  ],
  [
    'Prefers moderately rounded button corners over pill shapes or sharp rectangles.',
    0.75,
    'Moderate rounding keeps controls approachable without making them resemble tags or chips.'
  ],
  [
    'Avoids gradients and decorative shadows on functional controls.',
    0.72,
    'Simple surfaces keep button states visually stable and easy to distinguish.'
  ],
  [
    'Keeps button padding generous enough to create comfortable interaction targets.',
    0.76,
    'Comfortable targets reduce accidental activation without making the control visually oversized.'
  ]
] as const

export const USER_MODEL_FIXTURE: Proposition[] = ITEMS.map(
  ([text, confidence, rationale], index) => {
    const embedding = ITEMS.map((_, embeddingIndex) => (embeddingIndex === index ? 1 : 0))
    return {
      id: `fixture-${index + 1}`,
      text,
      confidence,
      decay: 0.2,
      reasoning: 'Stable test proposition for feedback-note evaluation.',
      rationale,
      rationaleGrounds: 'Seeded test rationale for the three-button feedback scenario.',
      rationaleFrom: [],
      createdAt: AT,
      updatedAt: AT,
      observations: 1,
      embedding,
      originalText: text,
      originalEmbedding: [...embedding],
      revisions: 0
    }
  }
)

export const userModelFixtureEnabled =
  import.meta.env.DEV && import.meta.env.VITE_USER_MODEL_FIXTURE === 'true'
