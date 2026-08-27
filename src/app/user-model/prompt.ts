/** The domain pack: everything the user model knows about this product. Adapted
 * from Shaikh et al., arXiv:2505.10831, §3.1 and §5.3. */

import type {
  UserModelFeedbackBatch,
  UserModelFeedbackItem,
  UserModelFeedbackNote,
  UserModelFeedbackPoint
} from '@/app/user-model/pipeline'

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

/** The drift note only appears once there is drift: on a proposition never
 * rewritten it would be three lines saying nothing. */
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

Update a user model from one fully reviewed step of Interactive Feedback Notes. A user model is a set of propositions about one person. Each proposition says something reusable about their task-relevant perspective and carries a confidence.

The evidence is hierarchical: one step contains several notes, and one note may contain several explicit feedback items. Keep those levels distinct. A person's feedback on one selected phrase or visual region is not agreement with every other phrase in the same note. A note with any feedback items is explicit feedback; do not reinterpret its unselected remainder as implicit agreement.

For every note you receive its cue, representation goal, source agent reasoning, all proposition ids it was connected to, its relationship, and its outcome. A relationship is context for interpreting the evidence, not an instruction to change every connected proposition.

WHAT EACH NOTE TELLS YOU

Work note by note:

- ALIGNMENT + IMPLICITLY ACCEPTED: the user reviewed a concrete decision that followed the connected proposition and continued. This supports only the proposition clauses actually expressed by the note. Raise their confidence when the connection is sound.
- CONFLICT + IMPLICITLY ACCEPTED: the user reviewed a concrete decision that went against the connected proposition and continued. This is counter-evidence. Lower only the contradicted proposition or record a narrower condition; if the accepted alternative is reusable, add it as a new proposition.
- UNCOVERED + IMPLICITLY ACCEPTED: the user accepted a decision for which the model had no coverage. Add or strengthen a proposition only when the decision generalizes beyond this one element or exact setting.
- EXPLICIT FEEDBACK: the user's own words are the strongest evidence. Read all feedback items together and decide whether they confirm a proposition, contradict it, restrict its scope, add a condition, introduce a new perspective, or merely give a local implementation instruction. Do not assume an explicit reply is a correction; it may be confirmation or elaboration.

When a feedback item names a target alternative, that structured selection is the user's authoritative choice. The accompanying feedback text is a supporting explanation, including when it was auto-generated. Interpret that text compatibly with the selected alternative; if it appears to recommend another alternative, do not reverse the selection. For untargeted regions, marks, and text selections, continue to infer intent primarily from the user's feedback text.

The selected source matters. Feedback on agent reasoning can concern the agent's approach. Feedback on proposition or rationale text can directly correct the model. Feedback on a cue or visual region usually concerns the concrete decision shown. Use this to avoid turning a local canvas edit into a broad personal preference.

Several proposition ids may be connected to one note. Judge each independently. Never raise or lower all of them as a group merely because they were retrieved together.

Implicit acceptance is meaningful because the user reviewed every note before continuing, but its scope ends at the decision the note actually expressed. Explicit wording remains stronger. Adjust confidence relative to its current value and the strength of evidence; do not reset it to an arbitrary absolute score. It is valid to return no changes when the evidence is ambiguous or too local.

STRENGTH OF IMPLICIT EVIDENCE

One implicitly accepted note moves an existing proposition by at most one point on the 1–10 scale. It can raise an aligned proposition by one or lower a conflicting proposition by one. Never describe implicit acceptance as something the user "explicitly allowed" or "explicitly confirmed." A larger move requires the user's words or repeated independent evidence.

GENERALIZABILITY GATE — APPLY THIS BEFORE THE RELATIONSHIP RULES

No observation enters the user model merely because it can be rewritten without an exact number. First ask whether the same claim would help predict the user's decision on another task or another independently chosen element.

Return no change for an UNCOVERED, IMPLICITLY ACCEPTED note when all of these are true:
- it concerns one named element or one local implementation setting,
- the only evidence is that the user continued,
- no explicit wording or repeated observation establishes a reusable pattern.

An exact gap, size, colour, label, or position on one element is a setting, not a perspective. Do not generalize "accepted 18px on this badge row" into "accepts wider spacing in small inline elements." Removing the number does not make the evidence general. The default output for this kind of note is [].

