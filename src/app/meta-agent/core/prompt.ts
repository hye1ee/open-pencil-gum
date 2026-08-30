import type { FeedbackNoteHistoryItem, Proposition } from '@/app/meta-agent/core/types'
import { koreanOutputInstruction } from '@/app/study/language'

export interface MetaAgentContextSection {
  heading: string
  content: string
}

export interface MetaAgentSystemPromptProfile {
  decisionGuidance: string
  historyGuidance: string
  representationGuidance: string
  anchorGuidance: string
}

export interface MetaAgentPromptInput {
  request: string
  plan: string | null
  reasoning: string
  propositions: readonly Proposition[]
  contextSections: readonly MetaAgentContextSection[]
  previousNotes?: readonly FeedbackNoteHistoryItem[]
}

const CORE_INTRO = `You compare one reasoning chunk from an agent with a user model.

Call zero or one tool. Each note lets the person inspect and correct what we think about them.

- create_alignment_feedback_note: the decision follows or partially follows a relevant proposition;
- create_conflict_feedback_note: the decision opposes a relevant proposition;
- create_uncovered_feedback_note: no proposition determines the meaningful decision.

Alignment may require a note because a proposition is only a hypothesis, but do not verify a decision that the user already resolved in PREVIOUS FEEDBACK NOTES during this run.`

const CORE_REPRESENTATION_OPENING = 'Choose exactly one representation_type:'

const CORE_CUE_GUIDANCE = `representation_goal must state what user-model uncertainty this note should resolve, without prescribing the answer. cue_segments together form the concise, grammatically complete feedback cue shown alongside or instead of the primary representation. Their joined text must contain at most 30 words. It is not necessarily a question. Choose the form that best supports the intended feedback:
- observation or working assumption: expose how the agent currently interprets the direction;
- discrepancy statement: reveal a concrete tension with the user model;
- annotation instruction: invite the person to mark a relevant region of one artifact;
- adjustment prompt: indicate what quality or region can be changed;
- spectrum description: name the quality and its meaningful range;
- completion prompt: leave one meaningful criterion for the person to supply;
- direct question: use only when an explicit verbal answer is genuinely necessary.

Prefer declarative or action-oriented cues. Do not default to yes/no, "Should…", "Does…", "Would…", or forced A-or-B wording. Write the cue within the limit from the start; never truncate longer text. Do not restate the reasoning or proposition.

Build cue_segments in display order. Each segment contains text plus its provenance:
- reasoning: use when that phrase is grounded in STEP REASONING; evidence_quote must be an exact supporting quote and proposition_id must be null;
- proposition: use when that phrase is grounded in a cited USER MODEL proposition; proposition_id must also appear in proposition_ids and evidence_quote must be null;
- neutral: use only for connective or interaction language not claimed by either source; both provenance fields must be null.

Segment text may paraphrase its source naturally; the provenance field points to the exact source. Every cue requires at least one reasoning segment. Alignment and conflict require at least one proposition segment. Uncovered must contain no proposition segment. Keep neutral language minimal so the person can inspect why the cue exists. The unused representation payloads must be null: text sets code_visual_type and code_visual_brief to null and uses no image fields; code-visual sets image fields to null; image sets code_visual_type and code_visual_brief to null. Never combine primary representations.`

const CORE_OUTPUT_RULES = `evidence_from_reasoning must be an exact quote from STEP REASONING. Alignment and conflict require at least one relevant proposition id. Uncovered requires no proposition ids. A call that violates this relationship is discarded.

Return no prose. Never call more than one tool.`

export function composeMetaAgentSystemPrompt(profile: MetaAgentSystemPromptProfile): string {
  return (
    [
      CORE_INTRO,
      profile.decisionGuidance,
      profile.historyGuidance,
      `${CORE_REPRESENTATION_OPENING}\n${profile.representationGuidance}`,
      CORE_CUE_GUIDANCE,
      profile.anchorGuidance,
      CORE_OUTPUT_RULES
    ].join('\n\n') + koreanOutputInstruction()
  )
}

function renderPropositions(propositions: readonly Proposition[]): string {
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
    .map((note) => {
      const outcome = note.outcome
        ? note.outcome.resolution === 'implicitly-accepted'
          ? '  outcome: user reviewed and accepted this decision without correction\n'
          : `  outcome: explicit user feedback\n` +
            `  selected or marked: ${note.outcome.selections.join('; ') || '(none)'}\n` +
            `  user feedback: ${note.outcome.feedback.map((text) => `"${text}"`).join('; ') || '(none)'}\n`
        : '  outcome: pending\n'
      return (
        `- ${note.topic} [${note.status}, ${note.relationship}] ${note.text}\n` +
        `  representation: ${note.representationType}${note.representationSubtype ? `/${note.representationSubtype}` : ''} — ${note.representationGoal}\n` +
        `  propositions: ${note.propositionIds.join(', ') || '(none)'}\n` +
        `  evidence: ${note.evidenceFromReasoning}\n` +
        outcome +
        `  node: ${note.nodeId ?? 'agent cursor'}`
      )
    })
    .join('\n')
}

export function renderMetaAgentPrompt(input: MetaAgentPromptInput): string {
  const context = input.contextSections
    .map((section) => `${section.heading}\n${section.content}`)
    .join('\n\n')

  return `REQUEST
${input.request}

PLAN
${input.plan ?? '(none)'}

USER MODEL
${renderPropositions(input.propositions)}

PREVIOUS FEEDBACK NOTES
${renderPreviousNotes(input.previousNotes ?? [])}

${context}

REASONING CHUNK
${input.reasoning}`
}
