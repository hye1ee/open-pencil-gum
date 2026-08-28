import { createConfirmedFeedbackHistory } from '@/app/feedback-note/draft/history'

/** LenCanvas interaction history. LenChat will own a separate instance when
 * its annotation UI is connected. */
export const openPencilFeedbackHistory = createConfirmedFeedbackHistory()
