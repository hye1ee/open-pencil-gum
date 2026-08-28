import { Chat } from '@ai-sdk/vue'
import { isTextUIPart } from 'ai'
import type { ChatStatus, UIMessage } from 'ai'
import { computed, markRaw, ref, shallowRef } from 'vue'

import {
  logFeedbackNoteCode,
  logFeedbackNoteImage,
  logChatFeedbackLifecycle,
  logMetaAgentLifecycle,
  logPropositionChange,
  logRationaleChange,
  logRunStart,
  logUserModelFeedback,
  logUserModelStage
} from '@/app/ai/chat/agent-log'
import type { ConversationToolId } from '@/app/conversation/settings'
import {
  deleteConversation,
  listConversations,
  loadConversation,
  loadConversationPreferences,
  saveConversation,
  saveConversationPreferences
} from '@/app/conversation/storage'
import { createConversationTransport } from '@/app/conversation/transport'
import type {
  ConversationFeedbackItem,
  ConversationFeedbackNote,
  ConversationReasoningChunk,
  ConversationRecord
} from '@/app/conversation/types'
import { conversationFeedbackBatch } from '@/app/conversation/user-model'
import { copyFeedbackSelection, feedbackSelectionLabel } from '@/app/meta-agent/feedback-note/draft/selection'
import { lenChatFeedbackHistory } from '@/app/meta-agent/hosts/lenchat/feedback-note/history'
import { FEEDBACK_NOTE_REPRESENTATION_PROVIDER } from '@/app/meta-agent/feedback-note/representation'
import { ChatTurnGate } from '@/app/meta-agent/hosts/lenchat/gate'
import { createChatMonitor } from '@/app/meta-agent/hosts/lenchat/monitor'
import type { FeedbackNote, FeedbackNoteHistoryItem } from '@/app/meta-agent/core/types'
import { canUpdateUserModelFromFeedback, modelCalls } from '@/app/user-model/calls'
import { hydrateMissingPropositionEmbeddings } from '@/app/user-model/embeddings'
import {
  createUserModel,
  type FeedbackRetrievalTrace,
  type Proposition,
  type UserModel,
  type UserModelDeps
} from '@/app/user-model/pipeline'

interface ConversationStoreOptions {
  apiKey(): string
  modelId(): string
  enabledTools(): readonly ConversationToolId[]
}

function messageText(message: UIMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join(' ')
    .trim()
}

function titleFrom(messages: readonly UIMessage[]): string {
  const first = messages.find((message) => message.role === 'user')
  const text = first ? messageText(first) : ''
  return text ? text.slice(0, 52) : 'New chat'
}

function lastUserRequest(messages: readonly UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === 'user') return messageText(message)
  }
  return ''
}

function logConversationFeedbackRetrieval(trace: FeedbackRetrievalTrace): void {
  for (const note of trace.notes) {
    logUserModelStage(
      'retrieval',
      `host=LenChat ${note.noteId} direct → ${note.directIds.join(', ') || '(none)'}`
    )
    logUserModelStage(
      'retrieval',
      `host=LenChat ${note.noteId} embedding → ${
        note.embedding
          .map((candidate) => `${candidate.id}:${candidate.score.toFixed(3)}`)
          .join(', ') || '(none above threshold)'
      }`
    )
  }
  logUserModelStage(
    'retrieval',
    `host=LenChat shown-to-feedback-model → ${trace.shownIds.join(', ') || '(none)'}`
  )
}

export class ConversationStore {
  private readonly options: ConversationStoreOptions
  private readonly preferenceDeps: UserModelDeps
  private readonly preferenceModel: UserModel
  private readonly chatRef = shallowRef<Chat<UIMessage> | null>(null)
  private gate = new ChatTurnGate()
  private revisionFeedback: string | null = null
  private revisionRun = 0
  private revisionPending = false
  private preferenceUpdate: Promise<void> = Promise.resolve()
  private resetMetaAgentMonitor: () => void = () => undefined
  private feedbackNoteHistory: FeedbackNoteHistoryItem[] = []
  private createdAt = Date.now()

