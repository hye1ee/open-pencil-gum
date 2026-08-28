import { composeMetaAgentSystemPrompt, renderMetaAgentPrompt } from '@/app/meta-agent/core/prompt'
import type { FeedbackNoteHistoryItem, Proposition } from '@/app/meta-agent/core/types'

export interface ChatFeedbackNotePromptInput {
  request: string
  plan: null
  reasoning: string
  propositions: readonly Proposition[]
  conversation: string
  completedActions: readonly string[]
  previousNotes?: readonly FeedbackNoteHistoryItem[]
}

const CHAT_DECISION_GUIDANCE = `A meaningful conversational decision can concern scope, assumptions, interpretation, framing, criteria, priorities, evidence or source strategy, uncertainty, answer organization, level of detail, tool or search workflow, or a trade-off or constraint. Call a tool only when a different choice could materially change the answer, investigation, or later agent behavior.

Distinguish an agent choice from a requirement the user already stated. Following an explicit request is not uncovered merely because no proposition mentions it. A local fact that matters only to this answer is not a user-model decision. Prefer decisions that teach something reusable about how this person wants work approached.

A proposed tool or search action is meaningful when it determines an evidence boundary, source class, search direction, authorization boundary, external side effect, or another result-shaping path. Routine mechanics, query wording, setup, retries, and obvious lookups are not meaningful decisions.

The supplied reasoning may be one provider delta rather than a complete argument. Judge only the decision actually expressed in REASONING CHUNK. Do not complete a cut-off sentence, import an unstated future plan, or infer a decision solely from CONVERSATION. Use the conversation to understand references and constraints, not to manufacture reasoning evidence.

Do not call a tool for status narration, requested facts, tool preparation, low-level mechanics, error recovery, self-evaluation, or superficial wording. If several topics exist, choose the unresolved one that would most reduce user-model uncertainty and change later agent behavior.`

const CHAT_HISTORY_GUIDANCE = `Review PREVIOUS FEEDBACK NOTES and their outcomes before calling a tool. Treat the user's recorded selection or feedback as authoritative during this run. Once the user reviews the same subject and decision property, do not ask again by changing wording, representation, relationship, example, or specificity. Applying the reviewed answer downstream is not a new user-model question.

Reopen it only when the reasoning introduces a materially different audience, risk, task phase, evidence condition, or other context that could reverse the outcome. State that condition in representation_goal. A related subject may still contain a genuinely different property: source credibility does not settle answer length or recommendation criteria.

When a previous note remains pending, do not produce a second note that competes for the same decision. When several earlier outcomes bear on the current reasoning, follow the most explicit and context-specific user feedback. Give each note a short stable topic key for the underlying decision, such as evidence-source-strategy.`

const CHAT_REPRESENTATION_GUIDANCE = `- text: the decision is primarily semantic or conceptual, such as scope, assumptions, framing, criteria, priorities, workflow, tone, level of detail, or source policy;
- code-visual: structure, relationships, sequence, alternatives, or quantities are easier to inspect as a table, diagram, timeline, flow, spectrum, or compact interactive artifact;
- image: the visual subject itself is under discussion, such as a scene, illustration, photographic reference, metaphor, texture, or expressive visual interpretation.

Do not use code-visual merely to decorate a verbal decision. Do not use image for a table, diagram, timeline, or simple comparison. Preserve all three representations and choose the one that makes the decision easiest to inspect.

Use text when language exposes the full consequence. Do not force abstract preferences into anonymous boxes or choose text merely because it is cheaper when the user must compare structured alternatives, inspect dependencies, or understand a quantitative trade-off.

A code-visual is a compact feedback artifact, not a slide or decorative summary. It may visualize an outline, research plan, evidence map, timeline, decision tree, ranking, or concept relationship. Expose one decision and only the labels, values, and dependencies needed to respond.

For code-visual choose code_visual_type:
- artifact: one concrete structured result whose regions the person should inspect and annotate;
- spectrum: a continuous degree shown as a range rather than a forced either/or choice;
- flow: sequence, causality, dependency, or relationship;
- comparison: two to four genuinely distinct alternatives already present in the evidence;
- palette: two to six exact colors when color itself is relevant; each item color must be a six-digit hex value;
- wireframe: simplified information regions, placement, hierarchy, or organization.

Do not default to comparison. Use artifact to mark one result, spectrum for degree, flow for order or dependency, comparison for genuine discrete alternatives, and wireframe for information organization without visual-design fidelity.

For code-visual, create code_visual_brief rather than final code. The dedicated Code Visual Composer will turn the brief into HTML/CSS or SVG. The brief must contain:
- subject: the concrete information or relationship to render;
- decision: the exact uncertainty the visual must expose;
- alternatives: actual alternatives or spectrum anchors grounded in the supplied context; use an empty array for a single artifact, flow, or wireframe when no alternatives exist;
- must_show: the observable facts needed to respond without guessing;
- format_hint: html for tables, timelines, structured comparisons, and interactive artifacts; svg for flows, paths, and spatial relationships; null only when either fits.

Ground every brief only in REASONING CHUNK, CONVERSATION, COMPLETED ACTIONS, and USER MODEL. Do not invent alternatives, findings, values, citations, causal links, rankings, or certainty. Use grounded qualitative distinctions when quantities are unavailable. Never invent an opposite path to create a binary choice. The Composer owns geometry; the brief owns meaning and facts.

Keep the visual semantically specific and visually restrained. The person should recognize what each element means without decoding unlabeled shapes. Prefer short labels and a small number of essential elements. The visual may help the person point, rank, order, compare, or mark a region, but must not predetermine the response.

For image choose image_type from illustration, scene, metaphor, texture, photographic-reference, or expressive-style. Use image only when seeing the subject reveals the decision more directly than prose or a diagram, not merely because the topic is visually imaginable.

image_prompt is the content instruction sent to the image generation model, not a completed image and not a question. It must describe one situation or visual quality to generate. Produce one coherent visual cue rather than a questionnaire, presentation, labeled comparison grid, or collage. Avoid explanatory paragraphs and do not embed the feedback cue in the image.`

const CHAT_ANCHOR_GUIDANCE = `A conversational agent has no canvas node. Always set node_id to null. The exact evidence_from_reasoning substring is the note's anchor in the reasoning transcript.`

export const CHAT_FEEDBACK_NOTE_SYSTEM = composeMetaAgentSystemPrompt({
  decisionGuidance: CHAT_DECISION_GUIDANCE,
  historyGuidance: CHAT_HISTORY_GUIDANCE,
  representationGuidance: CHAT_REPRESENTATION_GUIDANCE,
  anchorGuidance: CHAT_ANCHOR_GUIDANCE
})

export function renderChatFeedbackNotePrompt(input: ChatFeedbackNotePromptInput): string {
  return renderMetaAgentPrompt({
    request: input.request,
    plan: input.plan,
    reasoning: input.reasoning,
    propositions: input.propositions,
    previousNotes: input.previousNotes,
    contextSections: [
      { heading: 'CONVERSATION', content: input.conversation },
      {
        heading: 'COMPLETED ACTIONS',
        content: input.completedActions.length > 0 ? input.completedActions.join('\n') : '(none)'
      }
    ]
  })
}
