import type { Proposition } from '@/app/user-model/pipeline'

const AT = '2026-01-01T00:00:00.000Z'

const ITEMS = [
  // General design-process preferences
  [
    'Defines the page hierarchy and primary user action before refining decorative styling.',
    0.82,
    ''
  ],
  [
    'Starts with one representative section to establish the visual direction before expanding the full page.',
    0.56,
    ''
  ],
  [
    'Prefers a clear, restrained composition over filling every available area with content.',
    0.76,
    ''
  ],
  [
    'Uses visible contrast and hierarchy rather than lengthy copy to communicate importance.',
    0.64,
    ''
  ],
  [
    'Wants meaningful design alternatives explained when several directions are equally plausible.',
    0.43,
    ''
  ],
  [
    'Prefers reusable components and consistent spacing instead of one-off styling decisions.',
    0.87,
    ''
  ],
  [
    'Treats mobile readability and responsive behavior as part of the initial design rather than later cleanup.',
    0.68,
    ''
  ],
  [
    'Keeps interactive controls accessible with legible type, sufficient contrast, and clear states.',
    0.92,
    ''
  ],
  [
    'Uses imagery only when it adds atmosphere or information that layout and copy cannot convey alone.',
    0.47,
    ''
  ],
  [
    'Prefers concise interface copy with concrete labels and calls to action.',
    0.71,
    ''
  ],
  // Workshop landing-page preferences
  [
    'Designs workshop landing pages for curious beginners rather than assuming expert knowledge.',
    0.61,
    ''
  ],
  [
    'Prefers a warm, energetic workshop identity rather than a formal corporate presentation.',
    0.49,
    ''
  ],
  [
    'Uses a light neutral base with one vivid accent color for workshop landing pages.',
    0.58,
    ''
  ],
  [
    'Makes registration the single dominant call to action and avoids competing primary buttons.',
    0.84,
    ''
  ],
  [
    'Shows the workshop outcome and what participants will make before presenting the detailed schedule.',
    0.73,
    ''
  ],
  [
    'Presents the schedule as a compact sequence that is easy to scan rather than a dense timetable.',
    0.66,
    ''
  ],
  [
    'Uses facilitator credentials and participant work as credibility evidence instead of generic testimonials.',
    0.38,
    ''
  ],
  [
    'Prefers authentic workshop photography over abstract stock illustrations.',
    0.52,
    ''
  ],
  [
    'Keeps essential logistics such as date, location, duration, capacity, and price visible near registration.',
    0.79,
    ''
  ],
  [
    'Uses generous spacing and a clear section rhythm so the workshop page feels inviting rather than crowded.',
    0.63,
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
      reasoning: 'Stable test proposition for controlled user-model update evaluation.',
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
