import { describe, expect, test } from 'bun:test'

import {
  agentTurn,
  awaitTurnResume,
  currentTurnGeneration,
  pauseTurn,
  resumeTurn,
  setTurnRunning
} from '@/app/ai/chat/agent-turn'
import { META_AGENT_FEEDBACK_NOTE_TOOLS as FEEDBACK_NOTE_TOOLS } from '@/app/meta-agent/core/tools'
import {
  DESIGN_FEEDBACK_NOTE_SYSTEM as FEEDBACK_NOTE_SYSTEM,
  renderDesignFeedbackNotePrompt as renderFeedbackNotePrompt
} from '@/app/meta-agent/domains/canvas/prompt'
import { buildInteractiveCodeVisualDocument } from '@/app/meta-agent/feedback-note/code-visual/document'
import {
  inspectCodeVisualHtml,
  sanitizeCodeVisualHtml
} from '@/app/meta-agent/feedback-note/code-visual/html'
import {
  CODE_VISUAL_SYSTEM,
  renderCodeVisualComposerPrompt
} from '@/app/meta-agent/feedback-note/code-visual/prompt'
import {
  codeVisualSvgToUrl,
  inspectCodeVisualSvg,
  sanitizeCodeVisualSvg
} from '@/app/meta-agent/feedback-note/code-visual/svg'
import { CODE_VISUAL_TOOLS } from '@/app/meta-agent/feedback-note/code-visual/tools'
import { codeVisualToolName } from '@/app/meta-agent/feedback-note/code-visual/use'
import { createConfirmedFeedbackHistory } from '@/app/meta-agent/feedback-note/draft/history'
import {
  FEEDBACK_DRAFT_SYSTEM,
  renderFeedbackDraftPrompt
} from '@/app/meta-agent/feedback-note/draft/prompt'
import { buildFeedbackNoteImagePrompt } from '@/app/meta-agent/feedback-note/image'
import { readFeedbackNote } from '@/app/meta-agent/feedback-note/parse'
import { renderStepFeedbackReport } from '@/app/meta-agent/hosts/lencanvas/feedback-note/report'
import {
  beginFeedbackReplay,
  completeFeedbackReplay,
  currentFeedbackReplayStep,
  hasExplicitStepFeedback,
  interactiveFeedbackStep,
  recordFeedbackOutcome,
  recordFeedbackReasoning,
  resetStepFeedbackSession,
  takeStepFeedbackResult
} from '@/app/meta-agent/hosts/lencanvas/feedback-note/session'

const COMPARISON_SVG = `<svg viewBox="0 0 720 440">
  <rect x="80" y="120" width="220" height="72" rx="36" fill="none" stroke="#5D5964" />
  <rect x="420" y="120" width="220" height="72" rx="36" fill="#5D5964" />
  <text x="190" y="230" text-anchor="middle">Outline</text>
  <text x="530" y="230" text-anchor="middle">Solid</text>
</svg>`

