/**
 * EpicChatHistory
 *
 * IndexedDB persistence layer for epic chat messages.
 * Uses the `idb` library for a promise-based IndexedDB API.
 *
 * Schema:
 * - Store: 'epic-chats', key: epicId
 * - Index: 'by-updated' on updatedAt (for LRU cleanup)
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A single chat message in the epic chat history
 */
export interface EpicChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

/**
 * The full record stored in IndexedDB for an epic's chat
 */
export interface EpicChatRecord {
  epicId: string
  messages: EpicChatMessage[]
  updatedAt: number
}

/**
 * IndexedDB schema definition for type safety
 */
interface EpicChatDB extends DBSchema {
  'epic-chats': {
    key: string
    value: EpicChatRecord
    indexes: {
      'by-updated': number
    }
  }
}

// ─── Database ─────────────────────────────────────────────────────────────────

const DB_NAME = 'craft-agents-epic-chat'
const DB_VERSION = 1
const STORE_NAME = 'epic-chats'

/** Singleton database instance */
let dbInstance: IDBPDatabase<EpicChatDB> | null = null

/**
 * Get or create the database connection.
 * Uses a singleton pattern to avoid multiple connections.
 */
async function getDB(): Promise<IDBPDatabase<EpicChatDB>> {
  if (dbInstance) return dbInstance

  dbInstance = await openDB<EpicChatDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Create the epic-chats store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'epicId' })
        // Index for LRU cleanup - oldest first
        store.createIndex('by-updated', 'updatedAt')
      }
    },
  })

  return dbInstance
}

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Load chat history for an epic from IndexedDB.
 * Returns empty array if no history exists.
 */
export async function loadChatHistory(epicId: string): Promise<EpicChatMessage[]> {
  try {
    const db = await getDB()
    const record = await db.get(STORE_NAME, epicId)
    return record?.messages ?? []
  } catch (error) {
    console.error('[EpicChatHistory] Failed to load chat history:', error)
    return []
  }
}

/**
 * Save chat history for an epic to IndexedDB.
 * Overwrites any existing history for this epic.
 */
export async function saveChatHistory(
  epicId: string,
  messages: EpicChatMessage[]
): Promise<void> {
  try {
    const db = await getDB()
    const record: EpicChatRecord = {
      epicId,
      messages,
      updatedAt: Date.now(),
    }
    await db.put(STORE_NAME, record)
  } catch (error) {
    console.error('[EpicChatHistory] Failed to save chat history:', error)
  }
}

/**
 * Append a single message to an epic's chat history.
 * More efficient than loading, modifying, and saving the entire history.
 */
export async function appendMessage(
  epicId: string,
  message: EpicChatMessage
): Promise<void> {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)

    const existing = await store.get(epicId)
    const messages = existing?.messages ?? []
    messages.push(message)

    const record: EpicChatRecord = {
      epicId,
      messages,
      updatedAt: Date.now(),
    }
    await store.put(record)
    await tx.done
  } catch (error) {
    console.error('[EpicChatHistory] Failed to append message:', error)
  }
}

/**
 * Clear chat history for a specific epic.
 */
export async function clearChatHistory(epicId: string): Promise<void> {
  try {
    const db = await getDB()
    await db.delete(STORE_NAME, epicId)
  } catch (error) {
    console.error('[EpicChatHistory] Failed to clear chat history:', error)
  }
}

/**
 * Get all epic IDs with chat history, sorted by last updated (oldest first).
 * Useful for LRU cleanup.
 */
export async function getAllEpicIds(): Promise<string[]> {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('by-updated')

    const epicIds: string[] = []
    let cursor = await index.openCursor()

    while (cursor) {
      epicIds.push(cursor.value.epicId)
      cursor = await cursor.continue()
    }

    return epicIds
  } catch (error) {
    console.error('[EpicChatHistory] Failed to get all epic IDs:', error)
    return []
  }
}

/**
 * Delete oldest chat histories to keep total count under limit.
 * Uses LRU (least recently updated) strategy.
 */
export async function pruneOldHistories(maxCount: number = 50): Promise<void> {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('by-updated')

    const allRecords: EpicChatRecord[] = []
    let cursor = await index.openCursor()

    while (cursor) {
      allRecords.push(cursor.value)
      cursor = await cursor.continue()
    }

    // Delete oldest records if over limit
    const toDelete = allRecords.slice(0, Math.max(0, allRecords.length - maxCount))
    for (const record of toDelete) {
      await store.delete(record.epicId)
    }

    await tx.done
  } catch (error) {
    console.error('[EpicChatHistory] Failed to prune old histories:', error)
  }
}

// ─── React Hook ───────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'

/**
 * React hook for managing epic chat history with IndexedDB persistence.
 *
 * @param epicId - The epic ID to load/save chat history for
 * @returns Chat state and actions
 */
export function useEpicChatHistory(epicId: string | null) {
  const [messages, setMessages] = useState<EpicChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Load history when epicId changes
  useEffect(() => {
    if (!epicId) {
      setMessages([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    loadChatHistory(epicId)
      .then((history) => {
        setMessages(history)
        setIsLoading(false)
      })
      .catch(() => {
        setMessages([])
        setIsLoading(false)
      })
  }, [epicId])

  // Add a new message and persist
  const addMessage = useCallback(
    async (message: Omit<EpicChatMessage, 'id' | 'timestamp'>) => {
      if (!epicId) return

      const newMessage: EpicChatMessage = {
        ...message,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      }

      setMessages((prev) => [...prev, newMessage])
      await appendMessage(epicId, newMessage)
    },
    [epicId]
  )

  // Update last message (for streaming)
  const updateLastMessage = useCallback(
    (content: string) => {
      setMessages((prev) => {
        if (prev.length === 0) return prev
        const updated = [...prev]
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content,
        }
        return updated
      })
    },
    []
  )

  // Save current state to IndexedDB (for manual save, e.g., after streaming completes)
  // Accepts optional parameter to avoid stale closure during streaming
  const saveMessages = useCallback(async (messagesToSave?: EpicChatMessage[]) => {
    if (!epicId) return
    await saveChatHistory(epicId, messagesToSave ?? messages)
  }, [epicId, messages])

  // Clear history
  const clearHistory = useCallback(async () => {
    if (!epicId) return
    setMessages([])
    await clearChatHistory(epicId)
  }, [epicId])

  return {
    messages,
    isLoading,
    addMessage,
    updateLastMessage,
    saveMessages,
    clearHistory,
    setMessages,
  }
}