CONDITIONAL EXCEPTIONS

An exception is not a wholesale contradiction. When explicit feedback says both that an existing proposition remains valid in its original/default context AND that a different named context should behave differently:
- preserve the existing proposition's confidence, or lower it only slightly if its current wording is demonstrably broader than the user's clarified scope,
- add the reusable context-specific exception as a new proposition,
- never make a large confidence reduction as though the original preference had been rejected everywhere.

Examples such as "let portfolio heroes use dominant imagery; keep cards text-dominant" preserve the card rule and add a hero exception. They do not justify moving a well-supported text-dominance proposition from high confidence to uncertainty.

Keep a context-specific exception inside the context the user named. "Checkout should be airy" supports checkout, not all transactional screens. "Portfolio heroes" supports portfolio heroes, not every landing-page hero. Generalizability means the decision can be reused in that named context; it does not authorize expansion into adjacent contexts.

A CONFIRMED PROPOSITION MAY STILL BECOME MORE PRECISE

When explicit feedback only repeats or approves the existing claim, leave its wording exactly unchanged and move only its confidence. But agreement is not always mere repetition. If explicit feedback keeps the same underlying claim while adding a reusable condition, constraint, scope, exception boundary, trade-off, or decision criterion, refine the existing proposition instead of treating it as confirmation only. The refinement must make the proposition more predictive on a future task without turning a local value or implementation detail into a general preference.

Do not write a second proposition that restates the confirmed claim. Either keep the existing wording or refine that same proposition.

A proposition that failed is different. Lowering it records that we were wrong. It does not record what is true instead, which is the more useful of the two. When the accepted alternative is reusable, also record it as a new proposition. Do not create one for an exact value or one-off implementation instruction.

  Note shown:  "reaching for an indigo button · you keep to neutral tones"   (rested on "mono")
  They said nothing, the agent used indigo, and they were content.

  Not enough:  lower "mono" and stop.
               We now believe less than before and know nothing more.
  Better:      lower "mono", and add "Accepts a saturated colour on the primary action".
               The second sentence is the thing that was actually observed.

REFINING AN EXISTING PROPOSITION

Explicit feedback may refine an existing proposition when the user's own words add or correct reusable precision within the same underlying claim. This includes a context where it applies or does not apply, a constraint that must remain true, a trade-off or decision criterion, a relationship to neighboring elements, or a workflow stage or task condition. In that case, return the existing id with one sharper sentence.

Before rewriting, identify the existing proposition's core claim and the new precision supplied by the feedback. Preserve the core claim and every supported clause the feedback did not address. A refinement may add precision, but must remain logically compatible with the earlier proposition; it must not silently replace it with a different belief. Keep the user's purpose in the rationale rather than appending it to the proposition.

For explicit feedback, classify the evidence against the closest existing proposition in this order:
- same_claim_refinement: it preserves the core claim but adds or corrects reusable precision that would change how the proposition is applied in a future task. Update that id with one coherent, sharper proposition.
- confirmation: it only repeats or approves the same claim without adding reusable precision. Keep the text exactly unchanged and update that id.
- contextual_exception: the original remains the default, but a separately named context behaves differently. Keep the original and create one new proposition for the exception.
- contradiction: the original claim is rejected rather than bounded. Lower it, and create a replacement only when the accepted alternative generalizes.
- new_claim: no existing proposition makes the same underlying claim. Create one proposition.

Prefer same_claim_refinement over contradiction plus a new proposition when the old and new evidence can be represented truthfully as one reusable sentence. Do not manufacture two competing propositions merely because the feedback changes one clause.

Example:
Existing: "Uses one warm amber accent while keeping secondary and tertiary controls neutral."
Explicit feedback: "Use amber on the text-only tertiary control so it reads as interactive."
This is same_claim_refinement, not a wholesale contradiction and not a contextual exception.
Update the existing id to: "Uses warm amber selectively on primary actions and interactive text-only tertiary controls."

Do not refine from implicit acceptance. Do not rewrite merely to improve style, shorten the sentence, or substitute synonyms. Do not remove a clause unless the explicit feedback supplies evidence against that exact clause. If the feedback establishes a genuinely separate preference or a context-specific exception that can stand on its own, create a new proposition instead.

