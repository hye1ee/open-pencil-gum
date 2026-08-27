import { Chat } from '@ai-sdk/vue'
import { isTextUIPart } from 'ai'
import type { ChatStatus, UIMessage } from 'ai'
import { computed, markRaw, ref, shallowRef } from 'vue'

import { ConversationTurnGate } from '@/app/conversation/gate'
import { createConversationMonitor } from '@/app/conversation/monitor'
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
import type { ConversationFeedbackNote, ConversationRecord } from '@/app/conversation/types'
import { learnConversationPreferences } from '@/app/conversation/user-model'
import { createChatContext } from '@/app/meta-agent/context/chat'
import type { Proposition } from '@/app/user-model/pipeline'

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
  private gate = new ConversationTurnGate()
  private revisionFeedback: string | null = null
  private revisionRun = 0
  private preferenceUpdate: Promise<void> = Promise.resolve()
  private createdAt = Date.now()

  readonly initialized = ref(false)
  readonly history = shallowRef<ConversationRecord[]>([])
  readonly currentId = ref<string>(crypto.randomUUID())
  readonly feedback = shallowRef<ConversationFeedbackNote | null>(null)
  readonly propositions = shallowRef<Proposition[]>([])
  readonly monitorActive = ref(false)
  readonly learning = ref(false)
  readonly revising = ref(false)
  readonly actions = ref<string[]>([])
  readonly reasoningChunks = shallowRef<string[]>([])
  readonly lastError = ref('')

  readonly messages = computed(() => this.chatRef.value?.messages ?? [])
  readonly status = computed<ChatStatus>(() => this.chatRef.value?.status ?? 'ready')
  readonly error = computed(() => this.chatRef.value?.error)
  readonly running = computed(
    () => this.status.value === 'submitted' || this.status.value === 'streaming'
  )
  readonly configured = computed(() => this.options.apiKey().trim() !== '')

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
    if (!clean || !this.configured.value || this.feedback.value) return
    await this.preferenceUpdate.catch(() => undefined)
    this.lastError.value = ''
    this.revisionRun += 1
    this.revising.value = false
    this.actions.value = []
    this.reasoningChunks.value = []
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
    this.feedback.value = null
    this.revisionRun += 1
    this.revising.value = false
    await this.chatRef.value?.stop()
  }

  continueFromFeedback(): void {
    const note = this.feedback.value
    if (!note) return
    this.feedback.value = null
    this.gate.resume()
    this.queueLearn(note, null)
  }

  async reviseFromFeedback(reply: string): Promise<void> {
    const note = this.feedback.value
    const clean = reply.trim()
    const chat = this.chatRef.value
    if (!note || !clean || !chat) return
    const revisionRun = ++this.revisionRun
    this.revising.value = true
    this.revisionFeedback = clean
    this.feedback.value = null
    this.gate.abandon()
    await chat.stop()
    if (this.chatRef.value !== chat || this.revisionRun !== revisionRun) return
    this.queueLearn(note, clean)
    this.reasoningChunks.value = []
    try {
      await chat.regenerate()
    } finally {
      if (this.revisionRun === revisionRun) this.revising.value = false
    }
  }

  async newChat(): Promise<void> {
    if (this.running.value) await this.stop()
    this.currentId.value = crypto.randomUUID()
    this.createdAt = Date.now()
    this.feedback.value = null
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
    this.feedback.value = null
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
    this.reasoningChunks.value = []
    this.revisionRun += 1
    this.revising.value = false
    this.gate.abandon()
    this.gate = new ConversationTurnGate()
    const observer = createConversationMonitor({
      apiKey: this.options.apiKey(),
      modelId: this.options.modelId(),
      getContext: () =>
        createChatContext({
          messages: this.messages.value,
          userRequest: lastUserRequest(this.messages.value),
          propositions: this.propositions.value,
          actions: this.actions.value
        }),
      getMessageId: () => {
        const message = [...this.messages.value].reverse().find((item) => item.role === 'assistant')
        return message?.id ?? null
      },
      onActivity: (active) => {
        this.monitorActive.value = active
      },
      onReasoningChunk: (chunk) => {
        this.reasoningChunks.value = [...this.reasoningChunks.value, chunk]
      },
      onFeedback: (note) => {
        if (this.feedback.value) return
        this.feedback.value = note
        this.gate.hold()
      }
    })
    const transport = createConversationTransport({
      apiKey: this.options.apiKey(),
      modelId: this.options.modelId(),
      enabledTools: this.options.enabledTools(),
      observer,
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
}