describe('interactive feedback note', () => {
  test('keeps a feedback hold when chat status temporarily stops running', async () => {
    setTurnRunning(true)
    const turnGeneration = currentTurnGeneration()
    pauseTurn('feedback-note')
    let released = false
    const waiting = awaitTurnResume('test-before-action', turnGeneration).then((allowed) => {
      released = true
      return allowed
    })

    setTurnRunning(false)
    await Promise.resolve()

    expect(agentTurn.running).toBe(false)
    expect(agentTurn.paused).toBe(true)
    expect(released).toBe(false)

    resumeTurn('feedback-note')
    expect(await waiting).toBe(true)
    expect(agentTurn.paused).toBe(false)
    setTurnRunning(false)
  })

  test('collects a whole step before deciding whether its action may proceed', () => {
    resetStepFeedbackSession()
    const note = {
      id: 'step-note',
      originStep: 3,
      originChunk: 2,
      topic: 'card-density',
      relationship: 'alignment' as const,
      representation: { type: 'text' as const },
      representationGoal: 'Confirm card density.',
      text: 'The cards will use compact spacing.',
      cueSegments: [],
      nodeId: null,
      evidenceFromReasoning: 'I will tighten the card spacing.',
      propositionIds: ['compact-layout']
    }
    expect(recordFeedbackReasoning(3, 1, 'I will arrange the cards.')).toBe(true)
    expect(recordFeedbackReasoning(3, 2, 'I will tighten the card spacing.')).toBe(true)
    recordFeedbackOutcome(note, [])
    const accepted = takeStepFeedbackResult(3)
    expect(accepted.reasoningChunks.map((chunk) => chunk.chunk)).toEqual([1, 2])
    expect(hasExplicitStepFeedback(accepted)).toBe(false)

    recordFeedbackOutcome(note, [
      {
        id: 'feedback-1',
        noteId: note.id,
        topic: note.topic,
        noteContext: {
          cue: note.text,
          representationGoal: note.representationGoal,
          relationship: note.relationship,
          reasoningEvidence: note.evidenceFromReasoning,
          propositionIds: [...note.propositionIds]
        },
        selection: { type: 'text', text: 'compact', source: 'cue', start: 19, end: 26 },
        feedback: 'Keep analytics cards separate.',
        createdAt: 1
      }
    ])
    const corrected = takeStepFeedbackResult(3)
    expect(hasExplicitStepFeedback(corrected)).toBe(true)
    const report = renderStepFeedbackReport(corrected, 'Create three cards')
    expect(report).toContain("none of that step's tool calls were executed")
    expect(report).toContain('Keep analytics cards separate.')
    expect(report).toContain('Interactive feedback is disabled for this retry')
  })

  test('suppresses feedback notes until the retried step completes an action', () => {
    resetStepFeedbackSession()
    beginFeedbackReplay(4)
    expect(currentFeedbackReplayStep()).toBe(4)
    expect(interactiveFeedbackStep(4)).toBeNull()
    expect(recordFeedbackReasoning(4, 1, 'Retry reasoning')).toBe(false)
    expect(completeFeedbackReplay()).toBe(4)
    expect(currentFeedbackReplayStep()).toBeNull()
    expect(completeFeedbackReplay()).toBeNull()
    expect(interactiveFeedbackStep(5)).toBe(5)
  })

  test('drafts editable feedback without treating selection as approval', () => {
    expect(FEEDBACK_DRAFT_SYSTEM).toContain(
      'a mark signals attention rather than approval or disapproval'
    )
    expect(FEEDBACK_DRAFT_SYSTEM).toContain('at most 25 words')
  })

  test('retrieves confirmed feedback with its note context', () => {
    const history = createConfirmedFeedbackHistory()
    const note = {
      id: 'draft-note',
      originStep: 1,
      originChunk: 1,
      topic: 'card-density',
      relationship: 'alignment' as const,
      representation: { type: 'text' as const },
      representationGoal: 'Learn the intended card density.',
      text: 'The cards are becoming compact.',
      cueSegments: [],
      nodeId: null,
      evidenceFromReasoning: 'I will reduce the gaps.',
      propositionIds: ['compact-layout']
    }
    history.remember(
      note,
      { type: 'text', text: 'compact', source: 'cue', start: 23, end: 30 },
      'Keep the groups distinguishable.'
    )
    const previous = history.relevant(note)
    expect(previous).toHaveLength(1)
    expect(previous[0]?.noteContext.reasoningEvidence).toBe('I will reduce the gaps.')
    expect(previous[0]?.feedback).toBe('Keep the groups distinguishable.')
    expect(createConfirmedFeedbackHistory().relevant(note)).toEqual([])
    const prompt = renderFeedbackDraftPrompt({
      note,
      selection: { type: 'text', text: 'compact', source: 'cue', start: 23, end: 30 },
      propositions: [],
      previousFeedback: previous,
      hasOverviewImage: false,
      hasAnnotatedImage: false
    })
    expect(prompt).toContain('Note context: The cards are becoming compact.')
    expect(prompt).toContain('Confirmed feedback: Keep the groups distinguishable.')
  })

  test('offers one tool for each relationship', () => {
    expect(Object.keys(FEEDBACK_NOTE_TOOLS)).toEqual([
      'create_alignment_feedback_note',
      'create_conflict_feedback_note',
      'create_uncovered_feedback_note'
    ])
    expect(FEEDBACK_NOTE_SYSTEM).toContain('Never call more than one tool')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('Do not call a tool when')
  })

  test('chooses exactly one of three representations', () => {
    expect(FEEDBACK_NOTE_SYSTEM).toContain('Choose exactly one representation_type')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('text: the decision concerns workflow')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('code-visual: the decision concerns a visually')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('prefer code-visual even if')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('Do not use text merely because it is easier')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('artifact: one concrete UI')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('spectrum: a continuous degree')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('Do not default to comparison')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('image: illustration')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('Never combine primary representations')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('Do not choose image for a diagram')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('at most 30 words')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('It is not necessarily a question')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('annotation instruction')
    expect(FEEDBACK_NOTE_SYSTEM).toContain('Do not default to yes/no')
  })

  test('rejects mixed representation payloads', () => {
    const base = {
      topic: 'workflow',
      representation_type: 'text',
      code_visual_type: null,
      code_visual_brief: null,
      image_type: null,
      image_prompt: null,
      representation_goal: 'Learn the expected workflow.',
      cue_segments: [
        {
          text: 'Working assumption: build the shell first.',
          source: 'reasoning',
          evidence_quote: 'I will build the shell first.',
          proposition_id: null
        }
      ],
      node_id: null,
      evidence_from_reasoning: 'I will build the shell first.',
      proposition_ids: []
    }
    const input = {
      id: 'n1',
      relation: 'uncovered' as const,
      reasoning: 'I will build the shell first.',
      propositions: [],
      originStep: 1,
      originChunk: 1
    }
    expect(readFeedbackNote({ ...input, value: base })?.representation.type).toBe('text')
    expect(
      readFeedbackNote({ ...input, value: { ...base, image_prompt: 'An unused image prompt' } })
    ).toBeNull()
  })

  test('parses a code visual as a brief awaiting composition', () => {
    const note = readFeedbackNote({
      id: 'n2',
      value: {
        topic: 'button-padding',
        representation_type: 'code-visual',
        code_visual_type: 'comparison',
        code_visual_brief: {
          subject: 'Three hierarchy buttons',
          decision: 'Whether vertical padding should increase',
          alternatives: [
            { label: 'Current', description: '10px vertical padding' },
            { label: 'Proposed', description: '12px vertical padding' }
          ],
          must_show: ['Keep width and typography identical', 'Show only padding changing'],
          format_hint: 'html'
        },
        image_type: null,
        image_prompt: null,
        representation_goal: 'Learn the preferred button density.',
        cue_segments: [
          {
            text: 'Mark where the increased padding feels excessive.',
            source: 'reasoning',
            evidence_quote: 'Increase vertical padding from 10 to 12.',
            proposition_id: null
          }
        ],
        node_id: '0:3',
        evidence_from_reasoning: 'Increase vertical padding from 10 to 12.',
        proposition_ids: []
      },
      relation: 'uncovered',
      reasoning: 'Increase vertical padding from 10 to 12.',
      propositions: [],
      originStep: 2,
      originChunk: 1
    })
    expect(note?.representation.type).toBe('code-visual')
    if (note?.representation.type !== 'code-visual') return
    expect(note.representation.status).toBe('loading')
    expect(note.representation.brief.alternatives).toHaveLength(2)
  })

  test('allows one artifact without manufacturing alternatives', () => {
    const note = readFeedbackNote({
      id: 'n-artifact',
      value: {
        topic: 'hero-balance',
        representation_type: 'code-visual',
        code_visual_type: 'artifact',
        code_visual_brief: {
          subject: 'Proposed portfolio hero',
          decision: 'Which region should change to improve visual balance',
          alternatives: [],
          must_show: ['Heading', 'supporting copy', 'primary action'],
          format_hint: 'html'
        },
        image_type: null,
        image_prompt: null,
        representation_goal: 'Learn which part of the proposed hierarchy needs adjustment.',
        cue_segments: [
          {
            text: 'Mark where headline dominance should change.',
            source: 'reasoning',
            evidence_quote: 'I will make the heading the dominant element.',
            proposition_id: null
          }
        ],
        node_id: null,
        evidence_from_reasoning: 'I will make the heading the dominant element.',
        proposition_ids: []
      },
      relation: 'uncovered',
      reasoning: 'I will make the heading the dominant element.',
      propositions: [],
      originStep: 2,
      originChunk: 1
    })
    expect(note?.representation.type).toBe('code-visual')
    if (note?.representation.type !== 'code-visual') return
    expect(note.representation.visualType).toBe('artifact')
    expect(note.representation.brief.alternatives).toEqual([])
  })

  test('preserves phrase-level reasoning and proposition provenance', () => {
    const reasoning = 'I will make typography the dominant hero element.'
    const proposition = {
      id: 'text-first',
      text: 'Prefers textual content to dominate over imagery.',
      confidence: 0.82,
      rationale: 'Text makes the intended message immediately legible.',
      shownToAgent: true
    }
    const note = readFeedbackNote({
      id: 'n-provenance',
      value: {
        topic: 'hero-text-priority',
        representation_type: 'text',
        code_visual_type: null,
        code_visual_brief: null,
        image_type: null,
        image_prompt: null,
        representation_goal: 'Expose why the hero is becoming text-led.',
        cue_segments: [
          {
            text: 'Typography leads the hero',
            source: 'reasoning',
            evidence_quote: reasoning,
            proposition_id: null
          },
          {
            text: 'in line with',
            source: 'neutral',
            evidence_quote: null,
            proposition_id: null
          },
          {
            text: 'your established text-first direction.',
            source: 'proposition',
            evidence_quote: null,
            proposition_id: proposition.id
          }
        ],
        node_id: null,
        evidence_from_reasoning: reasoning,
        proposition_ids: [proposition.id]
      },
      relation: 'alignment',
      reasoning,
      propositions: [proposition],
      originStep: 3,
      originChunk: 1
    })
    expect(note?.text).toBe(
      'Typography leads the hero in line with your established text-first direction.'
    )
    expect(note?.cueSegments[0]).toEqual({
      text: 'Typography leads the hero',
      source: 'reasoning',
      evidenceQuote: reasoning
    })
    expect(note?.cueSegments[2]).toEqual({
      text: 'your established text-first direction.',
      source: 'proposition',
      propositionId: proposition.id,
      propositionText: proposition.text,
      propositionConfidence: proposition.confidence,
      propositionRationale: proposition.rationale
    })
  })

  test('repairs a paraphrased cue anchor with exact top-level reasoning evidence', () => {
    const reasoning = 'I will keep the itinerary focused on three nearby regions.'
    const note = readFeedbackNote({
      id: 'n-repaired-anchor',
      value: {
        topic: 'itinerary-scope',
        representation_type: 'text',
        code_visual_type: null,
        code_visual_brief: null,
        image_type: null,
        image_prompt: null,
        representation_goal: 'Confirm how geographically focused the itinerary should be.',
        cue_segments: [
          {
            text: 'The itinerary stays focused on three nearby regions.',
            source: 'reasoning',
            evidence_quote: 'The itinerary will focus on three nearby regions.',
            proposition_id: null
          }
        ],
        node_id: null,
        evidence_from_reasoning: reasoning,
        proposition_ids: []
      },
      relation: 'uncovered',
      reasoning,
      propositions: [],
      originStep: 1,
      originChunk: 1
    })

    expect(note?.cueSegments[0]).toEqual({
      text: 'The itinerary stays focused on three nearby regions.',
      source: 'reasoning',
      evidenceQuote: reasoning
    })
  })

  test('puts representation history and reasoning in the prompt', () => {
    const prompt = renderFeedbackNotePrompt({
      request: 'Make a dashboard',
      plan: 'Build the shell first',
      reasoning: 'I will use equal-width cards.',
      propositions: [
        {
          id: 'equal-cards',
          text: 'Prefers equal visual weight.',
          confidence: 0.8,
          rationale: 'Makes comparison easier.',
          shownToAgent: true
        }
      ],
      canvas: '(empty)',
      actions: [],
      previousNotes: [
        {
          id: 'n1',
          topic: 'layout-first-workflow',
          relationship: 'alignment',
          representationType: 'code-visual',
          representationSubtype: 'flow',
          representationGoal: 'Verify whether rough structure should precede details.',
          text: 'Rough layout before details',
          nodeId: '0:3',
          evidenceFromReasoning: 'I will sketch the layout first.',
          propositionIds: ['equal-cards'],
          status: 'answered',
          outcome: {
            resolution: 'explicit-feedback',
            selections: ['Compact alternative (compact)'],
            feedback: ['Use compact cards so more information remains visible.']
          }
        }
      ]
    })
    expect(prompt).toContain('I will use equal-width cards.')
    expect(prompt).toContain('representation: code-visual/flow')
    expect(prompt).toContain('Compact alternative (compact)')
    expect(prompt).toContain('Use compact cards so more information remains visible.')
    expect(FEEDBACK_NOTE_SYSTEM).toContain(
      "resolving a primary control's accent does not automatically resolve a secondary or tertiary control's treatment"
    )
    expect(FEEDBACK_NOTE_SYSTEM).toContain(
      'A more specific application of an answer is not a new user-model question'
    )
  })

  test('accepts freely composed SVG in the canonical centered viewport', () => {
    const svg = sanitizeCodeVisualSvg(COMPARISON_SVG)
    expect(svg).not.toBeNull()
    expect(svg).toContain('viewBox="0 0 720 440"')
    expect(svg).toContain('Outline')
    expect(svg).toContain('Solid')
    expect(svg).toContain('width="720" height="440"')
    expect(svg).not.toContain('fill="#FCFAF5"')
    const compact = sanitizeCodeVisualSvg(
      '<svg viewBox="0 0 720 180"><rect x="48" y="24" width="624" height="132" /></svg>'
    )
    expect(compact).toContain('width="720" height="180"')
    expect(compact).toContain('viewBox="0 0 720 180"')
  })

  test('rejects executable or externally loaded SVG', () => {
    expect(sanitizeCodeVisualSvg('<svg><script>alert(1)</script></svg>')).toBeNull()
    expect(
      sanitizeCodeVisualSvg('<svg><image href="https://example.com/a.png" /></svg>')
    ).toBeNull()
    expect(sanitizeCodeVisualSvg('<svg><rect onclick="alert(1)" /></svg>')).toBeNull()
    expect(inspectCodeVisualSvg('<svg><script>alert(1)</script></svg>').rejection).toBe(
      'forbidden-tag:script'
    )
    expect(
      sanitizeCodeVisualSvg(
        '<svg viewBox="0 0 720 160"><foreignObject x="20" y="20" width="200" height="80"><div xmlns="http://www.w3.org/1999/xhtml">Wrapped label</div></foreignObject></svg>'
      )
    ).not.toBeNull()
    const svg = sanitizeCodeVisualSvg(COMPARISON_SVG)
    expect(svg ? codeVisualSvgToUrl(svg) : null).toStartWith('data:image/svg+xml')
  })

  test('composes sandbox-ready HTML without executable content', () => {
    expect(Object.keys(CODE_VISUAL_TOOLS)).toEqual([
      'render_code_visual_html',
      'render_code_visual_svg'
    ])
    const srcdoc = sanitizeCodeVisualHtml(
      '<section class="comparison"><button>Current</button><button>Proposed</button></section>',
      '.comparison{display:flex;gap:24px}button{padding:12px 20px}'
    )
    expect(srcdoc).toContain('class="code-visual-root"')
    expect(srcdoc).toContain('display:flex')
    expect(srcdoc).toContain('background:transparent')
    expect(srcdoc).not.toContain('min-height:440px')
    expect(sanitizeCodeVisualHtml('<article><small>Label</small></article>', '')).not.toBeNull()
    expect(sanitizeCodeVisualHtml('<script>alert(1)</script>', '')).toBeNull()
    expect(inspectCodeVisualHtml('<input type="color">', '').rejection).toBe('forbidden-tag:input')
    expect(CODE_VISUAL_SYSTEM).toContain('Use CSS layout rather than manual absolute coordinates')
    expect(CODE_VISUAL_SYSTEM).toContain('data-feedback-id')
    const interactive = buildInteractiveCodeVisualDocument({
      format: 'html',
      content: srcdoc ?? '',
      noteId: 'n1',
      targets: [{ id: 'current-layout', label: 'Current layout' }]
    })
    expect(interactive).toContain('ResizeObserver')
    expect(interactive).toContain('feedback-note-code-visual-size')
    expect(interactive).toContain('"noteId":"n1"')
    expect(interactive).not.toContain('Math.max(440')
    expect(
      renderCodeVisualComposerPrompt({
        visualType: 'comparison',
        feedbackCue: 'Mark where the buttons feel too dense.',
        goal: 'Learn the preferred density.',
        brief: {
          subject: 'Buttons',
          decision: 'Vertical padding',
          alternatives: [
            { label: 'Current', description: '10px' },
            { label: 'Proposed', description: '12px' }
          ],
          mustShow: ['Only padding changes'],
          formatHint: 'html'
        }
      })
    ).toContain('Only padding changes')
  })

  test('forces a deterministic composer tool for each visual type', () => {
    expect(codeVisualToolName('flow')).toBe('render_code_visual_svg')
    for (const visualType of [
      'artifact',
      'spectrum',
      'comparison',
      'palette',
      'wireframe'
    ] as const) {
      expect(codeVisualToolName(visualType)).toBe('render_code_visual_html')
    }
  })

  test('builds an image-generation prompt only for expressive imagery', () => {
    const prompt = buildFeedbackNoteImagePrompt(
      'A quiet studio with diffused morning light.',
      'scene',
      'Learn which atmosphere should guide later visuals.'
    )
    expect(prompt).toContain('Image type:\nscene')
    expect(prompt).toContain('diffused morning light')
    expect(prompt).toContain('Learn which atmosphere')
  })
})
