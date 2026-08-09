/**
 * The domain pack — everything the user model knows about *this* product lives
 * in these two strings. Porting it to another web system means rewriting this
 * file and nothing else.
 *
 * Adapted from `previous_agent/tacit-gum-agent` with the Figma framing removed,
 * and extended to the confidence/decay/reasoning fields the revision step needs
 * (Shaikh et al., arXiv:2505.10831, §3.1 and §5.3).
 */

export const PROPOSE_SYSTEM = `TASK

Read a series of screenshots of someone working on a design canvas, and infer what they are doing.

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

The subject of a proposition is always the user. If striking out "the AI", "the agent", or "AI-generated" leaves the sentence broken, it is not an observation about this person — it is a description of how this app works, and it is equally true of everyone who uses it.

- Bad: "Delegates layout generation to an AI assistant" — every user here does that.
- Bad: "Manually overrides AI-generated colours" — says who moved first, not what the user wants.
- Good: "Replaces muted fills with high-contrast colour" — the same moment, stated as the user's own choice.

Rules:
- The same kind of action repeated across frames is ONE proposition.
- Return at most 3, and prefer fewer and more meaningful ones.
- If the frames show no clear pattern — nothing changed, or only navigation — return [].

Respond with ONLY a JSON array: [{"proposition": "...", "confidence": 7, "reasoning": "..."}]`

export const REVISE_SYSTEM = `TASK

Fold one new observation into a user model: a set of propositions about one person, built up from watching them work on a design canvas.

You are given ONE new proposition and the existing propositions closest to it. Rewrite whatever needs rewriting so the model as a whole gets more accurate. This is the only place the model can improve — a proposition that is never revised stays as rough as the moment it was first written.

THE SUBJECT IS ALWAYS THE USER

A proposition is written without its subject, because the subject never changes. Before you send one, put "The user" in front of it and read it back. If it becomes false, it is not a proposition — it is a description of what happened on screen.

  "The user leads a product card with its price, placed above the product name."
      True. Keep it.
  "The user sets headers and rows to horizontally fill their parent containers."
      False. The agent did that; the person only saw it happen.

Read the second line without its subject — "Sets headers and rows to fill…" — and it sounds correct. Nothing in it shows that it is about the wrong party. That is why the subject has to be written out and checked.

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
  cosineToOriginalText: number
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
    `${(n.cosineToOriginalText * 100).toFixed(0)}% of its original meaning remains\n` +
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

export const FEEDBACK_SYSTEM = `TASK

Update a user model from the feedback a person just gave. A user model is a set of propositions about one person, built up from watching them work on a design canvas with an AI agent. Each proposition says something they prefer, and carries a confidence.

The evidence this time is not a screenshot. While the agent was working, notes appeared beside the canvas. Each note said what the agent was about to do next. A note either rested on one of our propositions — we thought the agent was about to go against something we believe about this person — or rested on nothing, because no proposition covered what the agent was doing. The person typed an answer to some notes and left the rest alone.

You are given, for each note: the words they read on screen, the agent's own sentence those words came from, which proposition it rested on (or none), and their answer (or that they left it alone).

You change confidences and write new propositions. You do not need to work out which proposition a note was about — the note says so.

WHAT EACH NOTE TELLS YOU

A note that rested on a proposition was a warning about that proposition.

- They answered it. Their words are the strongest evidence this system ever gets, because they said it rather than you reading it off a picture.
- They left it alone. The agent went ahead and they were content with the result. The proposition the note rested on is the thing that just turned out to be wrong. Do not raise its confidence: it is the sentence they watched the agent break and did not object to.

A note that rested on nothing was raised where the model had nothing to say. Whatever they did with it is the first thing we know about that subject.

An answer is stronger evidence than silence, because someone who says nothing may have agreed or may not have looked. So a proposition supported only by silence goes in at 5 confidence or below. It still goes in — nothing else in this system asks this person anything, so silence is most of the evidence there is.

A FAILED PROPOSITION USUALLY MEANS TWO CHANGES

Lowering the old proposition records that we were wrong. It does not record what is true instead, which is the more useful of the two. So also ask what they turned out to be fine with, and write that down as a new proposition.

  Note shown:  "reaching for an indigo button · you keep to neutral tones"   (rested on "mono")
  They said nothing, the agent used indigo, and they were content.

  Not enough:  lower "mono" and stop.
               We now believe less than before and know nothing more.
  Better:      lower "mono", and add "Accepts a saturated colour on the primary action".
               The second sentence is the thing that was actually observed.

DO NOT REWRITE A PROPOSITION THAT IS ALREADY IN THE MODEL

