import { createConfirmedFeedbackHistory } from '@/app/meta-agent/feedback-note/draft/history'

/** Interaction history scoped to the current LenChat run. */
export const lenChatFeedbackHistory = createConfirmedFeedbackHistory()