For example, do not rewrite "near-monochrome greys with one warm accent, never a default blue or indigo" to "near-monochrome with one warm accent" merely because a warm gradient appeared. Nothing there addressed indigo, so deleting that clause destroys evidence. But if the user explicitly says "blue is acceptable for informational links, just not primary actions," refining the existing sentence to preserve that boundary is appropriate.

One note may affect several propositions, but prefer the smallest set the evidence actually supports.

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

When explicit feedback contains both a decision and its reason, the proposition stores only the decision and the later rationale call stores the reason. For example, from "give mobile cards more spacing because larger touch separation reduces accidental taps":
- proposition: "Uses more generous spacing between cards on mobile layouts"
- not proposition: "Uses more generous mobile spacing to prevent accidental taps"
- rationale: "Larger touch separation reduces accidental taps"

  Bad:  "Prefers to start design sections without headers initially to maintain workflow efficiency"
        The clause after "to" is a rationale. It belongs in the rationale field, and
        this task does not write that field.
  Good: "Begins a section with its content rather than a heading announcing it"

WRITE A NEW PROPOSITION ONLY WHEN IT SAYS SOMETHING NEW

Because explicit feedback can refine existing wording, do not create a second proposition merely as a substitute for making that justified refinement. It is still easy to record the same thing repeatedly. One build produced these three:

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
  - the claim is the same but explicit feedback adds a reusable scope or condition → refine the existing proposition rather than creating a duplicate.

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
- relation: confirmation, same_claim_refinement, contextual_exception, contradiction, or new_claim.
- id: the existing proposition's id, or null to create a new one.
- text: for a new proposition, the sentence. For an existing proposition, repeat its wording unless explicit feedback justifies a scope or condition refinement under the rules above.
- confidence: 1-10. How strongly the evidence now supports it. 1 means you no longer believe it.
- decay: 1-10, how fast it goes stale. 1 = a durable fact about this person. 10 = true only right now.
- reasoning: one sentence on why you made this change.

Rules:
- Work through every note, answered and left-alone alike. The answered notes are easy to notice and easy to handle on their own; the rest are the other half of the same feedback.
- Leave a proposition out of your response entirely if it needs no change.
- Nothing is ever deleted. Confidence 1 is how a proposition retires.

Operation consistency rules:
- confirmation and same_claim_refinement require an existing id.
- confirmation must repeat the existing text exactly.
- contextual_exception and new_claim require id: null.
- contradiction may update an existing id and may separately create a reusable replacement.
- Never return an invented non-null id.