The second change above is always a new proposition, never a rewrite of the old one. On a proposition already in the model, the only thing you change is its confidence.

The reason is that the wording is what the note was raised against. Rewriting a proposition that just failed removes the exact clause it failed on, and usually removes another clause that nothing was observed about at all. This happened here: "near-monochrome greys with one warm accent, never a default blue or indigo" was rewritten to "near-monochrome with one warm accent" on the evidence of a warm gradient. No indigo had appeared anywhere. The clause about indigo was deleted with no evidence against it, and after that nothing in the system could ever notice indigo again.

Everything you learn goes into new propositions instead — as many as the evidence supports. One note may lower two propositions and add three.

WRITING A NEW PROPOSITION

The subject is always the user, and it is left off the sentence because it never changes. Before you send a proposition, put "The user" in front of it and read it back. If it becomes false, what you have written is a description of what the agent did, not a proposition about this person.

  "The user prefers gradient fills for placeholders over stock photography."
      True. Keep it.
  "The user uses semi-transparent product icons inside image placeholders."
      False. The agent did that; the person only saw it happen.
  "The user accepts semi-transparent product icons inside image placeholders."
      True. Same evidence as the line above, stated as what was actually observed.

Read the second line without its subject — "Uses semi-transparent product icons…" — and it sounds like a correct sentence. Nothing in it shows that it is about the wrong party. That is why the subject has to be written out and checked. It matters most in this task, because most of your evidence is that the agent did something and the person did not stop it. What that tells you is what they will accept, not what they do.

A PROPOSITION SAYS WHAT, NEVER WHY

Each proposition carries a separate rationale, written by a later step, that says what the preference is for. Do not put a reason in the sentence itself.

  Bad:  "Prefers to start design sections without headers initially to maintain workflow efficiency"
        The clause after "to" is a rationale. It belongs in the rationale field, and
        this task does not write that field.
  Good: "Begins a section with its content rather than a heading announcing it"

WRITE A NEW PROPOSITION ONLY WHEN IT SAYS SOMETHING NEW

The wording of existing propositions is fixed, so a new proposition is the only way you can record anything. That makes it easy to record the same thing repeatedly. One build produced these three:

  "Prefers compact, narrow product cards that leave empty space in a row rather than stretching to fill the width."
  "Accepts a fixed, standard card width rather than cards stretching to fill the container width."
  "Accepts standard-width product cards that do not dynamically stretch to fill the available container width."

That is one observation written three times, and the model is worse for having all three: whatever reads it next has to work out that they are the same claim, and each one dilutes the confidence the single sentence would have carried.

Two propositions are the same claim when they would be confirmed and broken by the same events, whatever words they use. These two share not one content word and are the same claim:

  "Begins a section with its content rather than a heading announcing it."
  "Begins page sections directly with content rather than an introductory heading."

Do not check whether the sentences look alike. Ask what would have to happen for each to be wrong, and if the answer is the same thing, it is the same claim.

So before writing a new proposition, look through the model for one that already makes the same claim. If it is there:
  - the claim agrees with it → raise its confidence and write nothing new.
  - the claim goes against it → lower its confidence, and write the new one. This pair is the record: here is what we believed, and here is what we then watched them accept. Only a contradiction earns a second sentence.
  - the claim is the same but more specific → still nothing new. A sharper wording is not available to you, and a second sentence is not a substitute for one.

Two more requirements:

- One sentence, 10-20 words, about the person. Not about the screen and not about the agent.
- Do not put an exact value in a proposition. If they ask for 16px corners, what you learned is that they want corners noticeably rounded, not that 16 is their number. A proposition holding an exact value is satisfied the moment the agent uses that value and stops saying anything about the person — it has become a setting. The same applies to a colour, a font, or a phrase they typed.

    They said: "no, round the image corners more, 16px"
    Bad:  "Prefers a pronounced 16px corner rounding on images"
          Only true of one number. Says nothing once the agent uses 16.
    Good: "Rounds image corners noticeably rather than keeping them square"
          Still applies at 12 or at 24, so it can be checked again next time.

RETURN FORMAT

For each proposition you change, return:
- id: the existing proposition's id, or null to create a new one.
- text: for a new proposition, the sentence. For one already in the model, repeat its existing text back unchanged — the wording is fixed, and only the confidence is read.
- confidence: 1-10. How strongly the evidence now supports it. 1 means you no longer believe it.
- decay: 1-10, how fast it goes stale. 1 = a durable fact about this person. 10 = true only right now.
- reasoning: one sentence on why you made this change.

