import type { Proposition } from '@/app/user-model/pipeline'

const AT = '2026-01-01T00:00:00.000Z'

const ITEMS = [
  [
    'Arranges comparable cards in a compact three-column row on wide canvases.',
    0.83,
    ''
  ],
  [
    'Keeps comparable cards equal in width and consistent in their internal information structure.',
    0.89,
    ''
  ],
  [
    'Allows repeated components to hug their content instead of forcing equal height when their content differs.',
    0.67,
    ''
  ],
  [
    'Uses thin borders rather than heavy shadows to separate cards from the canvas.',
    0.74,
    ''
  ],
  [
    'Uses one warm amber accent for the most important action in an interface.',
    0.91,
    ''
  ],
  [
    'Keeps most surfaces and secondary actions visually neutral.',
    0.78,
    ''
  ],
  [
    'Prefers moderately rounded corners over sharp rectangles or highly rounded panels.',
    0.54,
    ''
  ],
  [
    'Avoids gradients and decorative effects on functional interfaces.',
    0.69,
    ''
  ],
  [
    'Presents the important conclusion before supporting details.',
    0.87,
    ''
  ],
  [
    'Prefers everyday language over unexplained professional terminology.',
    0.72,
    ''
  ],
  [
    'Keeps explanations concise without omitting the reason behind a decision.',
    0.85,
    ''
  ],
  [
    'Establishes structure and information hierarchy before refining color and decoration.',
    0.88,
    ''
  ],
  [
    'Prefers seeing a small representative example before expanding work across the full task.',
    0.63,
    ''
  ],
  [
    'Prefers incremental revisions that preserve working parts instead of rebuilding the whole result.',
    0.81,
    ''
  ],
  [
    'Wants the agent to surface consequential assumptions before committing to them.',
    0.76,
    ''
  ],
  [
    'Allows the agent to make minor, reversible decisions without requesting approval.',
    0.58,
    ''
  ],
  [
    'Wants alternatives with similar value explained through their trade-offs rather than presented as an arbitrary binary choice.',
    0.71,
    ''
  ],
  [
    'Does not rely on color alone to communicate an important state or distinction.',
    0.66,
    ''
  ],
  [
    'Prioritizes stable responsive behavior before visual polish.',
    0.43,
    ''
  ],
  [
    'Checks the source and publication date when evaluating information found through web search.',
    0.94,
    ''
  ]
] as const

export const USER_MODEL_FIXTURE: Proposition[] = ITEMS.map(
  ([text, confidence, rationale], index) => {
    return {
      id: `fixture-${index + 1}`,
      text,
      confidence,
      // A deterministic development fixture must remain retrievable regardless
      // of the date on which the scenario is rerun.
      decay: 0,
      reasoning: 'Stable test proposition for feedback-note evaluation.',
      rationale,
      rationaleGrounds: '',
      rationaleFrom: [],
      createdAt: AT,
      updatedAt: AT,
      observations: 1,
      // Hydrated with the configured embedding model when the fixture is loaded.
      // A synthetic vector here silently breaks retrieval as soon as its
      // dimensions differ from the provider's output.
      embedding: [],
      originalText: text,
      originalEmbedding: [],
      revisions: 0
    }
  }
)

export const userModelFixtureEnabled =
  import.meta.env.DEV && import.meta.env.VITE_USER_MODEL_FIXTURE === 'true'
