import { Chat } from '@ai-sdk/vue'
import type { ChatStatus, UIMessage } from 'ai'
import { computed, markRaw, ref, shallowRef } from 'vue'

import {
  logFeedbackNoteCode,
  logFeedbackNoteImage,
  logAskUserLifecycle,
  logChatFeedbackLifecycle,
  logChatToolActions,
  logMetaAgentLifecycle,
  logRunStart,
  logStudyRuntime,
  logUserModelFeedback
} from '@/app/ai/chat/agent-log'
import { lastUserRequest, messageText, titleFrom } from '@/app/conversation/message'
import type { ConversationToolId } from '@/app/conversation/settings'
import {
  deleteConversation,
  listConversations,
  loadConversation,
  saveConversation
} from '@/app/conversation/storage'
import { createConversationTransport } from '@/app/conversation/transport'
import type {
  ConversationFeedbackItem,
  ConversationFeedbackNote,
  ConversationReasoningChunk,
  ConversationRecord
} from '@/app/conversation/types'
import { conversationFeedbackBatch } from '@/app/conversation/user-model'
import { NOOP_REASONING_OBSERVER } from '@/app/meta-agent/core/reasoning-observer'
import type { FeedbackNote, FeedbackNoteHistoryItem } from '@/app/meta-agent/core/types'
import {
  copyFeedbackSelection,
  feedbackSelectionLabel
} from '@/app/meta-agent/feedback-note/draft/selection'
import { FEEDBACK_NOTE_REPRESENTATION_PROVIDER } from '@/app/meta-agent/feedback-note/representation'
import { lenChatFeedbackHistory } from '@/app/meta-agent/hosts/lenchat/feedback-note/history'
import { ChatTurnGate } from '@/app/meta-agent/hosts/lenchat/gate'
import { createChatMonitor } from '@/app/meta-agent/hosts/lenchat/monitor'
import { AskUserSession, formatAskUserLifecycleEvent } from '@/app/study/ask-user'
import type { AskUserQuestion } from '@/app/study/ask-user'
import { createHandsOffChatSession } from '@/app/study/hands-off/chat-session'
import type { HandsOffChatTextSelection } from '@/app/study/hands-off/chat-session'
import { isHandsOffDelegationCondition } from '@/app/study/runtime'
import type { StudyRuntimeConfig } from '@/app/study/runtime'
import {
  createReasoningReviewSession,
  type ReasoningFeedbackOutcome
} from '@/app/study/user-initiated/reasoning-review'
import { renderReasoningFeedbackReport } from '@/app/study/user-initiated/report'
import { canUpdateUserModelFromFeedback } from '@/app/user-model/calls'
import { propositions as sharedPropositions } from '@/app/user-model/store'
import {
  clearUserModel as clearSharedUserModel,
  initializeUserModel,
  observeAskUserAnswers,
  observeFeedbackNotes,
  observeUserInitiatedFeedback
} from '@/app/user-model/use'
import { reasoningFeedbackBatch } from '@/app/user-model/user-initiated/batch'

interface ConversationStoreOptions {
  apiKey(): string
  modelId(): string
  enabledTools(): readonly ConversationToolId[]
  runtime(): StudyRuntimeConfig
}

export class ConversationStore {
  private readonly options: ConversationStoreOptions
  private readonly askUserSession: AskUserSession
  private readonly chatRef = shallowRef<Chat<UIMessage> | null>(null)
  private gate = new ChatTurnGate()
  private readonly reasoningReviewSession = createReasoningReviewSession({
    hold: () => this.gate.hold(),
    release: () => this.gate.resume()
  })
  private readonly handsOffSession = createHandsOffChatSession()
  private revisionFeedback: string | null = null
  private revisionRun = 0
  private revisionPending = false
  private reasoningRevisionScheduled = false
  private reasoningFeedbackOutcomes: ReasoningFeedbackOutcome[] = []
  private activeChatRequest: Promise<void> | null = null
  private preferenceUpdate: Promise<void> = Promise.resolve()
  private resetMetaAgentMonitor: () => void = () => undefined
  private feedbackNoteHistory: FeedbackNoteHistoryItem[] = []
  private createdAt = Date.now()