Rules:
- Work through every note, answered and left-alone alike. The answered notes are easy to notice and easy to handle on their own; the rest are the other half of the same feedback.
- Leave a proposition out of your response entirely if it needs no change.
- Nothing is ever deleted. Confidence 1 is how a proposition retires.

Respond with ONLY a JSON array: [{"id": "... or null", "text": "...", "confidence": 8, "decay": 3, "reasoning": "..."}]`

/** One note as the person saw it, plus the evidence it was built from. */
export interface FeedbackNoteView {
  note: string
  quote: string
  citedId: string | null
  reply: string | null
}

function renderNote(note: FeedbackNoteView, index: number): string {
  const rests =
    note.citedId === null
      ? '  rested on: nothing — no proposition covered this'
      : `  rested on: ${note.citedId}`
  const answer =
    note.reply === null ? '  they said nothing and let it stand' : `  they replied: "${note.reply}"`
  return (
    `${index + 1}. shown to them: "${note.note}"\n` +
    `  read off the agent's words: "${note.quote}"\n` +
    `${rests}\n${answer}`
  )
}

export function feedbackUserPrompt(
  notes: FeedbackNoteView[],
  propositions: ReviseNeighbour[]
): string {
  const held =
    propositions.length === 0
      ? '(none — the user model is empty)'
      : propositions.map(renderNeighbour).join('\n')

  return `The propositions these notes touch:
${held}

The notes shown during this build:
${notes.map(renderNote).join('\n\n')}`
}

export const RATIONALE_SYSTEM = `TASK

From the feedback a person just gave, infer the rationale behind the propositions in a user model. A proposition says what this person prefers. Its rationale says what that preference does for them.

  proposition:  The user prefers compact layouts.
  rationale:    Compact layouts let them compare more information at once.

This is what the feedback looks like. While an AI agent was building something on a design canvas, notes appeared beside the canvas. Each note said what the agent was about to do next, and where that went against something the user model already believes about this person. They typed an answer to some of those notes and left the rest alone. Both are feedback. This is the only information this system gets from the person directly.

The feedback on its own is usually not enough to see a purpose in. So you are also given the propositions already in the model. Put several of them beside this feedback and the goal they have all been serving becomes visible. That goal is the rationale.

Writing and rewriting rationales is the whole of this task. Changing a proposition is not part of it — neither its wording nor its confidence.

WHAT YOU ARE GIVEN

1. THIS FEEDBACK. For each note: the words the person read on screen, the agent's own sentence those words were drawn from, which proposition the note rested on (or none), and their answer (or that they left it alone).

2. WHAT THIS FEEDBACK JUST CHANGED. Propositions whose confidence went up or down, and propositions newly written, with the reason recorded for each. Read this before writing any rationale, because the same note leads to different conclusions depending on what it did:
   - confidence fell sharply → the preference the proposition describes may itself be wrong.
   - confidence held and a new proposition was added → the preference is right, and one case where it does not apply has been found. The rationale is what should explain that case.

3. EVERY PROPOSITION IN THE MODEL SO FAR. Each with its wording, its confidence, how many times it has been observed, and its rationale if it already has one.

WHAT COUNTS AS A RATIONALE

A rationale explains why the person does this. Restating the proposition in different words is not a rationale.

The test: ask "why?" of the proposition, and see whether the rationale answers it.

  proposition:  Works in near-monochrome greys with one warm accent.

  Not a rationale:  They like muted colours.
                    This is "uses muted colours" rewritten as "likes muted colours".
                    If the answer to "why?" is "because they like it", nothing has
                    been explained.

  A rationale:      Colour is spent on one thing at a time, so that it still means something.
                    "Why near-monochrome?" — because colour has to be saved to carry
                    meaning. That is not in the proposition, and it says what this
                    person is trying to achieve.

A proposition that already has a rationale can be rewritten. If this feedback shows the existing one was too broad, narrow it; if it shows it was wrong, replace it.

A RATIONALE SAYS WHY ITS OWN PROPOSITION IS TRUE

Never why it is false. When a proposition has just been disproved it is tempting to record that in its rationale, and the result is a sentence that argues against the sentence above it. Both of these were produced that way:

  proposition:  Leads a product card with its price, placed above the product name.
  rationale:    They do not require price to be prioritized over product names.
                The rationale contradicts the proposition. Anything reading this pair
                afterwards has no way to know which half we believe.

  proposition:  Works in near-monochrome greys with one warm accent, never a default blue or indigo.
  rationale:    They are open to gradients rather than keeping the interface strictly monochrome.
                Same fault. What was learned belongs on the proposition that records it.

So leave the disproved proposition's rationale alone. Section 2 will have listed a new proposition holding what was actually observed — write the rationale there instead.

ONE RATIONALE PER CLAIM

If you find yourself writing the same rationale on two propositions, they are almost certainly the same claim written twice. Put it on the one with the higher confidence and leave the other out. Two propositions that each cite the other as what you read them against explain nothing: the reasoning has nowhere outside the pair to rest on.

THE RATIONALE HAS TO STAY INSIDE WHAT WAS OBSERVED

You know a great deal about why designs are built the way they are. Almost none of it was observed about this person, and a rationale that reaches for it produces a sentence that sounds informed and is not evidence.

  They replied:  "I think the title is more important info for the user"
  Too far:       An expected information hierarchy helps users quickly identify what they
                 are looking at before assessing its cost.
                 Nobody said anything about identification, or about cost being assessed
                 second. This is general design knowledge attributed to one person.
  In range:      What the thing is matters more to them than what it costs.
                 Nothing here that they did not say.

The test is the grounds you are about to write. If the grounds cannot carry the rationale — if the rationale contains a claim the note and the propositions do not support — cut the rationale back until it can. A short rationale that is entirely evidence is worth more than a full paragraph of plausible design reasoning, because the next thing that reads this model will treat every sentence in it as something we know.

UPDATE SEVERAL PROPOSITIONS FROM ONE PIECE OF FEEDBACK

This is why you are given the whole model rather than only the propositions the notes touched.

A reaction in one place is often the same reason that several other propositions have been following all along. So find every proposition this feedback bears on and write a rationale for each. Propositions no note rested on are included.

The information this system gets from the person is very small: one build produces a few notes and most of them have no answer. Take each one as far as you can ground it. Five rationales from one note is a good result, if you can ground all five.

SUBMIT THE GROUNDS WITH IT

Every rationale you write comes with its grounds, which are two things:
  - which note in this feedback it rests on
  - which propositions you read that note against to arrive at it

Name propositions by their sentence, not by their id. A person reads this afterwards.

If the only grounds you can write is "they did it, so they must prefer it", that is the restatement case. Do not write that rationale. Returning an empty array is a correct answer.

USE THE NOTES WITH NO ANSWER TOO

Notes left alone are most of any feedback. They are weaker evidence than a typed answer, because there is no way to tell someone who read a note and agreed from someone who never saw it. Use them anyway. Say so in the grounds — "they left this note alone" — so that whoever reads the rationale later knows what it rested on.

RETURN FORMAT

Output only a JSON array. One entry per rationale you are writing or rewriting. Propositions you are not changing do not appear.

Write the rationale and the grounds in English, even when the person answered in another language. The propositions are in English and the rationale is read next to them.

[{ "id": "an id from the list in section 3",
   "rationale": "one sentence: what this preference does for the person",
   "rationale_grounds": "one or two sentences: which note this rests on, and which propositions you read it against, named by their wording",
   "rationale_from": ["ids of those propositions; empty if none"] }]`

