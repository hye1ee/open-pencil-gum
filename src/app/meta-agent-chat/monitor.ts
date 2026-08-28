import { logChatMetaAgentReasoning, logChatMetaAgentReview } from '@/app/ai/chat/agent-log'
import { readFeedbackNote } from '@/app/feedback-note/parse'
import type { ChatReasoningObserver } from '@/app/meta-agent-chat/types'
import { createSequencedReasoningObserver } from '@/app/meta-agent/core/reasoning-observer'
import { runMetaAgent } from '@/app/meta-agent/core/runtime'
import type { MetaAgentDecision, MetaAgentRuntimeInput } from '@/app/meta-agent/core/runtime'
import type { FeedbackNote } from '@/app/meta-agent/core/types'
import {
  CHAT_FEEDBACK_NOTE_SYSTEM,
  renderChatFeedbackNotePrompt
} from '@/app/meta-agent/domains/chat/prompt'
import {
  buildLenChatFeedbackNoteInput,
  type LenChatMetaAgentContext
} from '@/app/meta-agent/hosts/lenchat/input'

interface ChatReviewContext extends LenChatMetaAgentContext {
  generation: number
}

export interface ChatMetaAgentReview {
  streamId: number
  chunkIndex: number
  reasoning: string
  decision: MetaAgentDecision | null
  note: FeedbackNote | null
}

interface ChatMonitorOptions {
  getContext(): LenChatMetaAgentContext
  onReasoningChunk(streamId: number, chunkIndex: number, chunk: string): void
  run?(input: MetaAgentRuntimeInput): Promise<MetaAgentDecision[]>
  onActivity?(active: boolean): void
  onReviewActivity?(active: boolean): void
  onNote?(note: FeedbackNote): void
  onSettled?(streamId: number): void
  onReview?(review: ChatMetaAgentReview): void
}

export interface ChatMonitorController {
  observer: ChatReasoningObserver
  reset(): void
}

interface LoggedDecisionFields {
  topic: string
  representation: string
  evidence: string
  propositionIds: string[]
}

interface RawLoggedDecision {
  topic?: unknown
  representation_type?: unknown
  evidence_from_reasoning?: unknown
  proposition_ids?: unknown
}

function readText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function readDecisionFields(payload: unknown): LoggedDecisionFields {
  if (typeof payload !== 'object' || payload === null) {
    return { topic: '(invalid)', representation: '(invalid)', evidence: '', propositionIds: [] }
  }
  const row = payload as RawLoggedDecision
  const propositionIds = Array.isArray(row.proposition_ids)
    ? row.proposition_ids.filter((value): value is string => typeof value === 'string')
    : []
  return {
    topic: readText(row.topic, 80) || '(missing)',
    representation: readText(row.representation_type, 40) || '(missing)',
    evidence: readText(row.evidence_from_reasoning, 160),
    propositionIds
  }
}

function decisionDetail(decision: MetaAgentDecision): string {
  const fields = readDecisionFields(decision.payload)
  return (
    `${decision.relationship}/${fields.representation}` +
    `  topic=${fields.topic}` +
    `  evidence=${JSON.stringify(fields.evidence)}` +
    `  propositions=${fields.propositionIds.join(',') || 'none'}`
  )
}

/**
 * Runs the shared Meta Agent for every LenChat reasoning delta. The monitor
 * validates host-neutral decisions and publishes Notes; the conversation host
 * owns UI state, output gating, feedback aggregation, and retry behavior.
 */
export function createChatMonitor(options: ChatMonitorOptions): ChatMonitorController {
  let generation = 1
  const activeStreams = new Set<number>()
  const chunkCounts = new Map<number, number>()
  const run = options.run ?? runMetaAgent
  const controller = createSequencedReasoningObserver<ChatReviewContext>({
    begin: () => {
      const context = options.getContext()
      return {
        ...context,
        messages: [...context.messages],
        propositions: [...context.propositions],
        completedActions: [...context.completedActions],
        previousNotes: context.previousNotes ? [...context.previousNotes] : undefined,
        generation
      }
    },
    review: async ({ context, streamId, chunkIndex, reasoningChunk }) => {
      options.onReviewActivity?.(true)
      logChatMetaAgentReasoning(streamId, chunkIndex, reasoningChunk)
      try {
        const latestContext = options.getContext()
        const input = buildLenChatFeedbackNoteInput({
          ...context,
          previousNotes: latestContext.previousNotes,
          reasoning: reasoningChunk
        })
        const decisions = await run({
          system: CHAT_FEEDBACK_NOTE_SYSTEM,
          prompt: renderChatFeedbackNotePrompt(input)
        })
        if (context.generation !== generation) return
        const decision = decisions.at(0) ?? null
        let invalidReason = ''
        const note = decision
          ? readFeedbackNote({
              id: crypto.randomUUID(),
              value: decision.payload,
              relation: decision.relationship,
              reasoning: reasoningChunk,
              propositions: [...input.propositions],
              originStep: streamId,
              originChunk: chunkIndex,
              onInvalid: (reason) => {
                invalidReason = reason
              }
            })
          : null
        const knownTopics = new Set(
          (latestContext.previousNotes ?? []).map((item) => item.topic.toLowerCase())
        )
        const acceptedNote = note && !knownTopics.has(note.topic.toLowerCase()) ? note : null
        if (acceptedNote && decision) {
          logChatMetaAgentReview(streamId, chunkIndex, 'decision', decisionDetail(decision))
          options.onNote?.(acceptedNote)
        } else if (decision && !note) {
          logChatMetaAgentReview(
            streamId,
            chunkIndex,
            'failed',
            `${invalidReason || 'invalid feedback-note payload'}  ${decisionDetail(decision)}`
          )
        } else {
          logChatMetaAgentReview(streamId, chunkIndex, 'skip')
        }
        options.onReview?.({
          streamId,
          chunkIndex,
          reasoning: reasoningChunk,
          decision: acceptedNote ? decision : null,
          note: acceptedNote
        })
      } catch (error) {
        if (context.generation !== generation) return
        const detail = error instanceof Error ? error.message : String(error)
        logChatMetaAgentReview(streamId, chunkIndex, 'failed', detail.slice(0, 240))
        console.warn('[meta-agent-chat] review failed:', error)
      } finally {
        options.onReviewActivity?.(false)
      }
    }
  })

  const observer: ChatReasoningObserver = {
    start: (streamId) => {
      activeStreams.add(streamId)
      chunkCounts.set(streamId, 0)
      options.onActivity?.(true)
      controller.observer.start(streamId)
    },
    chunk: (streamId, reasoningChunk, reasoningSoFar) => {
      if (reasoningChunk.trim() !== '') {
        const chunkIndex = (chunkCounts.get(streamId) ?? 0) + 1
        chunkCounts.set(streamId, chunkIndex)
        options.onReasoningChunk(streamId, chunkIndex, reasoningChunk)
      }
      controller.observer.chunk(streamId, reasoningChunk, reasoningSoFar)
    },
    end: (streamId, reasoning) => {
      controller.observer.end(streamId, reasoning)
      const endingGeneration = generation
      void controller.observer.settled(streamId).then(() => {
        if (endingGeneration !== generation) return
        activeStreams.delete(streamId)
        chunkCounts.delete(streamId)
        options.onSettled?.(streamId)
        options.onActivity?.(activeStreams.size > 0)
      })
    },
    settled: controller.observer.settled
  }

  return {
    observer,
    reset: () => {
      generation++
      activeStreams.clear()
      chunkCounts.clear()
      options.onActivity?.(false)
      options.onReviewActivity?.(false)
      controller.reset()
    }
  }
}
