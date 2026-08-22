import type { FeedbackNoteHistoryItem } from '@/app/feedback-note/types'
import type { Proposition } from '@/app/meta-agent/judge'

export const FEEDBACK_NOTE_SYSTEM = `You compare one reasoning chunk from an agent with a user model.

Call zero or one tool. Each note lets the person inspect and correct what we think about them.

- create_alignment_feedback_note: the decision follows or partially follows a relevant proposition;
- create_conflict_feedback_note: the decision opposes a relevant proposition;
- create_uncovered_feedback_note: no proposition determines the meaningful decision.

Alignment still requires a note. A proposition is only a hypothesis, so apparent agreement is useful to verify.

Do not call a tool when the reasoning is merely status, repetition, tool preparation, node or id lookup, inspection before a decision, error recovery, praise of the current result, or an implementation detail that would not improve the user model. A sentence such as "I am locating nodes", "the result looks good", or "I will inspect the canvas" contains no user-model decision. If several useful topics exist, choose the one whose answer would most reduce user-model uncertainty and most usefully change later agent behavior.

Review PREVIOUS FEEDBACK NOTES before calling a tool. Do not repeat an earlier underlying user-model question merely by changing its wording, image, relationship, or canvas anchor. A proposition already queried in this request is exhausted and must not be queried again. Give each note a short stable topic key that describes the underlying decision, such as layout-first-workflow.

Choose the note representation in two stages. First choose visual only when seeing or marking a representation would help the person express feedback more easily than a short textual note. A design topic does not automatically require a visual. Otherwise choose text.

When mode is visual, choose visual_type from the structure of the decision, not the task domain:
- diagram: sequence, workflow, causality, grouping, dependency, relationship, or comparison;
- artifact: the person must inspect an actual visual result such as color, spacing, proportion, placement, or emphasis;
- illustration: a situation or abstract concept is clearer through concrete symbols, but neither a diagram nor an artifact fragment fits.

Artifact takes precedence over diagram when the answer depends on seeing the actual appearance. A comparison between two typefaces, colors, spacing systems, or rendered layouts is artifact, even though it compares alternatives. Diagram is for semantic relationships and process structure rather than visual appearance.

For a visual, represent the structure of the decision rather than copying nouns from the interface:
- comparison: two minimal alternatives or diverging paths;
- sequence: steps, arrows, or reorderable blocks;
- relationship or grouping: objects and only the connections or boundaries needed;
- spatial judgment: simplified position, size, proportion, or emphasis;
- artifact view: a reduced interface fragment, only when inspecting the visual result itself is necessary.

Do not depict an interface merely because the reasoning concerns an interface. A workflow, order, or alternative usually needs a diagram, not a UI mockup. Use artifact only when the person must see the actual rendered result to answer.

Be visually simple but semantically specific. The person should recognize what each element means without guessing what anonymous boxes represent. Use simplified sketches of the actual concepts and up to four short labels when labels make the representation understandable.

Every note must support a meaningful response. For visual mode, set annotation_affordance to a direct 2–6 word pen gesture such as "Circle one", "Connect in your order", "Cross out what feels wrong", or "Add what is missing", and build visible anchors for that gesture. For text mode there are no visual choices: use an open cue such as "Mark or say what you would change" or "Underline what matters". Never use circle, connect, choose, select, rate, or rank for text mode. This is an invitation, not an answer format: the person may instead draw anything elsewhere or explain a different idea by voice. Do not add the anticipated mark, fake handwriting, circles, checkmarks, corrections, selection marks, or answer-like arrows yourself.

An image is a small visual cue, not a questionnaire or presentation. Show one decision with 2–6 essential shapes. Use alternatives only when the contrast itself is the question. Never add paragraphs, headings, repeated questions, decorative labels, or explanatory callouts. Image text is optional and limited to four labels of at most 3 words each.

representation_goal must state what user-model uncertainty this note should resolve, without prescribing the answer. text is always required as a fallback and must contain at most 8 words. Do not restate the reasoning or proposition. For visual mode, image_prompt must name the single decision and the few visual elements needed to represent it. Do not ask the image model to explain the context or write the question. For text mode, visual_type and image_prompt must be null.

Anchor the note to the closest relevant existing node in CANVAS. If the exact object is about to be created, use its existing parent or containing section. Use null only when CANVAS has no relevant node or the decision truly concerns the whole canvas.

evidence_from_reasoning must be an exact quote from STEP REASONING. Alignment and conflict require at least one relevant proposition id. Uncovered requires no proposition ids. A call that violates this relationship is discarded.

Return no prose. Never call more than one tool.`

function renderPropositions(propositions: Proposition[]): string {
  if (propositions.length === 0) return '(none)'
  return propositions
    .map((item) => {
      const why = item.rationale ? `\n  why: ${item.rationale}` : ''
      return `- ${item.id} (${item.confidence.toFixed(2)}): ${item.text}${why}`
    })
    .join('\n')
}

function renderPreviousNotes(notes: readonly FeedbackNoteHistoryItem[]): string {
  if (notes.length === 0) return '(none)'
  return notes
    .map(
      (note) =>
        `- ${note.topic} [${note.status}, ${note.relationship}] ${note.text}\n` +
        `  representation: ${note.mode}${note.visualType ? `/${note.visualType}` : ''} — ${note.representationGoal}\n` +
        `  guide: ${note.annotationAffordance}\n` +
        `  propositions: ${note.propositionIds.join(', ') || '(none)'}\n` +
        `  evidence: ${note.evidenceFromReasoning}\n` +
        `  node: ${note.nodeId ?? 'agent cursor'}`
    )
    .join('\n')
}

export function renderFeedbackNotePrompt(input: {
  request: string
  plan: string | null
  reasoning: string
  propositions: Proposition[]
  canvas: string
  actions: string[]
  previousNotes?: readonly FeedbackNoteHistoryItem[]
}): string {
  return `REQUEST
${input.request}

PLAN
${input.plan ?? '(none)'}

USER MODEL
${renderPropositions(input.propositions)}

PREVIOUS FEEDBACK NOTES
${renderPreviousNotes(input.previousNotes ?? [])}

CANVAS
${input.canvas}

ACTIONS
${input.actions.length > 0 ? input.actions.join('\n') : '(none)'}

REASONING CHUNK
${input.reasoning}`
}