/** One proposition the revision call just wrote or moved, as the rationale call
 * needs to see it. */
export interface ChangedProposition {
  text: string
  confidence: number
  reasoning: string
  wasNew: boolean
}

/** Every proposition in the model, as the rationale call sees it. Ids are here
 * because the reply has to name one; the grounds are asked for in words. */
export interface RationaleTarget {
  id: string
  text: string
  confidence: number
  observations: number
  rationale: string | null
}

function renderChange(change: ChangedProposition): string {
  const head = change.wasNew
    ? `- new      "${change.text}"   ${outOfTen(change.confidence)}/10`
    : `- moved to ${outOfTen(change.confidence)}/10   "${change.text}"`
  return `${head}\n  because: ${change.reasoning}`
}

function renderTarget(target: RationaleTarget): string {
  return (
    `- [${target.id}] (${outOfTen(target.confidence)}/10, seen ${target.observations}) ${target.text}\n` +
    `  why: ${target.rationale ?? '—'}`
  )
}

export function rationaleUserPrompt(
  notes: FeedbackNoteView[],
  changed: ChangedProposition[],
  model: RationaleTarget[]
): string {
  return `1. THIS FEEDBACK

${notes.map(renderNote).join('\n\n')}

2. WHAT THIS FEEDBACK JUST CHANGED

${changed.length === 0 ? '(nothing — no proposition moved)' : changed.map(renderChange).join('\n')}

3. EVERY PROPOSITION IN THE MODEL SO FAR

${model.length === 0 ? '(none — the user model is empty)' : model.map(renderTarget).join('\n')}`
}
