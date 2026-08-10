/**
 * The user model's propositions, written out for the agents that build rather
 * than the one that judges.
 *
 * The judge has had this list since the meta-agent existed; the design agent
 * never did. So the judge knew a decision would go against this person while the
 * agent making that decision had no idea, and the marker only ever arrived after
 * the fact. This is the same list, addressed to the side that can still act on
 * it.
 *
 * Deliberately not the judge's rendering. That one carries proposition ids so a
 * mark can cite one; nothing here cites anything, and an id in text a person may
 * end up reading is noise.
 */

/** The fields this needs. `Proposition` from either half of the app fits. */
export interface UserModelProposition {
  text: string
  confidence: number
  rationale: string | null
}

/** Stored 0–1 like every other confidence here, shown out of ten. */
function outOfTen(confidence: number): string {
  return (confidence * 9 + 1).toFixed(0)
}

const HEADER = `# What we have observed about this person

You are building for one particular person. The list below is what we have
noticed about how they work — gathered from their canvas over earlier sessions,
and from what they said on the occasions they disagreed with something an agent
was about to do. These are observations, not instructions.

Each line is one observation. The number after it is how much evidence stands
behind it, out of ten. A low number means we have seen it once, or have seen it
fail since; it is weak evidence, not an instruction to do the opposite. A
\`why:\` line is our reading of what that preference gets them — use it when the
observation itself does not settle the case in front of you.

What to do with it:

- **What they asked for wins.** When the request goes against an observation, do
  what was asked. The list describes other days; the request describes this one.
- **Use it on the choices the request leaves open.** Most of a build is decided
  by nobody — spacing, whether a section opens with a heading, how many accent
  colours there are. Those are the decisions this list is for.
- **Where the list is silent, decide as you otherwise would.** Do not stretch an
  observation to cover a decision it does not speak to.
- **Do not talk about it.** Do not mention the observations, do not explain that
  you are following one, and do not ask them to confirm one. This is background
  you were handed, not a subject to raise.`

/**
 * `null` when there is nothing to say, so the caller can leave the block out
 * entirely. A heading followed by an empty list spends tokens telling the agent
 * that we know nothing, which it can assume.
 */
export function renderUserModelPropositions(
  propositions: readonly UserModelProposition[]
): string | null {
  if (propositions.length === 0) return null
  const lines = propositions.map((proposition) => {
    const head = `- ${proposition.text} (${outOfTen(proposition.confidence)}/10)`
    // Only where there is one. A "why: —" under every line is a column of
    // dashes, and this list goes into a prompt that is cached and re-sent.
    return proposition.rationale === null ? head : `${head}\n    why: ${proposition.rationale}`
  })
  return `${HEADER}\n\n${lines.join('\n')}`
}
