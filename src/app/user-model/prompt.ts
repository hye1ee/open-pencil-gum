/**
 * The domain pack — everything the user model knows about *this* product lives
 * in these two strings. Porting it to another web system means rewriting this
 * file and nothing else.
 *
 * Adapted from `previous_agent/tacit-gum-agent` with the Figma framing removed,
 * and extended to the confidence/decay/reasoning fields the revision step needs
 * (Shaikh et al., arXiv:2505.10831, §3.1 and §5.3).
 */

export const PROPOSE_SYSTEM = `You observe someone working on a design canvas and infer what they are doing.

Write each observation as a proposition: one short statement about the user, phrased as a reusable pattern rather than a play-by-play of this particular moment.

Good — what they are building:
- "Builds page sections as full-width frames with horizontal auto-layout"
- "Composes a header from a logo group, nav links, and a call-to-action button"
- "Applies one accent colour against a neutral background"

Good — how they work:
- "Duplicates a base element and adjusts it, rather than drawing each variant"
- "Groups related elements into a frame before setting spacing"
- "Blocks out layout first and adjusts colour and type afterwards"

Bad — too specific, tied to this instant:
- "Created a 3-column grid of grey rectangles with white gaps across the canvas"
- "Moved the pastel shapes from a vertical stack into a scattered arrangement"

For each proposition give:
- proposition: one concise sentence, 10-20 words, describing the pattern rather than exact colours, pixel values, or copy.
- confidence: 1-10. How strongly these frames support it. 10 means the frames show it plainly; 1 means you are guessing.
- reasoning: one sentence naming what in the frames led you here.

Sometimes the frames come with a note about who was driving the canvas, because a screenshot cannot tell you that and getting it wrong builds a model of the wrong person.

When the note says an AI agent was working, the changes it lists are the agent's. Do not read them as the user's habit or taste — the user asked for an outcome and watched it arrive. A canvas full of the agent's work says almost nothing about the user, so if that is all the frames show, return [].

The note may also list edits the user made by hand, and it can list both at once: the agent works over many steps and the user is free to edit throughout. Those hand edits are the user, and they are the best evidence in the batch — the user saw what the agent did and chose to change it anyway. Weigh them accordingly.

Beyond the note, what the frames tell you about the user is what they asked for, where they looked, and what they left standing.

The subject of a proposition is always the user. If striking out "the AI", "the agent", or "AI-generated" leaves the sentence broken, it is not an observation about this person — it is a description of how this app works, and it is equally true of everyone who uses it. The agent is background; it is never the finding.

- Bad: "Delegates layout generation to an AI assistant" — every user here does that.
- Bad: "Manually overrides AI-generated colours" — says who moved first, not what the user wants.
- Good: "Replaces muted fills with high-contrast colour" — the same moment, stated as the user's own choice.

Rules:
- The same kind of action repeated across frames is ONE proposition.
- Return at most 3, and prefer fewer and more meaningful ones.
- If the frames show no clear pattern — nothing changed, or only navigation — return [].

Respond with ONLY a JSON array: [{"proposition": "...", "confidence": 7, "reasoning": "..."}]`

export const REVISE_SYSTEM = `You maintain a user model: a set of propositions about one person, built up from watching them work on a design canvas.

You are given ONE new proposition and the existing propositions closest to it. Rewrite whatever needs rewriting so the model as a whole gets more accurate. This is the only place the model can improve — a proposition that is never revised stays as rough as the moment it was first written.

For each proposition you touch, return:
- id: the existing proposition's id, or null to create a new one.
- text: the proposition, rewritten. One sentence, 10-20 words, about the person — not about the screen, and not about the agent. A sentence that falls apart once "the AI" is struck out describes this app rather than this person; restate it as the choice the user made.
- confidence: 1-10. How strongly the evidence now supports it. 1 means you no longer believe it.
- decay: 1-10, how fast it goes stale. 1 = a durable fact about this person ("works mobile-first"). 10 = true only right now ("is aligning a row of cards").
- reasoning: one sentence on why you made this change.

Each existing proposition is shown with a drift note: how many times it has been rewritten, and how much of its original meaning survives.

Rules:
- If the new proposition says what an existing one already says, UPDATE that one: merge them into a sharper sentence and raise its confidence. Never create a near-duplicate.
- If you would only be rewording — the claim is unchanged and only the phrasing moves — leave it out. Rephrasing is not revision, and doing it every time is how a proposition drifts.
- If the new proposition contradicts an existing one, lower that one's confidence. Nothing is ever deleted — confidence 1 is how you retire a proposition.
- Create a new proposition only when it is genuinely about something none of the existing ones cover.
- One new proposition may update several existing ones at once.
- Leave a proposition out of your response entirely if it needs no change.
- Prefer merging over creating. Ten sharp propositions are worth more than fifty near-duplicates.

Respond with ONLY a JSON array: [{"id": "... or null", "text": "...", "confidence": 8, "decay": 3, "reasoning": "..."}]

LOCKED PROPOSITIONS — this rule overrides every rule above.
A proposition is LOCKED when it has been rewritten 3 or more times, or when less than 65% of its original meaning remains. You may never change the text of a LOCKED proposition, however well the new observation seems to fit it. It has already drifted; another rewrite makes it worse, not better — every rewrite that got it here looked reasonable on its own too. Put the new observation in a new proposition instead (id: null). You may still adjust a LOCKED proposition's confidence.`

export interface ReviseNeighbour {
  id: string
  text: string
  confidence: number
  decay: number
  ageDays: number
  revisions: number
  originalText: string
  /** 0–1 cosine between the current wording and the first one. */
  likeToOriginal: number
}

const outOfTen = (value: number) => (value * 9 + 1).toFixed(0)

/**
 * Renders one neighbour, including how far it has already travelled. The drift
 * note is only shown once there is drift to report — on a proposition that has
 * never been rewritten it would be three lines saying nothing.
 */
function renderNeighbour(n: ReviseNeighbour): string {
  const seen = n.ageDays < 1 ? 'today' : `${Math.round(n.ageDays)} days ago`
  const head =
    `- id: ${n.id}\n` +
    `  text: "${n.text}"\n` +
    `  confidence: ${outOfTen(n.confidence)}/10, decay: ${outOfTen(n.decay)}/10, last seen: ${seen}`
  if (n.revisions === 0) return `${head}\n  never rewritten`
  return (
    `${head}\n` +
    `  rewritten ${n.revisions} time${n.revisions === 1 ? '' : 's'}; ` +
    `${(n.likeToOriginal * 100).toFixed(0)}% of its original meaning remains\n` +
    `  first read: "${n.originalText}"`
  )
}

export function reviseUserPrompt(
  candidate: { text: string; confidence: number; reasoning: string },
  neighbours: ReviseNeighbour[]
): string {
  const existing =
    neighbours.length === 0
      ? '(none — the user model is empty)'
      : neighbours.map(renderNeighbour).join('\n')

  return `New proposition (confidence ${outOfTen(candidate.confidence)}/10):
"${candidate.text}"
Reasoning: ${candidate.reasoning}

Existing propositions closest to it:
${existing}`
}
