import type { Proposition } from '@/app/user-model/pipeline'

const AT = '2026-01-01T00:00:00.000Z'

const ITEMS = [
  // General travel preferences
  [
    'Balances well-known highlights with local neighborhoods and everyday experiences.',
    0.86,
    ''
  ],
  [
    'Groups activities by geographic area to avoid unnecessary backtracking.',
    0.94,
    ''
  ],
  [
    'Uses realistic travel times and recently updated operating information when planning a route.',
    0.91,
    ''
  ],
  [
    'Limits each half-day to one major anchor activity with nearby supporting stops.',
    0.72,
    ''
  ],
  [
    'Leaves buffer time for meals, queues, transit delays, and spontaneous discoveries.',
    0.83,
    ''
  ],
  [
    'Prefers a concise itinerary overview followed by optional practical details.',
    0.67,
    ''
  ],
  [
    'Wants important route, cost, and activity trade-offs explained instead of receiving only a list of places.',
    0.88,
    ''
  ],
  [
    'Wants affordable alternatives shown alongside higher-cost attractions or experiences.',
    0.7,
    ''
  ],
  [
    'Prefers walking and public transit when they are practical, but accepts taxis when they materially simplify the route.',
    0.61,
    ''
  ],
  [
    'Includes an indoor or weather-safe alternative for outdoor-heavy itinerary blocks.',
    0.56,
    ''
  ],
  // Daejeon-specific preferences
  [
    'Wants a Daejeon trip to reflect the city’s science and technology identity rather than resemble a generic city itinerary.',
    0.9,
    ''
  ],
  [
    'Treats the National Science Museum, Expo Science Park, Expo Bridge, and Hanbat Arboretum as one connected itinerary area.',
    0.93,
    ''
  ],
  [
    'Includes Seongsimdang as one purposeful food stop without repeatedly building the itinerary around bakery queues.',
    0.78,
    ''
  ],
  [
    'Wants representative Daejeon foods such as kalguksu and dubuchigi considered alongside famous bakery items.',
    0.65,
    ''
  ],
  [
    'Prefers using the Yuseong hot spring area as a slower evening or recovery block rather than a rushed daytime stop.',
    0.59,
    ''
  ],
  [
    'Groups Daejeon Station, Jungang Market, and the Jungang-ro or Euneungjeongi area into the same downtown route.',
    0.81,
    ''
  ],
  [
    'Wants at least one place that communicates Daejeon’s history or local character beyond its modern science attractions.',
    0.53,
    ''
  ],
  [
    'Pairs Hanbat Arboretum with a nearby indoor science or cultural option so the day remains useful in bad weather.',
    0.74,
    ''
  ],
  [
    'Avoids distant regional detours outside Daejeon unless they offer a clear benefit over attractions within the city.',
    0.47,
    ''
  ],
  [
    'Prefers the final day to finish near Daejeon Station when departing by train.',
    0.69,
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
