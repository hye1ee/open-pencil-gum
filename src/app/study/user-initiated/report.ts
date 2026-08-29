import type { ReasoningFeedbackOutcome } from '@/app/study/user-initiated/reasoning-review'

export function renderReasoningFeedbackReport(
  input: ReasoningFeedbackOutcome | readonly ReasoningFeedbackOutcome[]
): string {
  const outcomes = Array.isArray(input) ? input : [input]
  const first = outcomes[0]
  const request = first?.review.request ?? ''
  const feedback = outcomes
    .map((outcome, index) => {
      const target = outcome.selectedReasoning
        ? `Selected reasoning: ${outcome.selectedReasoning}`
        : 'Feedback target: the reasoning checkpoint as a whole'
      return `Feedback ${index + 1}
Reasoning checkpoint:
${outcome.review.text}

Reasoning so far at this checkpoint:
${outcome.review.reasoningSoFar}

${target}

User feedback: ${outcome.feedback}`
    })
    .join('\n\n')

  return `The user reviewed an in-progress reasoning checkpoint and provided feedback.

Original request: ${request}

${feedback}

Discard any action, tool result, or answer derived from the earlier reasoning. Perform the original request again with this feedback incorporated.`
}
