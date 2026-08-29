import { valibotSchema } from '@ai-sdk/valibot'
import { tool } from 'ai'
import * as v from 'valibot'

import type { AskUserSession } from '@/app/study/ask-user/session'

const text = v.pipe(v.string(), v.minLength(1))

const inputSchema = valibotSchema(
  v.object({
    question: text,
    options: v.pipe(v.array(text), v.length(3))
  })
)

export function createAskUserTool(session: AskUserSession) {
  return tool({
    description:
      'Ask the user one concise question with exactly three suggested answers, then wait for the answer before continuing this request.',
    inputSchema,
    execute: (input) => session.ask(input)
  })
}
