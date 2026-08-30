import type { StudyCondition, StudyHost } from '@/app/study/runtime'
import type { Proposition } from '@/app/user-model/pipeline'
import { replaceUserModel } from '@/app/user-model/use'

export interface StudyScenarioFixture {
  title: string
  prompt: string
  propositions: Proposition[]
}

const PROPOSITIONS: Record<`${StudyHost}:${StudyCondition}`, readonly string[]> = {
  'lenchat:userlens': [
    'Prefers travel plans organized around neighborhoods rather than a checklist of famous sights.',
    'Enjoys starting travel days slowly with breakfast near the accommodation.',
    'Chooses locally owned restaurants over international chains while traveling.',
    'Wants no more than three major activities scheduled in one day.',
    'Values unstructured time for wandering and unexpected discoveries.',
    'Prefers trains and public transit to rental cars when both are practical.',
    'Avoids changing hotels during trips shorter than one week.',
    'Likes contemporary art museums more than historical artifact museums.',
    'Prioritizes walkable areas when choosing where to stay.',
    'Wants a clear estimated daily budget in travel plans.',
    'Prefers dinner reservations later than 7:30 PM.',
    'Enjoys one scenic outdoor activity on most travel days.',
    'Avoids nightlife centered on clubs or loud bars.',
    'Likes independent bookstores, design shops, and local markets.',
    'Needs vegetarian-friendly choices at every planned meal.',
    'Prefers direct routes even when a slower route is slightly cheaper.',
    'Wants rainy-day alternatives included without duplicating the main itinerary.',
    'Enjoys learning a few useful local phrases before departure.',
    'Prefers compact practical packing lists over exhaustive ones.',
    'Values plans that explain why each recommendation fits the trip.'
  ],
  'lenchat:ask-user': [
    'Usually chooses mild-weather destinations for spring travel.',
    'Is comfortable spending more on centrally located accommodation.',
    'Prefers boutique hotels with distinctive interiors.',
    'Wants travel days to begin before crowds arrive at popular places.',
    'Enjoys food tours when they focus on small local businesses.',
    'Prefers guided experiences only when specialist knowledge adds clear value.',
    'Likes coastal walks but does not enjoy strenuous mountain hikes.',
    'Wants at least one completely unscheduled half-day per trip.',
    'Avoids itineraries that require booking every activity in advance.',
    'Prefers lunch to be the most affordable meal of the day.',
    'Enjoys regional bakeries and coffee culture.',
    'Wants transit instructions written from the traveler’s point of view.',
    'Prefers attractions within a 30-minute journey of the hotel.',
    'Avoids destinations where a car is essential.',
    'Likes small live-music venues with seated performances.',
    'Prefers souvenirs made by local craftspeople.',
    'Needs a quiet private room rather than shared accommodation.',
    'Wants cancellation flexibility called out for expensive bookings.',
    'Prefers recommendations with a specific reason instead of popularity rankings.',
    'Is willing to answer targeted questions when they materially change the itinerary.'
  ],
  'lenchat:user-initiated': [
    'Prefers morning flights so the first travel day remains usable.',
    'Does not want red-eye flights included in recommendations.',
    'Likes to keep total transit time low even if airfare costs slightly more.',
    'Prefers a single home base with optional day trips.',
    'Enjoys architecture walks focused on modern and adaptive-reuse buildings.',
    'Wants landmark visits balanced with ordinary neighborhood experiences.',
    'Avoids restaurants whose main appeal is social-media popularity.',
    'Prefers seasonal regional dishes over tasting menus.',
    'Likes cafes suitable for reading or journaling for an hour.',
    'Wants each day to include a convenient rest stop near the hotel.',
    'Prefers travel plans that clearly label optional activities.',
    'Does not want shopping malls included as destinations.',
    'Enjoys botanical gardens and well-designed public parks.',
    'Prefers self-guided exploration supported by concise historical context.',
    'Wants accessibility and walking difficulty noted for each day.',
    'Carries light luggage and prefers doing laundry during longer trips.',
    'Avoids tight connections between intercity trains or flights.',
    'Prefers costs shown in both local currency and an approximate home-currency total.',
    'Likes one memorable splurge meal rather than several expensive dinners.',
    'Wants to be able to correct the planner’s assumptions during the planning process.'
  ],
  'lenchat:hands-off': [
    'Prefers long weekends built around one city rather than multi-stop routes.',
    'Wants the first day kept light to absorb arrival fatigue.',
    'Chooses accommodation with easy access to a metro or tram line.',
    'Prefers markets and food halls for casual lunches.',
    'Enjoys viewpoints reached by a short walk more than paid observation decks.',
    'Wants museum visits limited to one per day.',
    'Prefers plans that name specific places instead of generic categories.',
    'Avoids activities that require standing in long ticket lines.',
    'Likes waterfront or riverside evening walks.',
    'Wants a coffee stop suggested for every morning.',
    'Prefers dinner spots within walking distance of the accommodation.',
    'Enjoys neighborhoods known for independent shops and studios.',
    'Wants backup indoor options listed for weather-dependent days.',
    'Prefers a printed-style day summary with times and locations.',
    'Avoids organized group tours larger than ten people.',
    'Likes trying one regional specialty dish per destination.',
    'Wants total daily walking distance kept under ten kilometers.',
    'Prefers paying with card and avoids cash-only venues when possible.',
    'Enjoys a mid-afternoon break built into each day.',
    'Wants the plan to state which bookings must be made in advance.'
  ],
  'lencanvas:userlens': [
    'Prefers UI components with a quiet neutral palette and one purposeful accent color.',
    'Uses an 8-point spacing system for component layout.',
    'Prefers medium corner radii over fully rounded containers.',
    'Wants the primary action visually dominant without oversized treatment.',
    'Uses concise sentence-case labels in interfaces.',
    'Prefers borders and spacing over heavy shadows for separation.',
    'Wants all interactive states to remain legible at a glance.',
    'Prefers 14-pixel body text for compact desktop components.',
    'Uses icons only when they improve scanning or recognition.',
    'Wants destructive actions separated from routine actions.',
    'Prefers content density appropriate for productivity tools.',
    'Uses muted helper text rather than tooltips for essential guidance.',
    'Wants keyboard focus states visible but visually restrained.',
    'Prefers controls aligned to a consistent vertical rhythm.',
    'Avoids decorative gradients in functional UI components.',
    'Wants disabled states distinguishable without relying only on opacity.',
    'Prefers reusable variants over one-off visual exceptions.',
    'Uses whitespace to group related controls before adding dividers.',
    'Wants the component to work at narrow widths without hiding core actions.',
    'Prefers realistic sample content that demonstrates edge cases.'
  ],
  'lencanvas:ask-user': [
    'Prefers card components with clearly separated header, body, and action regions.',
    'Usually places secondary actions before the primary action in horizontal action rows.',
    'Likes cool gray surfaces paired with a blue action color.',
    'Prefers 12-pixel corner radii for standalone cards.',
    'Wants card titles short enough to stay on one line.',
    'Uses a small eyebrow label only when category context is useful.',
    'Prefers status badges with both text and color cues.',
    'Wants metadata grouped in a single scannable row.',
    'Avoids more than two buttons in a compact card footer.',
    'Prefers outline icons with consistent stroke weight.',
    'Wants loading states to preserve the component’s dimensions.',
    'Prefers inline validation messages next to the affected control.',
    'Uses subtle hover elevation only on genuinely clickable cards.',
    'Wants long descriptions clamped with an explicit expansion affordance.',
    'Prefers avatars at 32 pixels in compact components.',
    'Wants touch targets to remain at least 40 pixels high.',
    'Prefers action labels that state the outcome rather than generic confirmation.',
    'Uses separators only between independently scannable groups.',
    'Wants dark text contrast maintained on tinted backgrounds.',
    'Is comfortable answering a small number of design questions before implementation.'
  ],
  'lencanvas:user-initiated': [
    'Prefers settings components that expose common choices before advanced options.',
    'Wants toggles used only for changes that take effect immediately.',
    'Prefers radio groups when one choice must be made among a few options.',
    'Uses select menus only when the option list is too long to scan inline.',
    'Wants irreversible choices to include a brief consequence statement.',
    'Prefers left-aligned form labels above their controls.',
    'Uses 16-pixel section gaps inside compact settings panels.',
    'Wants saved state acknowledged with a small non-blocking message.',
    'Prefers explicit Save and Cancel actions when edits are staged.',
    'Avoids placeholder text as the only form instruction.',
    'Wants error copy to explain how to recover, not merely what failed.',
    'Prefers advanced controls collapsed by default.',
    'Uses monospace text only for technical identifiers or code values.',
    'Wants selected states reinforced with more than color alone.',
    'Prefers compact controls while retaining comfortable hit targets.',
    'Wants related settings described with a short group-level explanation.',
    'Avoids modal dialogs for settings that fit comfortably inline.',
    'Prefers previewing visual changes before committing them.',
    'Wants reset actions scoped to a section rather than the entire product.',
    'Likes to annotate and correct the design agent’s reasoning when a decision misses context.'
  ],
  'lencanvas:hands-off': [
    'Prefers landing sections with a single clear headline and one supporting line.',
    'Wants the primary call-to-action visible without scrolling.',
    'Uses warm off-white backgrounds instead of pure white for marketing surfaces.',
    'Prefers one display typeface paired with a neutral body typeface.',
    'Wants imagery that shows the activity rather than abstract decoration.',
    'Prefers generous vertical spacing between page sections.',
    'Uses at most two font sizes within a hero section.',
    'Wants event details grouped into a compact schedule block.',
    'Prefers rounded rectangular buttons with sentence-case labels.',
    'Avoids full-width text lines longer than seventy characters.',
    'Wants pricing presented plainly without countdown urgency devices.',
    'Prefers testimonials attributed with a name and a short descriptor.',
    'Uses a soft accent color drawn from the page imagery.',
    'Wants section headings to describe content rather than tease it.',
    'Prefers a short three-step overview of how to participate.',
    'Avoids autoplaying or animated backgrounds on informational pages.',
    'Wants contact and location details repeated near the final call-to-action.',
    'Prefers icons only in the benefits or feature list.',
    'Wants the footer kept minimal with essential links only.',
    'Prefers layouts that survive at tablet width without redesign.'
  ]
}

