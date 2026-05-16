/**
 * Per-Session UI State Management
 *
 * Provides transient UI state scoped to individual sessions using Jotai atomFamily.
 * This state is NOT persisted — it lives only for the lifetime of the app session.
 * For persisted UI state, use localStorage via lib/local-storage.ts.
 *
 * Examples: scroll position, search query, expanded panels
 */

import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'

/**
 * Per-session transient UI state (not persisted)
 */
export interface SessionUIState {
  scrollPosition?: number
  searchQuery?: string
  rightSidebarPanel?: string
}

/**
 * Atom family for per-session UI state.
 * Each session gets its own isolated atom — updates to one session
 * don't trigger re-renders in other sessions.
 */
export const sessionUIStateFamily = atomFamily(
  (_sessionId: string) => atom<SessionUIState>({}),
  (a, b) => a === b
)