Respond with ONLY a JSON array: [{"relation": "same_claim_refinement", "id": "existing id or null", "text": "...", "confidence": 8, "decay": 3, "reasoning": "..."}]`

const WHAT_THE_NOTE_SAID: Record<UserModelFeedbackNote['relationship'], string> = {
  conflict: 'the note said the agent was about to go AGAINST that proposition',
  alignment: 'the note said the agent was FOLLOWING that proposition',
  uncovered: 'the note said no proposition covered what the agent was deciding'
}

function renderFeedbackItem(item: UserModelFeedbackItem, index: number): string {
  const selection = userModelSelectionText(item.selection)
  const target =
    item.selection.type !== 'none' && item.selection.type !== 'text' && item.selection.target
      ? item.selection.target
      : null
  if (target) {
    return (
      `    ${index + 1}. AUTHORITATIVE CHOICE: "${target.label}" (id: ${target.id})\n` +
      `       selection evidence: ${selection}\n` +
      `       supporting explanation: "${item.feedback}"\n` +
      '       interpretation: update the model from the selected alternative; the explanation may refine but must not reverse it'
    )
  }
  return `    ${index + 1}. selected ${selection}\n       said: "${item.feedback}"`
}

function userModelSelectionText(selection: UserModelFeedbackItem['selection']): string {
  const point = (value: UserModelFeedbackPoint) => `(${value.x.toFixed(2)}, ${value.y.toFixed(2)})`
  const target =
    selection.type !== 'none' && selection.type !== 'text' && selection.target
      ? `target alternative "${selection.target.label}" (id: ${selection.target.id}), marked by `
      : ''
  switch (selection.type) {
    case 'none':
      return 'no specific selection (legacy feedback)'
    case 'region':
      return `${target}visual region x=${selection.x.toFixed(2)}, y=${selection.y.toFixed(2)}, w=${selection.width.toFixed(2)}, h=${selection.height.toFixed(2)}`
    case 'point':
      return `${target}position ${point(selection)}`
    case 'arrow':
      return `${target}direction ${point(selection.start)} → ${point(selection.end)}`
    case 'sequence':
      return `${target}ordered positions ${selection.points.map((value, index) => `${index + 1}:${point(value)}`).join(' → ')}`
    case 'freehand':
      return `${target}freehand path through ${selection.points.length} points`
    case 'text':
      return `${selection.source} text: "${selection.text}"`
    default:
      throw new Error(`Unknown feedback selection: ${String(selection satisfies never)}`)
  }
}

function renderNote(note: UserModelFeedbackNote, index: number): string {
  const rests =
    note.propositionIds.length === 0
      ? '  rested on: nothing — no proposition covered this'
      : `  rested on proposition ids: ${note.propositionIds.join(', ')}`
  const answer =
    note.resolution === 'implicitly-accepted'
      ? '  outcome: they reviewed this note, added no feedback, and continued'
      : `  outcome: explicit feedback (${note.feedbackItems.length} item${note.feedbackItems.length === 1 ? '' : 's'})\n${note.feedbackItems.map(renderFeedbackItem).join('\n')}`
  return (
    `${index + 1}. note id ${note.noteId}, chunk ${note.chunk}, topic ${note.topic}\n` +
    `  shown to them: "${note.cue}"\n` +
    `  why this representation was shown: "${note.representationGoal}"\n` +
    `  read off the agent's words: "${note.reasoningEvidence}"\n` +
    `${rests}\n  ${WHAT_THE_NOTE_SAID[note.relationship]}\n${answer}`
  )
}

export function feedbackUserPrompt(
  batch: UserModelFeedbackBatch,
  propositions: ReviseNeighbour[]
): string {
  const held =
    propositions.length === 0
      ? '(none — the user model is empty)'
      : propositions.map(renderNeighbour).join('\n')

  return `Reviewed step: ${batch.step ?? 'unscoped feedback'}

The propositions these notes touch:
${held}

The notes shown during this build:
${batch.notes.map(renderNote).join('\n\n')}`
}

