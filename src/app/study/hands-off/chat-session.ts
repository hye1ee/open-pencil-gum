import { readonly, shallowRef } from 'vue'
import type { DeepReadonly, ShallowRef } from 'vue'

import {
  logHandsOffAnnotation,
  logHandsOffPhase,
  logHandsOffRunSummary
} from '@/app/ai/chat/agent-log'
import type { ReasoningObserver } from '@/app/meta-agent/core/reasoning-observer'
import {
  countAnnotationsByPolarity,
  describeTextSelectionAnnotationForLog
} from '@/app/study/hands-off/annotation'
import type {
  HandsOffAnnotationPolarity,
  HandsOffTextSelectionAnnotation
} from '@/app/study/hands-off/annotation'

export type HandsOffChatPhase =
  | 'idle'
  | 'agent-running'
  | 'annotating-reasoning'
  | 'annotating-final-answer'
  | 'completed'

export interface HandsOffReasoningBlock {
  id: string
  streamId: number
  chunkIndex: number
  text: string
}

export interface HandsOffChatTextSelection {
  streamId: number
  chunkIndex: number
  selectedText: string
  startOffset: number
  endOffset: number
  polarity: HandsOffAnnotationPolarity
}

export interface HandsOffChatSession {
  phase: DeepReadonly<ShallowRef<HandsOffChatPhase>>
  reasoningBlocks: DeepReadonly<ShallowRef<HandsOffReasoningBlock[]>>
  annotations: DeepReadonly<ShallowRef<HandsOffTextSelectionAnnotation[]>>
  finalAnswerText: DeepReadonly<ShallowRef<string>>
  /** Passive collector: records reasoning chunks and never holds the turn. */
  observer: ReasoningObserver
  beginRun(request: string): void
  completeAgentRun(): void
  addAnnotation(selection: HandsOffChatTextSelection): void
  finishReasoningAnnotation(finalAnswerText: string): void
  finishFinalAnswerAnnotation(): void
  isAnnotationPending(): boolean
  reset(): void
}

/**
 * LenChat hands-off delegation state. The agent runs to completion untouched;
 * the participant then reviews the collected reasoning and, after that, the
 * revealed final answer, marking liked/disliked spans. Everything recorded
 * here is measurement only.
 */
export function createHandsOffChatSession(): HandsOffChatSession {
  const phase = shallowRef<HandsOffChatPhase>('idle')
  const reasoningBlocks = shallowRef<HandsOffReasoningBlock[]>([])
  const annotations = shallowRef<HandsOffTextSelectionAnnotation[]>([])
  const finalAnswerText = shallowRef('')
  const chunkCounts = new Map<number, number>()
  let annotationSequence = 0

  const observer: ReasoningObserver = {
    start: (streamId) => {
      chunkCounts.set(streamId, 0)
    },
    chunk: (streamId, reasoningChunk) => {
      if (phase.value !== 'agent-running') return
      const text = reasoningChunk.trim()
      if (!text) return
      const chunkIndex = (chunkCounts.get(streamId) ?? 0) + 1
      chunkCounts.set(streamId, chunkIndex)
      reasoningBlocks.value = [
        ...reasoningBlocks.value,
        { id: `hands-off-reasoning-${streamId}-${chunkIndex}`, streamId, chunkIndex, text }
      ]
    },
    end: () => undefined,
    settled: async () => undefined
  }

  const logSummary = (): void => {
    const reasoning = countAnnotationsByPolarity(annotations.value, 'reasoning')
    const finalOutput = countAnnotationsByPolarity(annotations.value, 'final-output')
    logHandsOffRunSummary(
      `host=lenchat reasoning-blocks=${reasoningBlocks.value.length}` +
        ` reasoning-liked=${reasoning.liked} reasoning-disliked=${reasoning.disliked}` +
        ` final-output-liked=${finalOutput.liked} final-output-disliked=${finalOutput.disliked}`
    )
  }

  return {
    phase: readonly(phase),
    reasoningBlocks: readonly(reasoningBlocks),
    annotations: readonly(annotations),
    finalAnswerText: readonly(finalAnswerText),
    observer,
    beginRun: (request) => {
      phase.value = 'agent-running'
      reasoningBlocks.value = []
      annotations.value = []
      finalAnswerText.value = ''
      chunkCounts.clear()
      annotationSequence = 0
      logHandsOffPhase(`agent-running request="${request.trim()}"`)
    },
    completeAgentRun: () => {
      if (phase.value !== 'agent-running') return
      phase.value = 'annotating-reasoning'
      logHandsOffPhase(`annotating-reasoning blocks=${reasoningBlocks.value.length}`)
    },
    addAnnotation: (selection) => {
      if (phase.value !== 'annotating-reasoning' && phase.value !== 'annotating-final-answer') {
        return
      }
      annotationSequence += 1
      const annotation: HandsOffTextSelectionAnnotation = {
        id: `hands-off-annotation-${annotationSequence}`,
        phase: phase.value === 'annotating-reasoning' ? 'reasoning' : 'final-output',
        streamId: selection.streamId,
        chunkIndex: selection.chunkIndex,
        stepNumber: null,
        selectedText: selection.selectedText,
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
        polarity: selection.polarity,
        createdAt: Date.now()
      }
      annotations.value = [...annotations.value, annotation]
      logHandsOffAnnotation(`host=lenchat ${describeTextSelectionAnnotationForLog(annotation)}`)
    },
    finishReasoningAnnotation: (answerText) => {
      if (phase.value !== 'annotating-reasoning') return
      finalAnswerText.value = answerText
      phase.value = 'annotating-final-answer'
      logHandsOffPhase('annotating-final-answer')
    },
    finishFinalAnswerAnnotation: () => {
      if (phase.value !== 'annotating-final-answer') return
      phase.value = 'completed'
      logHandsOffPhase('completed')
      logSummary()
    },
    isAnnotationPending: () =>
      phase.value === 'annotating-reasoning' || phase.value === 'annotating-final-answer',
    reset: () => {
      phase.value = 'idle'
      reasoningBlocks.value = []
      annotations.value = []
      finalAnswerText.value = ''
      chunkCounts.clear()
      annotationSequence = 0
    }
  }
}
