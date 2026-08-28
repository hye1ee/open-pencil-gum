import type { ConversationRecord } from '@/app/conversation/types'

const DATABASE_NAME = 'open-pencil-chat'
const DATABASE_VERSION = 2
const CONVERSATIONS_STORE = 'conversations'
const LEGACY_PREFERENCES_STORE = 'preferences'

function plainMessages(messages: ConversationRecord['messages']): ConversationRecord['messages'] {
  // Vue's Chat state exposes reactive proxies, which IndexedDB cannot clone.
  // UI messages are JSON-shaped, so serializing them also strips the proxies.
  // oxlint-disable-next-line unicorn/prefer-structured-clone -- structuredClone rejects Vue proxies.
  return JSON.parse(JSON.stringify(messages)) as ConversationRecord['messages']
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(CONVERSATIONS_STORE)) {
        const store = database.createObjectStore(CONVERSATIONS_STORE, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt')
      }
      if (database.objectStoreNames.contains(LEGACY_PREFERENCES_STORE)) {
        database.deleteObjectStore(LEGACY_PREFERENCES_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open chat storage'))
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export async function listConversations(): Promise<ConversationRecord[]> {
  const database = await openDatabase()
  if (!database) return []
  try {
    const transaction = database.transaction(CONVERSATIONS_STORE, 'readonly')
    const records = await requestResult(
      transaction.objectStore(CONVERSATIONS_STORE).getAll() as IDBRequest<ConversationRecord[]>
    )
    return records.sort((a, b) => b.updatedAt - a.updatedAt)
  } finally {
    database.close()
  }
}

export async function saveConversation(record: ConversationRecord): Promise<void> {
  const database = await openDatabase()
  if (!database) return
  try {
    const transaction = database.transaction(CONVERSATIONS_STORE, 'readwrite')
    transaction.objectStore(CONVERSATIONS_STORE).put({
      ...record,
      messages: plainMessages(record.messages)
    })
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}

export async function loadConversation(id: string): Promise<ConversationRecord | null> {
  const database = await openDatabase()
  if (!database) return null
  try {
    const transaction = database.transaction(CONVERSATIONS_STORE, 'readonly')
    const record = await requestResult(
      transaction.objectStore(CONVERSATIONS_STORE).get(id) as IDBRequest<
        ConversationRecord | undefined
      >
    )
    return record ?? null
  } finally {
    database.close()
  }
}

export async function deleteConversation(id: string): Promise<void> {
  const database = await openDatabase()
  if (!database) return
  try {
    const transaction = database.transaction(CONVERSATIONS_STORE, 'readwrite')
    transaction.objectStore(CONVERSATIONS_STORE).delete(id)
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}