  readonly initialized = ref(false)
  readonly history = shallowRef<ConversationRecord[]>([])
  readonly currentId = ref<string>(crypto.randomUUID())
  readonly feedbackNotes = shallowRef<ConversationFeedbackNote[]>([])
  readonly propositions = shallowRef<Proposition[]>([])
  readonly monitorActive = ref(false)
  readonly feedbackGenerating = ref(false)
  readonly learning = ref(false)
  readonly revising = ref(false)
  readonly actions = ref<string[]>([])
  readonly reasoningChunks = shallowRef<ConversationReasoningChunk[]>([])
  readonly lastError = ref('')

  readonly messages = computed(() => this.chatRef.value?.messages ?? [])
  readonly status = computed<ChatStatus>(() => this.chatRef.value?.status ?? 'ready')
  readonly error = computed(() => this.chatRef.value?.error)
  readonly running = computed(
    () => this.status.value === 'submitted' || this.status.value === 'streaming'
  )
  readonly configured = computed(() => this.options.apiKey().trim() !== '')
  readonly feedbackPending = computed(() =>
    this.feedbackNotes.value.some((note) => note.status === 'pending')
  )

  constructor(options: ConversationStoreOptions) {
    this.options = options
    this.preferenceDeps = modelCalls()
    this.preferenceModel = createUserModel({
      deps: this.preferenceDeps,
      onStage: (stage) => logUserModelStage(stage, 'host=LenChat'),
      onFeedbackRetrieval: logConversationFeedbackRetrieval,
      onRevision: logPropositionChange,
      onRationale: logRationaleChange,
      onRationaleDropped: (reason) =>
        logUserModelStage('rationale', `host=LenChat dropped — ${reason}`),
      onChange: (propositions) => {
        this.propositions.value = [...propositions]
        void saveConversationPreferences([...propositions]).catch((error: unknown) => {
          console.warn('[conversation-user-model] save failed:', error)
        })
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error)
        logUserModelStage('failed', `host=LenChat ${message}`)
        console.warn('[conversation-user-model] pipeline failed:', error)
      }
    })
  }

  async initialize(): Promise<void> {
    const [history, propositions] = await Promise.all([
      listConversations(),
      loadConversationPreferences()
    ])
    this.history.value = history
    let loaded = propositions
    if (propositions.length > 0 && canUpdateUserModelFromFeedback()) {
      try {
        loaded = await hydrateMissingPropositionEmbeddings(propositions, (texts) =>
          this.preferenceDeps.embed(texts)
        )
        if (loaded !== propositions) await saveConversationPreferences(loaded)
      } catch (error) {
        console.warn('[conversation-user-model] embedding migration failed:', error)
      }
    }
    this.preferenceModel.load(loaded)
    this.propositions.value = [...this.preferenceModel.propositions]
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
    this.actions.value = []
    this.reasoningChunks.value = []
    this.feedbackNotes.value = []
    lenChatFeedbackHistory.reset()
    this.monitorActive.value = false
    this.feedbackGenerating.value = false
    this.resetMetaAgentMonitor()
    logRunStart(clean)
    logMetaAgentLifecycle(
      `host=LenChat mode=interactive-gate propositions=${this.propositions.value.length}`
    )
    const chat = this.chatRef.value
    if (!chat) return
    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: clean }]
    }
    const response = chat.sendMessage(userMessage)
    // Passing a complete UIMessage lets Chat append it before starting the
    // request. Save it now so Recent survives failed or interrupted generation.
    await this.checkpoint([...chat.messages])
    await response
  }

  async stop(): Promise<void> {
    this.gate.abandon()
    this.feedbackNotes.value = []
    this.revisionRun += 1
    this.revisionPending = false
    this.revising.value = false
    this.resetMetaAgentMonitor()
    await this.chatRef.value?.stop()
  }

  continueFromFeedback(noteId: string): void {
    const note = this.feedbackNotes.value.find((candidate) => candidate.id === noteId)
    if (!note || note.status !== 'pending') return
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
    if (!note || note.status !== 'pending' || cleanItems.length === 0) return
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
    this.currentId.value = crypto.randomUUID()
    this.createdAt = Date.now()
    this.feedbackNotes.value = []
    lenChatFeedbackHistory.reset()
    this.feedbackNoteHistory = []
    this.actions.value = []
    this.reasoningChunks.value = []
    this.revisionFeedback = null
    this.buildChat([])
  }

  async openConversation(id: string): Promise<void> {
    if (this.running.value) await this.stop()
    const record = await loadConversation(id)
    if (!record) return
    this.currentId.value = record.id
    this.createdAt = record.createdAt
    this.feedbackNotes.value = []
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

  async clearPreferences(): Promise<void> {
    if (this.learning.value) return
    try {
      this.preferenceModel.clear()
      await saveConversationPreferences([])
      this.propositions.value = []
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
    this.feedbackNotes.value = []
    this.revisionPending = true
    this.resetMetaAgentMonitor()
    this.reasoningChunks.value = []
    this.revisionRun += 1
    this.revisionPending = false
    this.revising.value = false
    this.gate.abandon()
    this.gate = new ChatTurnGate()
    const monitor = createChatMonitor({
      getContext: () => ({
        messages: this.messages.value,
        request: lastUserRequest(this.messages.value),
        propositions: this.propositions.value,
        completedActions: this.actions.value,
        previousNotes: this.feedbackNoteHistory
      }),
      onReasoningChunk: (streamId, chunkIndex, text) => {
        this.reasoningChunks.value = [...this.reasoningChunks.value, { streamId, chunkIndex, text }]
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
    this.resetMetaAgentMonitor = monitor.reset
    const transport = createConversationTransport({
      apiKey: this.options.apiKey(),
      modelId: this.options.modelId(),
      enabledTools: this.options.enabledTools(),
      observer: monitor.observer,
      awaitReasoningReviews: true,
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
      }
    })

    this.chatRef.value = markRaw(
      new Chat<UIMessage>({
        id: this.currentId.value,
        messages,
        transport,
        onError: (error) => {
          this.lastError.value = error.message
        },
        onFinish: (event) => {
          if (event.isAbort || event.isDisconnect || event.isError) return
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

  private async learn(note: ConversationFeedbackNote): Promise<void> {
    if (!canUpdateUserModelFromFeedback()) return
    this.learning.value = true
    const batch = conversationFeedbackBatch(note, note.feedbackItems)
    logUserModelFeedback(
      batch.step ?? 0,
      'queued',
      `host=LenChat note=${note.id} resolution=${note.feedbackItems.length > 0 ? 'explicit-feedback' : 'implicitly-accepted'}`
    )
    try {
      await this.preferenceModel.observeFeedback(batch)
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
    this.revisionPending = true
    const handoffRun = this.revisionRun
    logChatFeedbackLifecycle(
      'retry',
      `waiting for ${this.feedbackNotes.value.length} reviewed notes to update the user model`
    )
    await this.preferenceUpdate.catch(() => undefined)
    if (this.chatRef.value !== chat || this.revisionRun !== handoffRun || !this.revisionPending) {
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
    this.gate.abandon()
    this.resetMetaAgentMonitor()
    await chat.stop()
    if (this.chatRef.value !== chat || this.revisionRun !== revisionRun) return
    this.actions.value = []
    this.reasoningChunks.value = []
    this.feedbackNotes.value = []
    try {
      await chat.regenerate()
    } finally {
      if (this.revisionRun === revisionRun) {
        logChatFeedbackLifecycle('retry-complete', 'silent retry finished')
        this.revising.value = false
        this.revisionPending = false
      }
    }
  }
}
