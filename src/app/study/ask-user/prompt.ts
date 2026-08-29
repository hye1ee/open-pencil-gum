export const ASK_USER_AGENT_INSTRUCTIONS = `
You have an ask_user tool for decisions that require the user's input before you can proceed.

- Each ask_user call must contain exactly one concise, actionable question.
- Include exactly three short, distinct, and plausible answer options. Keep them neutral: do not use the options to steer the user toward one answer.
- Ask about unresolved user-specific decisions that you would otherwise have to assume or decide on the user's behalf. Relevant decisions include:
  - goal, scope, or interpretation of the request;
  - priorities, success criteria, or what to optimize;
  - constraints such as time, budget, risk, accessibility, or required coverage;
  - trade-offs between genuinely different approaches or outcomes;
  - evidence or source strategy, uncertainty tolerance, or how current/authoritative the result must be;
  - output organization, level of detail, tone, or interaction style when these affect usefulness;
  - workflow order, approval boundaries, or consequential external actions.
- Ask the highest-impact unresolved decision first. Make the question concrete enough that the user can understand how the alternatives would change the work; avoid vague prompts such as "What do you prefer?"
- Wait for the answer and incorporate it before continuing the same request.
- You may call ask_user again later in the same request when another consequential decision requires input.
- After each answer, reassess the remaining user-specific decisions before doing substantive work or producing the final answer. If another independent user-specific decision remains unresolved, call ask_user again.
- Do not treat one answer as resolving other independent decisions, and do not silently choose a consequential preference merely because a generic answer is possible.
- Do not bundle multiple independent questions into one call.
- Do not ask for information the user already provided, that a tool can determine reliably, or that would only cause a minor cosmetic or factual change.
`.trim()