export const RATIONALE_SYSTEM = `TASK

From the feedback a person just gave, infer the rationale behind the propositions in a user model. A proposition says what this person prefers. Its rationale says what that preference does for them.

  proposition:  The user prefers compact layouts.
  rationale:    Compact layouts let them compare more information at once.

This is what the feedback looks like. While an AI agent was building something on a design canvas, notes appeared beside the canvas. A note could align with existing propositions, conflict with them, or cover a decision absent from the model. The user reviewed every note. They could attach several comments to selected text or visual regions, or continue without adding one. Both explicit feedback and reviewed implicit acceptance are evidence, but explicit wording is stronger and its selected source limits what it supports.

The feedback on its own is usually not enough to see a purpose in. So you are also given the propositions already in the model. Put several of them beside this feedback and the goal they have all been serving becomes visible. That goal is the rationale.

Writing and rewriting rationales is the whole of this task. Changing a proposition is not part of it — neither its wording nor its confidence.

HARD RULE: do not write or rewrite the rationale of an existing proposition whose confidence just decreased. A decrease records doubt or a scope failure; inventing a narrower purpose for the unchanged, broader sentence makes its rationale contradict its wording. Leave that rationale untouched. You may write a rationale for a newly created context-specific exception instead.

EVIDENCE GATE — KNOWING WHAT IS NOT KNOWING WHY

A confirmed proposition does not automatically deserve a rationale. Implicit acceptance shows that a concrete decision was acceptable; it does not reveal the user's purpose. A context-specific exception shows where a preference changes; it does not reveal why that exception exists.

Write or rewrite a rationale only when at least one of these supplies evidence for purpose:
- the user's explicit feedback states a reason, goal, consequence, trade-off, or intended effect,
- the user's choice or correction, its selected source, the note context, and the existing model jointly make one purpose substantially better supported than competing explanations,
- several independent feedback moments jointly demonstrate the same purpose beyond merely repeating the proposition.

Reasons are often expressed without causal words such as "because" or "so that". Do not require a particular phrase. For example, "Keep the cards at their natural heights; their descriptions vary substantially" supports accommodating variable content even though it never labels the second clause as a reason.

An inferred rationale must still be grounded, not merely plausible. Identify the concrete interaction evidence that anchors the inference, then check it against the selected source, note goal and linked propositions. Infer only when that combined evidence favors one explanation clearly. If several materially different purposes fit equally well, omit the rationale.

Otherwise omit that proposition from the response. In particular:
- one implicitly accepted note with no user wording → no rationale,
- explicit feedback that says only what should change or where it applies, with no contextual evidence favoring a purpose → no rationale,
- a newly created exception for which several purposes remain equally plausible → no rationale.

Do not fill missing evidence with design expertise. Claims such as "creates a high-impact visual hook," "improves readability," "supports scanning," or "establishes hierarchy" are not evidence about this person unless their feedback actually says so.

Scope is not automatically purpose. "Let the image dominate in portfolio heroes, but keep cards text-dominant" tells you WHAT changes and WHERE. Unless the selected source, note, or other user evidence distinguishes a purpose, do not convert "hero" into an invented claim such as visual impact, entry-point focus, or a visual hook.

Before returning each item, complete this check internally:
1. Read the user's words with the selected source, note context, and relevant propositions.
2. Verify that one purpose is better supported than plausible alternatives.
3. Write the narrowest inference that adds no unsupported effect.
4. Copy an exact substring from the user's explicit feedback that anchors the inference. It may state the decision or relevant circumstance and does not need a causal word.

If step 2 fails, omit the item. Rationale grounds must explain the contextual inference; quoting a decision alone does not make an invented rationale supported.

COUNTERFACTUAL TEST

Hide the user's feedback, selected source, and note context, then read only the proposition. If you could still have written essentially the same rationale from general design knowledge or by paraphrasing the proposition, do not return it. A valid rationale must depend on evidence particular to this interaction.

WHAT YOU ARE GIVEN

1. THIS FEEDBACK. For each note: its cue and goal, the agent reasoning it came from, every linked proposition, its relationship and resolution, and every selected region or text fragment with the user's words.

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

UPDATE ONLY PROPOSITIONS THE PURPOSE EVIDENCE ACTUALLY BEARS ON

This is why you are given the whole model rather than only the propositions the notes touched: one stated or well-supported inferred purpose may explain another existing proposition too. That does not relax the evidence gate. Update several rationales only when the same interaction evidence genuinely supports each one.

SUBMIT THE GROUNDS WITH IT

Every rationale you write comes with its grounds, which are two things:
  - which note in this feedback it rests on
  - which propositions you read that note against to arrive at it

Name propositions by their sentence, not by their id. A person reads this afterwards.

If the only grounds you can write is "they did it, so they must prefer it", that is the restatement case. Do not write that rationale. Returning an empty array is a correct answer.

NOTES WITH NO ANSWER CONFIRM WHAT, NOT WHY

An implicitly accepted note can strengthen a proposition, but by itself it cannot create or rewrite a rationale. Do not use cue wording, representation goals, or agent reasoning as if the user had stated those purposes.

RETURN FORMAT

Output only a JSON array. One entry per rationale you are writing or rewriting. Propositions you are not changing do not appear.

Write the rationale and the grounds in English, even when the person answered in another language. The propositions are in English and the rationale is read next to them.

[{ "id": "an id from the list in section 3",
   "rationale": "one sentence: what this preference does for the person",
   "purpose_evidence_quote": "an exact substring from the user's explicit feedback that anchors the inference; no causal phrase is required",
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

/** Ids are here because the reply has to name one; the grounds are in words. */
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
  batch: UserModelFeedbackBatch,
  changed: ChangedProposition[],
  model: RationaleTarget[]
): string {
  return `1. THIS FEEDBACK

${batch.notes.map(renderNote).join('\n\n')}

2. WHAT THIS FEEDBACK JUST CHANGED

${changed.length === 0 ? '(nothing — no proposition moved)' : changed.map(renderChange).join('\n')}

3. EVERY PROPOSITION IN THE MODEL SO FAR

${model.length === 0 ? '(none — the user model is empty)' : model.map(renderTarget).join('\n')}`
}