  readonly initialized = ref(false)
  readonly history = shallowRef<ConversationRecord[]>([])
  readonly currentId = ref<string>(crypto.randomUUID())
  readonly feedbackNotes = shallowRef<ConversationFeedbackNote[]>([])
  readonly propositions = sharedPropositions
  readonly monitorActive = ref(false)
  readonly feedbackGenerating = ref(false)
  readonly learning = ref(false)
  readonly revising = ref(false)
  readonly actions = ref<string[]>([])
  readonly reasoningChunks = shallowRef<ConversationReasoningChunk[]>([])
  readonly reasoningReviews = this.reasoningReviewSession.reviews
  readonly askUserQuestion = shallowRef<AskUserQuestion | null>(null)
  readonly handsOffPhase = this.handsOffSession.phase
  readonly handsOffReasoningBlocks = this.handsOffSession.reasoningBlocks
  readonly handsOffAnnotations = this.handsOffSession.annotations
  readonly handsOffFinalAnswerText = this.handsOffSession.finalAnswerText
  readonly handsOffAnnotationPending = computed(() => this.handsOffSession.isAnnotationPending())
  readonly lastError = ref('')

  readonly messages = computed(() => this.chatRef.value?.messages ?? [])
  readonly status = computed<ChatStatus>(() => this.chatRef.value?.status ?? 'ready')
  readonly error = computed(() => this.chatRef.value?.error)
  readonly running = computed(
    () => this.status.value === 'submitted' || this.status.value === 'streaming'
  )
  readonly configured = computed(() => this.options.apiKey().trim() !== '')
  readonly feedbackPending = computed(
    () =>
      this.feedbackNotes.value.some((note) => note.status === 'pending') ||
      this.reasoningReviewSession.hasPending()
  )

  constructor(options: ConversationStoreOptions) {
    this.options = options
    this.askUserSession = new AskUserSession({
      onEvent: (event) => logAskUserLifecycle(formatAskUserLifecycleEvent(event))
    })
    this.askUserSession.subscribe((snapshot) => {
      this.askUserQuestion.value = snapshot.pendingQuestion
    })
  }

  async initialize(): Promise<void> {
    const [history] = await Promise.all([listConversations(), initializeUserModel()])
    this.history.value = history
    const latest = history.at(0)
    if (latest) {
      this.currentId.value = latest.id
      this.createdAt = latest.createdAt
      this.buildChat(latest.messages)
    } else {
      this.buildChat([])
    }
    this.initialized.value = true
  }

