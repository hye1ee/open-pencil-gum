import { Chat } from '@ai-sdk/vue'
import { isTextUIPart } from 'ai'
import type { ChatStatus, UIMessage } from 'ai'
import { computed, markRaw, ref, shallowRef } from 'vue'

import {
  logFeedbackNoteCode,
  logFeedbackNoteImage,
  logChatFeedbackLifecycle,
  logMetaAgentLifecycle,
  logRunStart
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
  ConversationFeedbackNote,
  ConversationReasoningChunk,
  ConversationRecord
} from '@/app/conversation/types'
import { FEEDBACK_NOTE_REPRESENTATION_PROVIDER } from '@/app/feedback-note/representation'
import { ChatTurnGate } from '@/app/meta-agent-chat/gate'
import { createChatMonitor } from '@/app/meta-agent-chat/monitor'
import type { FeedbackNote, FeedbackNoteHistoryItem } from '@/app/meta-agent/core/types'
import { learnConversationPreferences } from '@/app/user-model-chat/pipeline'
import type { ChatProposition } from '@/app/user-model-chat/types'

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

export class ConversationStore {
  private readonly options: ConversationStoreOptions
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
  readonly propositions = shallowRef<ChatProposition[]>([])
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
  }

  async initialize(): Promise<void> {
    const [history, propositions] = await Promise.all([
      listConversations(),
      loadConversationPreferences()
    ])
    this.history.value = history
    this.propositions.value = propositions
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
    this.recordFeedbackOutcome(continuedNote, null)
    logChatFeedbackLifecycle('continued', `note=${continuedNote.id} topic=${continuedNote.topic}`)
    this.queueLearn(continuedNote, null)
    void this.finishFeedbackReview()
  }

  reviseFromFeedback(noteId: string, reply: string): void {
    const note = this.feedbackNotes.value.find((candidate) => candidate.id === noteId)
    const clean = reply.trim()
    if (!note || note.status !== 'pending' || !clean) return
    const answeredNote: ConversationFeedbackNote = {
      ...note,
      status: 'answered',
      reply: clean
    }
    this.feedbackNotes.value = this.feedbackNotes.value.map((candidate) =>
      candidate.id === noteId ? answeredNote : candidate
    )
    this.recordFeedbackOutcome(answeredNote, clean)
    logChatFeedbackLifecycle('answered', `note=${answeredNote.id} topic=${answeredNote.topic}`)
    this.queueLearn(answeredNote, clean)
    void this.finishFeedbackReview()
  }

  async newChat(): Promise<void> {
    if (this.running.value) await this.stop()
    this.currentId.value = crypto.randomUUID()
    this.createdAt = Date.now()
    this.feedbackNotes.value = []
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

  private async learn(note: ConversationFeedbackNote, reply: string | null): Promise<void> {
    if (!this.configured.value) return
    this.learning.value = true
    try {
      this.propositions.value = await learnConversationPreferences({
        apiKey: this.options.apiKey(),
        modelId: this.options.modelId(),
        note,
        reply,
        propositions: this.propositions.value
      })
    } catch (error) {
      console.warn('[conversation-user-model] update failed:', error)
    } finally {
      this.learning.value = false
    }
  }

  private queueLearn(note: ConversationFeedbackNote, reply: string | null): void {
    this.preferenceUpdate = this.preferenceUpdate
      .catch(() => undefined)
      .then(() => this.learn(note, reply))
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
      reasoningEvidence: note.evidenceFromReasoning,
      relationship: note.relationship,
      representation: structuredClone(note.representation),
      representationGoal: note.representationGoal,
      propositionIds: [...note.propositionIds],
      status: 'pending',
      reply: null,
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

  private recordFeedbackOutcome(note: ConversationFeedbackNote, reply: string | null): void {
    const history = this.feedbackNoteHistory.find((item) => item.id === note.id)
    if (!history) return
    history.status = reply ? 'answered' : 'continued'
    history.outcome = {
      resolution: reply ? 'explicit-feedback' : 'implicitly-accepted',
      selections: [],
      feedback: reply ? [reply] : []
    }
  }

  private async finishFeedbackReview(): Promise<void> {
    if (this.monitorActive.value || this.revisionPending) return
    if (this.feedbackNotes.value.some((note) => note.status === 'pending')) return
    const explicit = this.feedbackNotes.value.filter(
      (note): note is ConversationFeedbackNote & { reply: string } =>
        note.status === 'answered' && note.reply !== null
    )
    if (explicit.length === 0) {
      logChatFeedbackLifecycle('resumed', 'all notes reviewed without explicit feedback')
      this.gate.resume()
      return
    }

    const chat = this.chatRef.value
    if (!chat) return
    this.revisionPending = true
    const revisionRun = ++this.revisionRun
    this.revising.value = true
    this.revisionFeedback = explicit
      .map(
        (note, index) =>
          `${index + 1}. Decision: ${note.cue}\n` +
          `   Reasoning: ${note.reasoningEvidence}\n` +
          `   User feedback: ${note.reply}`
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
