import { composeMetaAgentSystemPrompt, renderMetaAgentPrompt } from '@/app/meta-agent/core/prompt'
import type { FeedbackNoteHistoryItem, Proposition } from '@/app/meta-agent/core/types'

export interface DesignFeedbackNotePromptInput {
  request: string
  plan: string | null
  reasoning: string
  propositions: Proposition[]
  canvas: string
  actions: string[]
  previousNotes?: readonly FeedbackNoteHistoryItem[]
}

const DESIGN_DECISION_GUIDANCE = `Do not call a tool when the reasoning is merely status, repetition, tool preparation, node or id lookup, inspection before a decision, error recovery, praise of the current result, or an implementation detail that would not improve the user model. A sentence such as "I am locating nodes", "the result looks good", or "I will inspect the canvas" contains no user-model decision. If several useful topics exist, choose the one whose answer would most reduce user-model uncertainty and most usefully change later agent behavior.`

const DESIGN_HISTORY_GUIDANCE = `Review PREVIOUS FEEDBACK NOTES and their outcomes before calling a tool. Treat a decision about the same target and the same decision property as resolved for the rest of this run once the user reviews its Note. The recorded selection and user feedback are authoritative for that decision. Do not ask again by changing wording, representation, relationship, canvas anchor, exact value, implementation detail, or by framing the same decision as a final confirmation. A more specific application of an answer is not a new user-model question. Reopen a resolved decision only when the new reasoning introduces a materially different condition that could reasonably reverse the user's previous answer; state that condition and why it could change the answer in representation_goal. A different object or hierarchy role may still be a different decision when its answer can genuinely differ: resolving a primary control's accent does not automatically resolve a secondary or tertiary control's treatment. Skip when the earlier outcome already determines what the agent should do now. Give each note a short stable topic key that describes the underlying decision, such as layout-first-workflow.`

const DESIGN_REPRESENTATION_GUIDANCE = `- text: the decision concerns workflow, intent, meaning, content, priority, or another non-visual judgment that loses nothing when expressed only in language;
- code-visual: the decision concerns a visually observable difference in structure, alternatives, values, colors, spacing, typography, hierarchy, layout, or relationships;
- image: illustration, a scene, metaphor, texture, photographic realism, or expressive style is itself the information.

When a decision is visually observable, prefer code-visual even if it could also be described or asked in words. Exact numeric values are not required: code-visual may show a grounded qualitative contrast as long as the reasoning provides genuinely different alternatives. Do not use text merely because it is easier to generate.

Do not choose image for a diagram, palette, simple comparison, or wireframe. Those belong to code-visual. A design topic does not automatically need either visual representation.

Treat a newly proposed illustration subject, scene, symbolism, atmosphere, texture, photographic direction, or expressive art style as a meaningful image-content decision when it could affect later work. If that content itself is the feedback target, choose image even when the same reasoning also discusses its placement or scale. Choose code-visual only when the feedback target is the image's layout, size, prominence, cropping, or relationship to other UI—not its depicted content or expressive character. Do not silently replace an image-content decision with a nearby layout decision merely because the layout connects to a known proposition.

For code-visual choose code_visual_type:
- artifact: one concrete UI or composition whose regions the person should inspect and annotate; do not manufacture a second version;
- spectrum: a continuous degree such as density, scale, contrast, warmth, or prominence, shown as a range rather than a forced either/or choice;
- flow: sequence, causality, dependency, or relationship;
- comparison: two to four genuinely distinct alternatives that already exist in the evidence;
- palette: two to six exact colors; each item color must be a six-digit hex value;
- wireframe: simplified regions, placement, hierarchy, or layout.

Do not default to comparison. Use artifact when feedback can be given by marking part of one proposed design. Use spectrum when the decision is about degree. Use comparison only when the evidence contains discrete alternatives and choosing among them is genuinely the question.

For code-visual, create code_visual_brief rather than final code. The dedicated Code Visual Composer will turn this brief into HTML/CSS or SVG. The brief must contain:
- subject: the concrete artifact or relationship to render;
- decision: the exact uncertainty the visual must expose;
- alternatives: the actual alternatives or spectrum anchors with exact known values or visible differences; use an empty array for a single artifact, flow, or wireframe when no alternatives exist;
- must_show: the observable facts needed to answer without guessing;
- format_hint: html for UI, layout, spacing, typography, controls, and rendered artifacts; svg for flows, paths, spatial relationships, and diagrams; null only when either fits.

Ground every brief only in STEP REASONING, CANVAS, ACTIONS, and USER MODEL. Do not invent before/after values. If the reasoning does not provide exact values, describe the qualitative contrast without fabricating numbers. Never turn one proposed artifact into a binary choice by inventing an opposing version. A comparison needs at least two genuinely different alternatives. The Composer owns geometry and styling; the brief owns meaning and factual constraints.

For image choose image_type from illustration, scene, metaphor, texture, photographic-reference, or expressive-style. image_prompt is the content instruction sent to the image generation model, not a completed image and not a question. It must name the single situation or visual quality to generate.

Be visually simple but semantically specific. The person should recognize what each element means without guessing what anonymous boxes represent. Use simplified sketches of the actual concepts and up to four short labels when labels make the representation understandable.

An image is a small visual cue, not a questionnaire or presentation. Show one decision with 2–6 essential shapes. Use alternatives only when the contrast itself is the question. Never add paragraphs, headings, repeated questions, decorative labels, or explanatory callouts. Image text is optional and limited to four labels of at most 3 words each.`

const DESIGN_ANCHOR_GUIDANCE = `Anchor the note to the closest relevant existing node in CANVAS. If the exact object is about to be created, use its existing parent or containing section. Use null only when CANVAS has no relevant node or the decision truly concerns the whole canvas.`

export const DESIGN_FEEDBACK_NOTE_SYSTEM = composeMetaAgentSystemPrompt({
  decisionGuidance: DESIGN_DECISION_GUIDANCE,
  historyGuidance: DESIGN_HISTORY_GUIDANCE,
  representationGuidance: DESIGN_REPRESENTATION_GUIDANCE,
  anchorGuidance: DESIGN_ANCHOR_GUIDANCE
})

export function renderDesignFeedbackNotePrompt(input: DesignFeedbackNotePromptInput): string {
  return renderMetaAgentPrompt({
    request: input.request,
    plan: input.plan,
    reasoning: input.reasoning,
    propositions: input.propositions,
    previousNotes: input.previousNotes,
    contextSections: [
      { heading: 'CANVAS', content: input.canvas },
      {
        heading: 'ACTIONS',
        content: input.actions.length > 0 ? input.actions.join('\n') : '(none)'
      }
    ]
  })
}