  async send(text: string): Promise<void> {
    const clean = text.trim()
    if (!clean || !this.configured.value || this.feedbackPending.value) return
    await this.preferenceUpdate.catch(() => undefined)
    this.lastError.value = ''
    this.revisionRun += 1
    this.revising.value = false
    this.revisionPending = false
    this.reasoningRevisionScheduled = false
    this.reasoningFeedbackOutcomes = []
    this.actions.value = []
    this.reasoningChunks.value = []
    this.reasoningReviewSession.reset()
    this.reasoningReviewSession.setObserving(true)
    this.reasoningReviewSession.beginRequest(clean)
    this.feedbackNotes.value = []
    lenChatFeedbackHistory.reset()
    this.monitorActive.value = false
    this.feedbackGenerating.value = false
    this.resetMetaAgentMonitor()
    logRunStart(clean)
    const runtime = this.options.runtime()
    if (isHandsOffDelegationCondition(runtime.condition)) this.handsOffSession.beginRun(clean)
    const enabledTools = this.options.enabledTools()
    const activeTools = [...enabledTools, ...(runtime.askUserEnabled ? ['ask_user'] : [])]
    logStudyRuntime(runtime.host, runtime.condition)
    logMetaAgentLifecycle(
      `host=LenChat condition=${runtime.condition} mode=${runtime.metaAgentEnabled ? 'interactive-gate' : 'disabled'} propositions=${this.propositions.value.length} tools=${activeTools.join(',') || 'none'}`
    )
    const chat = this.chatRef.value
    if (!chat) return
    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: clean }]
    }
    if (runtime.askUserEnabled) this.askUserSession.beginRequest(userMessage.id)
    else this.askUserSession.endRequest('condition-disabled')
    const response = this.trackChatRequest(chat.sendMessage(userMessage))
    // Passing a complete UIMessage lets Chat append it before starting the
    // request. Save it now so Recent survives failed or interrupted generation.
    await this.checkpoint([...chat.messages])
    await response
    this.queueAskUserLearn(userMessage.id, clean)
  }

  async stop(): Promise<void> {
    this.gate.abandon()
    this.reasoningReviewSession.reset()
    this.handsOffSession.reset()
    this.reasoningRevisionScheduled = false
    this.reasoningFeedbackOutcomes = []
    this.feedbackNotes.value = []
    this.revisionRun += 1
    this.revisionPending = false
    this.revising.value = false
    this.resetMetaAgentMonitor()
    const stopping = this.chatRef.value?.stop()
    this.askUserSession.endRequest('request-stopped')
    await stopping
  }

  answerAskUser(answer: string, selectedOption: string | null = null): boolean {
    return this.askUserSession.answer(answer, selectedOption)
  }

  continueReasoningReview(reviewId: string): void {
    this.reasoningReviewSession.continueReview(reviewId)
  }

  addHandsOffAnnotation(selection: HandsOffChatTextSelection): void {
    this.handsOffSession.addAnnotation(selection)
  }

  finishHandsOffReasoningAnnotation(): void {
    const lastAssistantMessage = [...this.messages.value]
      .reverse()
      .find((message) => message.role === 'assistant')
    this.handsOffSession.finishReasoningAnnotation(
      lastAssistantMessage ? messageText(lastAssistantMessage) : ''
    )
  }

  finishHandsOffFinalAnswerAnnotation(): void {
    this.handsOffSession.finishFinalAnswerAnnotation()
  }

  reviseFromReasoning(reviewId: string, feedback: string, selectedReasoning: string | null): void {
    const outcome = this.reasoningReviewSession.submitFeedback(
      reviewId,
      feedback,
      selectedReasoning
    )
    if (!outcome) return
    this.reasoningFeedbackOutcomes.push(outcome)
    this.gate.deferAbandonAtCommit()
    if (this.reasoningRevisionScheduled) return
    this.reasoningRevisionScheduled = true
    void this.finishReasoningFeedback(this.activeChatRequest)
  }

  continueFromFeedback(noteId: string): void {
    const note = this.feedbackNotes.value.find((candidate) => candidate.id === noteId)
    if (note?.status !== 'pending') return
    const continuedNote: ConversationFeedbackNote = { ...note, status: 'continued' }
    this.feedbackNotes.value = this.feedbackNotes.value.map((candidate) =>
      candidate.id === noteId ? continuedNote : candidate
    )
    this.recordFeedbackOutcome(continuedNote)
    logChatFeedbackLifecycle('continued', `note=${continuedNote.id} topic=${continuedNote.topic}`)
    this.queueLearn(continuedNote)
    void this.finishFeedbackReview()
  }

  reviseFromFeedback(noteId: string, feedbackItems: readonly ConversationFeedbackItem[]): void {
    const note = this.feedbackNotes.value.find((candidate) => candidate.id === noteId)
    const cleanItems = feedbackItems.flatMap((item) => {
      const text = item.text.trim()
      return text
        ? [
            {
              ...item,
              selection: copyFeedbackSelection(item.selection),
              text
            }
          ]
        : []
    })
    if (note?.status !== 'pending' || cleanItems.length === 0) return
    const reply = cleanItems.map((item) => item.text).join('\n')
    const answeredNote: ConversationFeedbackNote = {
      ...note,
      status: 'answered',
      reply,
      feedbackItems: cleanItems
    }
    this.feedbackNotes.value = this.feedbackNotes.value.map((candidate) =>
      candidate.id === noteId ? answeredNote : candidate
    )
    this.recordFeedbackOutcome(answeredNote)
    logChatFeedbackLifecycle('answered', `note=${answeredNote.id} topic=${answeredNote.topic}`)
    this.queueLearn(answeredNote)
    void this.finishFeedbackReview()
  }

  async newChat(): Promise<void> {
    if (this.running.value) await this.stop()
    else this.askUserSession.endRequest('new-chat')
    this.currentId.value = crypto.randomUUID()
    this.createdAt = Date.now()
    this.feedbackNotes.value = []
    this.reasoningReviewSession.reset()
    this.handsOffSession.reset()
    lenChatFeedbackHistory.reset()
    this.feedbackNoteHistory = []
    this.actions.value = []
    this.reasoningChunks.value = []
    this.revisionFeedback = null
    this.reasoningRevisionScheduled = false
    this.reasoningFeedbackOutcomes = []
    this.buildChat([])
  }

  async openConversation(id: string): Promise<void> {
    if (this.running.value) await this.stop()
    else this.askUserSession.endRequest('conversation-opened')
    const record = await loadConversation(id)
    if (!record) return
    this.currentId.value = record.id
    this.createdAt = record.createdAt
    this.feedbackNotes.value = []
    this.reasoningReviewSession.reset()
    this.handsOffSession.reset()
    this.reasoningRevisionScheduled = false
    this.reasoningFeedbackOutcomes = []
    lenChatFeedbackHistory.reset()
    this.feedbackNoteHistory = []
    this.actions.value = []
    this.reasoningChunks.value = []
    this.buildChat(record.messages)
  }

  async removeConversation(id: string): Promise<void> {
    const removingCurrent = id === this.currentId.value
    if (removingCurrent && this.running.value) await this.stop()
    try {
      await deleteConversation(id)
      const remaining = this.history.value.filter((record) => record.id !== id)
      this.history.value = remaining
      if (!removingCurrent) return
      const next = remaining.at(0)
      if (next) await this.openConversation(next.id)
      else await this.newChat()
    } catch (error) {
      console.warn('[conversation] delete failed:', error)
      this.lastError.value = 'Could not delete this conversation.'
    }
  }

  async clearUserModel(): Promise<void> {
    if (this.learning.value) return
    try {
      await clearSharedUserModel()
    } catch (error) {
      console.warn('[conversation-user-model] clear failed:', error)
      this.lastError.value = 'Could not clear the user model.'
    }
  }

  async reconfigure(): Promise<void> {
    if (this.running.value) await this.stop()
    this.buildChat([...this.messages.value])
  }

  private buildChat(messages: UIMessage[]): void {
    this.askUserSession.endRequest('chat-reconfigured')
    this.feedbackNotes.value = []
    this.reasoningReviewSession.reset()
    this.handsOffSession.reset()
    this.reasoningRevisionScheduled = false
    this.reasoningFeedbackOutcomes = []
    this.revisionPending = true
    this.resetMetaAgentMonitor()
    this.reasoningChunks.value = []
    this.revisionRun += 1
    this.revisionPending = false
    this.revising.value = false
    this.gate.abandon()
    const runtime = this.options.runtime()
    this.gate = new ChatTurnGate(runtime.allowFreeIntervention)
    const monitor = runtime.metaAgentEnabled
      ? createChatMonitor({
          getContext: () => ({
            messages: this.messages.value,
            request: lastUserRequest(this.messages.value),
            propositions: this.propositions.value,
            completedActions: this.actions.value,
            previousNotes: this.feedbackNoteHistory
          }),
          onReasoningChunk: (streamId, chunkIndex, text) => {
            this.reasoningChunks.value = [
              ...this.reasoningChunks.value,
              { streamId, chunkIndex, text }
            ]
          },
          onActivity: (active) => {
            this.monitorActive.value = active
            if (!active) void this.finishFeedbackReview()
          },
          onReviewActivity: (active) => {
            this.feedbackGenerating.value = active
          },
          onNote: (note) => {
            this.gate.hold()
            this.addFeedbackNote(note)
          }
        })
      : null
    this.resetMetaAgentMonitor = monitor ? () => monitor.reset() : () => undefined
    let observer = monitor?.observer ?? NOOP_REASONING_OBSERVER
    if (isHandsOffDelegationCondition(runtime.condition)) {
      observer = this.handsOffSession.observer
    } else if (runtime.allowFreeIntervention) {
      observer = this.reasoningReviewSession.observer
    }
    const transport = createConversationTransport({
      apiKey: this.options.apiKey(),
      modelId: this.options.modelId(),
      enabledTools: this.options.enabledTools(),
      runtime,
      askUserSession: this.askUserSession,
      observer,
      awaitReasoningReviews: runtime.metaAgentEnabled || runtime.allowFreeIntervention,
      isSilentRevision: () => this.revising.value,
      gate: this.gate,
      getPropositions: () => this.propositions.value,
      takeRevisionFeedback: () => {
        const feedback = this.revisionFeedback
        this.revisionFeedback = null
        return feedback
      },
      onActions: (actions) => {
        this.actions.value = [...this.actions.value, ...actions].slice(-12)
        logChatToolActions(actions)
      }
    })

    this.chatRef.value = markRaw(
      new Chat<UIMessage>({
        id: this.currentId.value,
        messages,
        transport,
        onError: (error) => {
          this.askUserSession.endRequest('request-error')
          this.lastError.value = error.message
        },
        onFinish: (event) => {
          this.askUserSession.endRequest(
            event.isAbort || event.isDisconnect || event.isError
              ? 'request-interrupted'
              : 'request-finished'
          )
          if (event.isAbort || event.isDisconnect || event.isError) return
          if (isHandsOffDelegationCondition(this.options.runtime().condition)) {
            this.handsOffSession.completeAgentRun()
          }
          void this.checkpoint(event.messages)
        }
      })
    )
  }

  private async checkpoint(messages: UIMessage[]): Promise<void> {
    if (messages.length === 0) return
    const now = Date.now()
    const record: ConversationRecord = {
      id: this.currentId.value,
      title: titleFrom(messages),
      messages,
      createdAt: this.createdAt,
      updatedAt: now
    }
    try {
      await saveConversation(record)
      this.history.value = [record, ...this.history.value.filter((item) => item.id !== record.id)]
    } catch (error) {
      console.warn('[conversation] checkpoint failed:', error)
    }
  }

  private trackChatRequest(request: Promise<void>): Promise<void> {
    const tracked = request.finally(() => {
      if (this.activeChatRequest === tracked) this.activeChatRequest = null
    })
    this.activeChatRequest = tracked
    return tracked
  }

  private async learn(note: ConversationFeedbackNote): Promise<void> {
    if (!this.options.runtime().updateUserModel || !canUpdateUserModelFromFeedback()) return
    this.learning.value = true
    const batch = conversationFeedbackBatch(note, note.feedbackItems)
    logUserModelFeedback(
      batch.step ?? 0,
      'queued',
      `host=LenChat note=${note.id} resolution=${note.feedbackItems.length > 0 ? 'explicit-feedback' : 'implicitly-accepted'}`
    )
    try {
      await observeFeedbackNotes(batch)
    } catch (error) {
      console.warn('[conversation-user-model] update failed:', error)
    } finally {
      this.learning.value = false
    }
  }

  private queueLearn(note: ConversationFeedbackNote): void {
    this.preferenceUpdate = this.preferenceUpdate
      .catch(() => undefined)
      .then(() => this.learn(note))
  }

  private queueAskUserLearn(requestId: string, request: string): void {
    const answers = this.askUserSession.takeAnswers()
    if (answers.length === 0 || !this.options.runtime().updateUserModel) return
    this.preferenceUpdate = this.preferenceUpdate
      .catch(() => undefined)
      .then(async () => {
        this.learning.value = true
        try {
          await observeAskUserAnswers({ requestId, request, answers })
        } catch (error) {
          console.warn('[conversation-user-model] ask_user update failed:', error)
        } finally {
          this.learning.value = false
        }
      })
  }

  private addFeedbackNote(note: FeedbackNote): void {
    const message = [...this.messages.value].reverse().find((item) => item.role === 'assistant')
    const conversationNote: ConversationFeedbackNote = {
      id: note.id,
      messageId: message?.id ?? null,
      originStep: note.originStep,
      originChunk: note.originChunk,
      topic: note.topic,
      cue: note.text,
      cueSegments: structuredClone(note.cueSegments),
      reasoningEvidence: note.evidenceFromReasoning,
      relationship: note.relationship,
      representation: structuredClone(note.representation),
      representationGoal: note.representationGoal,
      propositionIds: [...note.propositionIds],
      status: 'pending',
      reply: null,
      feedbackItems: [],
      createdAt: Date.now()
    }
    this.feedbackNotes.value = [...this.feedbackNotes.value, conversationNote]
    if (note.representation.type !== 'text') void this.fillVisualRepresentation(note)
    logChatFeedbackLifecycle(
      'note',
      `note=${conversationNote.id} topic=${conversationNote.topic} pending=${this.feedbackPending.value ? 'yes' : 'no'}`
    )
    let subtype: FeedbackNoteHistoryItem['representationSubtype'] = null
    if (note.representation.type === 'code-visual') subtype = note.representation.visualType
    if (note.representation.type === 'image') subtype = note.representation.imageType
    const historyItem: FeedbackNoteHistoryItem = {
      id: note.id,
      originStep: note.originStep,
      originChunk: note.originChunk,
      topic: note.topic,
      relationship: note.relationship,
      representationType: note.representation.type,
      representationSubtype: subtype,
      representationGoal: note.representationGoal,
      text: note.text,
      nodeId: null,
      evidenceFromReasoning: note.evidenceFromReasoning,
      propositionIds: [...note.propositionIds],
      status: 'active',
      outcome: null
    }
    this.feedbackNoteHistory = [...this.feedbackNoteHistory, historyItem].slice(-15)
  }

  private async fillVisualRepresentation(note: FeedbackNote): Promise<void> {
    if (note.representation.type === 'text') return
    try {
      const result = await FEEDBACK_NOTE_REPRESENTATION_PROVIDER.materialize(note)
      if (result.type === 'code-visual') {
        this.feedbackNotes.value = this.feedbackNotes.value.map((candidate) => {
          if (candidate.id !== note.id || candidate.representation.type !== 'code-visual') {
            return candidate
          }
          return {
            ...candidate,
            representation: {
              ...candidate.representation,
              artifact: result.artifact,
              status: 'ready'
            }
          }
        })
        logFeedbackNoteCode(note.id, result.artifact.format, 'host=LenChat')
        return
      }
      if (result.type !== 'image') throw new Error('Representation provider mismatch')
      this.feedbackNotes.value = this.feedbackNotes.value.map((candidate) => {
        if (candidate.id !== note.id || candidate.representation.type !== 'image') return candidate
        return {
          ...candidate,
          representation: { ...candidate.representation, url: result.url, status: 'ready' }
        }
      })
      logFeedbackNoteImage(note.id, 'ready', 'host=LenChat')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      this.feedbackNotes.value = this.feedbackNotes.value.map((candidate) => {
        if (candidate.id !== note.id || candidate.representation.type === 'text') return candidate
        return {
          ...candidate,
          representation: { ...candidate.representation, status: 'failed' }
        }
      })
      if (note.representation.type === 'code-visual') {
        logFeedbackNoteCode(note.id, 'failed', `host=LenChat  ${message}`)
      } else {
        logFeedbackNoteImage(note.id, 'failed', `host=LenChat  ${message}`)
      }
      console.warn('[conversation] visual generation failed:', error)
    }
  }

  private recordFeedbackOutcome(note: ConversationFeedbackNote): void {
    const history = this.feedbackNoteHistory.find((item) => item.id === note.id)
    if (!history) return
    history.status = note.feedbackItems.length > 0 ? 'answered' : 'continued'
    history.outcome = {
      resolution: note.feedbackItems.length > 0 ? 'explicit-feedback' : 'implicitly-accepted',
      selections: note.feedbackItems.map((item) => feedbackSelectionLabel(item.selection)),
      feedback: note.feedbackItems.map((item) => item.text)
    }
  }

  private async finishFeedbackReview(): Promise<void> {
    if (this.monitorActive.value || this.revisionPending) return
    if (this.feedbackNotes.value.some((note) => note.status === 'pending')) return
    const explicit = this.feedbackNotes.value.filter(
      (note) => note.status === 'answered' && note.feedbackItems.length > 0
    )
    if (explicit.length === 0) {
      logChatFeedbackLifecycle('resumed', 'all notes reviewed without explicit feedback')
      this.gate.resume()
      return
    }

    const chat = this.chatRef.value
    if (!chat) return
    const requestMessage = [...chat.messages].reverse().find((message) => message.role === 'user')
    if (!requestMessage) return
    this.revisionPending = true
    const handoffRun = this.revisionRun
    logChatFeedbackLifecycle(
      'retry',
      `waiting for ${this.feedbackNotes.value.length} reviewed notes to update the user model`
    )
    await this.preferenceUpdate.catch(() => undefined)
    if (this.chatRef.value !== chat || this.revisionRun !== handoffRun) {
      return
    }
    const revisionRun = ++this.revisionRun
    this.revising.value = true
    this.revisionFeedback = explicit
      .flatMap((note, noteIndex) =>
        note.feedbackItems.map(
          (item, itemIndex) =>
            `${noteIndex + 1}.${itemIndex + 1}. Decision: ${note.cue}\n` +
            `   Reasoning: ${note.reasoningEvidence}\n` +
            `   Feedback target: ${feedbackSelectionLabel(item.selection)}\n` +
            `   User feedback: ${item.text}`
        )
      )
      .join('\n')
    logChatFeedbackLifecycle('retry', `discarding first run; feedback-notes=${explicit.length}`)
    const firstRequest = this.activeChatRequest
    this.gate.abandon()
    this.resetMetaAgentMonitor()
    await chat.stop()
    await firstRequest?.catch(() => undefined)
    if (this.chatRef.value !== chat || this.revisionRun !== revisionRun) return
    this.actions.value = []
    this.reasoningChunks.value = []
    this.feedbackNotes.value = []
    let revisedAnswerLength = 0
    try {
      await this.trackChatRequest(chat.regenerate({ messageId: requestMessage.id }))
      const revisedAnswer = [...chat.messages]
        .reverse()
        .find((message) => message.role === 'assistant')
      revisedAnswerLength = revisedAnswer ? messageText(revisedAnswer).length : 0
      if (!chat.error && revisedAnswerLength === 0) {
        this.lastError.value = 'The revised response was empty. Please try again.'
      }
    } finally {
      if (this.revisionRun === revisionRun) {
        logChatFeedbackLifecycle(
          'retry-complete',
          `silent retry finished; status=${chat.status} answer=${revisedAnswerLength} chars`
        )
        this.revising.value = false
        this.revisionPending = false
      }
    }
  }

  private async finishReasoningFeedback(firstRequest: Promise<void> | null): Promise<void> {
    const chat = this.chatRef.value
    if (!chat) {
      this.reasoningRevisionScheduled = false
      return
    }
    const handoffRun = this.revisionRun
    await firstRequest?.catch(() => undefined)
    if (this.chatRef.value !== chat || this.revisionRun !== handoffRun) {
      this.reasoningRevisionScheduled = false
      return
    }
    const outcomes = [...this.reasoningFeedbackOutcomes]
    if (outcomes.length === 0 || this.revisionPending) {
      this.reasoningRevisionScheduled = false
      return
    }
    const requestMessage = [...chat.messages].reverse().find((message) => message.role === 'user')
    if (!requestMessage) {
      this.reasoningRevisionScheduled = false
      return
    }

    this.revisionPending = true
    const revisionRun = ++this.revisionRun
    this.revising.value = true
    this.reasoningReviewSession.setObserving(false)
    this.revisionFeedback = renderReasoningFeedbackReport(outcomes)
    logChatFeedbackLifecycle(
      'retry',
      `reasoning-reviews=${outcomes.length}; first run reached commit boundary; silently retrying`
    )

    this.gate.clearDeferredAbandon()
    this.resetMetaAgentMonitor()
    if (this.chatRef.value !== chat || this.revisionRun !== revisionRun) {
      this.reasoningRevisionScheduled = false
      return
    }

    if (this.options.runtime().updateUserModel) {
      await observeUserInitiatedFeedback(reasoningFeedbackBatch(requestMessage.id, null, outcomes))
    }
    if (this.chatRef.value !== chat || this.revisionRun !== revisionRun) {
      this.reasoningRevisionScheduled = false
      return
    }

    this.actions.value = []
    this.reasoningChunks.value = []
    this.feedbackNotes.value = []
    this.reasoningReviewSession.reset()
    this.reasoningReviewSession.beginRequest(outcomes[0]?.review.request ?? '')
    this.reasoningFeedbackOutcomes = []

    let revisedAnswerLength = 0
    try {
      await this.trackChatRequest(chat.regenerate({ messageId: requestMessage.id }))
      const revisedAnswer = [...chat.messages]
        .reverse()
        .find((message) => message.role === 'assistant')
      revisedAnswerLength = revisedAnswer ? messageText(revisedAnswer).length : 0
      if (!chat.error && revisedAnswerLength === 0) {
        this.lastError.value = 'The revised response was empty. Please try again.'
      }
    } finally {
      if (this.revisionRun === revisionRun) {
        logChatFeedbackLifecycle(
          'retry-complete',
          `reasoning feedback retry finished; status=${chat.status} answer=${revisedAnswerLength} chars`
        )
        this.reasoningReviewSession.setObserving(true)
        this.reasoningRevisionScheduled = false
        this.revising.value = false
        this.revisionPending = false
      }
    }
  }
}