const PROMPTS: Record<`${StudyHost}:${StudyCondition}`, string> = {
  'lenchat:userlens': 'Plan a 5-day trip to Lisbon for me.',
  'lenchat:ask-user': 'Plan a 5-day trip to Copenhagen for me.',
  'lenchat:user-initiated': 'Plan a 5-day trip to Barcelona for me.',
  'lenchat:hands-off': 'Plan a 3-day trip to Porto for me.',
  'lencanvas:userlens': 'Create a notification settings card component.',
  'lencanvas:ask-user': 'Create a project summary card component.',
  'lencanvas:user-initiated': 'Create an account privacy settings component.',
  'lencanvas:hands-off': 'Create a landing page hero section for a weekend pottery workshop.'
}

function makePropositions(key: `${StudyHost}:${StudyCondition}`): Proposition[] {
  const at = new Date().toISOString()
  return PROPOSITIONS[key].map((text, index) => ({
    id: `study-${key.replace(':', '-')}-${index + 1}`,
    text,
    confidence: 0.78,
    decay: 0,
    reasoning: `Seeded for the ${key} controlled study scenario.`,
    rationale: 'A controlled starting preference for comparing study conditions.',
    rationaleGrounds: 'Temporary study scenario fixture.',
    rationaleFrom: [],
    createdAt: at,
    updatedAt: at,
    observations: 1,
    embedding: [],
    originalText: text,
    originalEmbedding: [],
    revisions: 0
  }))
}

export function studyScenarioFixture(
  host: StudyHost,
  condition: StudyCondition
): StudyScenarioFixture {
  const key = `${host}:${condition}` as const
  return {
    title: `${host === 'lenchat' ? 'LenChat' : 'LenCanvas'} · ${condition}`,
    prompt: PROMPTS[key],
    propositions: makePropositions(key)
  }
}

export async function seedStudyUserModel(fixture: StudyScenarioFixture): Promise<void> {
  await replaceUserModel(fixture.propositions)
}
