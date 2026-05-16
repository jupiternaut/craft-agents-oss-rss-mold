/**
 * Tasks State Atoms
 *
 * Jotai atoms for flow-next epic and task management.
 * Provides reactive state for the Tasks navigator panel.
 *
 * UI state (openTabs, activeTab, viewModePerEpic) is persisted to
 * .flow/ui-state.json per project instead of global localStorage.
 * Writes are debounced at 500ms following the persistence-queue pattern.
 */

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { atomFamily } from 'jotai-family'
import type { EpicSummary, TaskSummary, TaskStatus, FlowBridgeResult, EpicListResponse, TaskListResponse, CommandSuccess } from '../../shared/flow-schemas'
import type { ActiveFlowProject, RegisteredFlowProject, FlowProjectStatus, FlowUiState } from '../../shared/types'

// ─── Flow Project Atoms ──────────────────────────────────────────────────────

/**
 * Active flow project — the currently selected project directory for tasks management.
 * Separate from the auth Workspace concept (useActiveWorkspace).
 * null path = no projects registered.
 */
export const activeFlowProjectAtom = atom<ActiveFlowProject>({
  path: null,
  flowStatus: 'needs-setup',
})

/**
 * Registered flow projects — persisted to localStorage across app restarts.
 * Shape: [{ path, name, addedAt }]
 */
export const registeredFlowProjectsAtom = atomWithStorage<RegisteredFlowProject[]>(
  'flow-registered-projects',
  []
)

/**
 * Action atom: Set the active flow project.
 * Fetches flow status and git info for the selected project.
 * Handles null projectPath gracefully.
 */
export const setActiveFlowProjectAtom = atom(
  null,
  async (_get, set, projectPath: string | null) => {
    if (!projectPath) {
      set(activeFlowProjectAtom, { path: null, flowStatus: 'needs-setup' })
      // Sync FlowWatcher lifecycle (teardown old watcher)
      set(syncFlowWatcherAtom, null)
      return
    }

    // Set path immediately with loading state
    set(activeFlowProjectAtom, { path: projectPath, flowStatus: 'needs-setup' })

    // Sync FlowWatcher lifecycle (teardown old, debounced start for new)
    set(syncFlowWatcherAtom, projectPath)

    try {
      // Check flow status
      const statusResult = await window.electronAPI.flowProjectCheckStatus(projectPath)
      const flowStatus: FlowProjectStatus = statusResult.status

      // Lazily fetch git info
      const gitInfo = await window.electronAPI.getGitInfo(projectPath)

      set(activeFlowProjectAtom, {
        path: projectPath,
        flowStatus,
        gitInfo: gitInfo ?? undefined,
      })

      // Hydrate UI state from .flow/ui-state.json for this project
      set(hydrateUiStateAtom, projectPath)
    } catch (err) {
      console.error('[setActiveFlowProjectAtom] Error:', err)
      set(activeFlowProjectAtom, {
        path: projectPath,
        flowStatus: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }
)

/**
 * Action atom: Register a new flow project.
 * Adds to registeredFlowProjectsAtom and optionally sets as active.
 */
export const registerFlowProjectAtom = atom(
  null,
  async (get, set, projectPath: string, name: string, setActive = true) => {
    const existing = get(registeredFlowProjectsAtom)

    // Prevent duplicate registration
    if (existing.some(p => p.path === projectPath)) {
      if (setActive) {
        set(setActiveFlowProjectAtom, projectPath)
      }
      return
    }

    const newProject: RegisteredFlowProject = {
      path: projectPath,
      name,
      addedAt: Date.now(),
    }

    set(registeredFlowProjectsAtom, [...existing, newProject])

    // FlowWatcher lifecycle is managed solely by setActiveFlowProjectAtom → syncFlowWatcherAtom.
    // No direct IPC registration call here to avoid double-registration race condition.
    if (setActive) {
      set(setActiveFlowProjectAtom, projectPath)
    }
  }
)

/**
 * Action atom: Unregister a flow project.
 * Removes from registeredFlowProjectsAtom. Does NOT delete .flow/ on disk.
 */
export const unregisterFlowProjectAtom = atom(
  null,
  async (get, set, projectPath: string) => {
    const existing = get(registeredFlowProjectsAtom)
    const filtered = existing.filter(p => p.path !== projectPath)
    set(registeredFlowProjectsAtom, filtered)

    // Unregister on main process side
    try {
      await window.electronAPI.flowProjectUnregister(projectPath)
    } catch (err) {
      console.error('[unregisterFlowProjectAtom] IPC error:', err)
    }

    // If we just removed the active project, switch to first available or null
    const active = get(activeFlowProjectAtom)
    if (active.path === projectPath) {
      const next = filtered.length > 0 ? filtered[0].path : null
      set(setActiveFlowProjectAtom, next)
    }
  }
)

// ─── FlowWatcher Lifecycle ────────────────────────────────────────────────────

/**
 * Internal atom tracking FlowWatcher state.
 * Uses Jotai state instead of module-level variables to survive HMR correctly.
 */
const flowWatcherInternalAtom = atom<{
  previousPath: string | null
  debounceTimer: ReturnType<typeof setTimeout> | null
}>({
  previousPath: null,
  debounceTimer: null,
})

/**
 * Action atom: Manages FlowWatcher lifecycle on project switch.
 * Tears down old watcher, debounces new watcher start (300ms).
 * Called internally by setActiveFlowProjectAtom -- not for external use.
 */
export const syncFlowWatcherAtom = atom(
  null,
  async (get, set, newPath: string | null) => {
    const state = get(flowWatcherInternalAtom)

    // Clear any pending debounce
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer)
    }

    const oldPath = state.previousPath

    // Tear down old watcher immediately
    if (oldPath && oldPath !== newPath) {
      try {
        await window.electronAPI.flowProjectUnregister(oldPath)
      } catch {
        // Best-effort teardown
      }
    }

    // Debounce new watcher start (300ms) to handle rapid switching
    const newTimer = newPath
      ? setTimeout(async () => {
          try {
            // flowProjectRegister starts the watcher on main process side
            await window.electronAPI.flowProjectRegister(newPath, '')
          } catch {
            // Best-effort setup
          }
        }, 300)
      : null

    set(flowWatcherInternalAtom, {
      previousPath: newPath,
      debounceTimer: newTimer,
    })
  }
)

// ─── View Mode Types ──────────────────────────────────────────────────────────

/** Available view modes for epic content */
export type ViewMode = 'list' | 'kanban' | 'graph'

/** Default view mode when no override is set */
export const DEFAULT_VIEW_MODE: ViewMode = 'list'

// ─── Utils ───────────────────────────────────────────────────────────────────

/**
 * Calculate epic progress as a percentage (0-100)
 * Handles edge cases: zero tasks, done status override
 */
export function calculateEpicProgress(epic: EpicSummary): number {
  // If status is done, always return 100 for visual consistency
  if (epic.status === 'done') return 100
  // Avoid division by zero
  if (epic.tasks === 0) return 0
  return Math.round((epic.done / epic.tasks) * 100)
}

// ─── Loading State ───────────────────────────────────────────────────────────

/**
 * Loading state for epics list
 * - 'idle': Not yet fetched
 * - 'loading': Currently fetching
 * - 'success': Successfully loaded
 * - 'error': Failed to load (flowctl not found, no .flow/, etc.)
 */
export type LoadingState = 'idle' | 'loading' | 'success' | 'error'

export const epicsLoadingStateAtom = atom<LoadingState>('idle')

// ─── Epics ───────────────────────────────────────────────────────────────────

/**
 * Atom to store the list of epics for the current workspace
 */
export const epicsAtom = atom<EpicSummary[]>([])

/**
 * Error message when epics fail to load (e.g., flowctl not found, no .flow/)
 */
export const epicsErrorAtom = atom<string | null>(null)

// ─── Per-Project UI State (file-backed) ──────────────────────────────────────
// These atoms were previously backed by localStorage (atomWithStorage).
// Now they are plain atoms hydrated from .flow/ui-state.json on project switch
// and persisted back via debounced writes.

/**
 * Currently selected epic ID — synced with activeTab for backward compatibility.
 * Persisted to .flow/ui-state.json as `activeTab`.
 */
export const selectedEpicIdAtom = atom<string | null>(null)

/**
 * Open tabs: ordered array of epic IDs.
 * Persisted to .flow/ui-state.json as `openTabs`.
 */
export const openTabsAtom = atom<string[]>([])

/**
 * Active (currently visible) tab: epic ID.
 * Persisted to .flow/ui-state.json as `activeTab`.
 */
export const activeTabAtom = atom<string | null>(null)

/**
 * View mode overrides per epic, stored as a flat map.
 * Persisted to .flow/ui-state.json as `viewModePerEpic`.
 * The atomFamily provides per-epic reactivity.
 */
const viewModeMapAtom = atom<Record<string, ViewMode | null>>({})

/**
 * View mode override per epic.
 * Uses atomFamily for per-epic reactivity with file-backed storage.
 * Reads from the internal viewModeMapAtom. Writes trigger debounced persistence.
 */
export const viewModePerEpicAtomFamily = atomFamily(
  (epicId: string) => atom(
    (get) => {
      const map = get(viewModeMapAtom)
      return (map[epicId] as ViewMode | null) ?? null
    },
    (get, set, value: ViewMode | null) => {
      const map = get(viewModeMapAtom)
      set(viewModeMapAtom, { ...map, [epicId]: value })
      // Trigger debounced persist
      set(scheduleUiStatePersistAtom)
    }
  ),
  (a, b) => a === b
)

// ─── Debounced UI State Persistence ──────────────────────────────────────────

const UI_STATE_DEBOUNCE_MS = 500

/**
 * Internal atom tracking the debounce timer for UI state writes.
 */
const uiStatePersistTimerAtom = atom<ReturnType<typeof setTimeout> | null>(null)

/**
 * Tracks whether localStorage migration has been completed for the current project.
 * Prevents re-running migration on every hydrate.
 */
const uiStateMigrationDoneAtom = atom<boolean>(false)

/**
 * Tracks whether the welcome banner has been dismissed for the current project.
 * Persisted to .flow/ui-state.json as `welcomeDismissed`.
 */
export const welcomeDismissedAtom = atom<boolean>(false)

/**
 * Collects current UI state from atoms into a FlowUiState object.
 */
const collectUiStateAtom = atom((get): FlowUiState => {
  const openTabs = get(openTabsAtom)
  const activeTab = get(activeTabAtom)
  const viewModeMap = get(viewModeMapAtom)
  const welcomeDismissed = get(welcomeDismissedAtom)

  // Only include non-null view mode entries
  const viewModePerEpic: Record<string, string> = {}
  for (const [epicId, mode] of Object.entries(viewModeMap)) {
    if (mode !== null) {
      viewModePerEpic[epicId] = mode
    }
  }

  return {
    openTabs,
    activeTab,
    viewModePerEpic,
    welcomeDismissed: welcomeDismissed || undefined,
  }
})

/**
 * Action atom: Schedule a debounced write of UI state to .flow/ui-state.json.
 * Coalesces rapid mutations into a single write. Follows the persistence-queue
 * pattern from sessions/persistence-queue.ts.
 */
export const scheduleUiStatePersistAtom = atom(
  null,
  (get, set) => {
    const project = get(activeFlowProjectAtom)
    if (!project.path || project.flowStatus !== 'initialized') return

    // Clear existing timer
    const existingTimer = get(uiStatePersistTimerAtom)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    const projectPath = project.path
    const timer = setTimeout(async () => {
      try {
        const state = get(collectUiStateAtom)
        await window.electronAPI.flowUiStateWrite(projectPath, state)
      } catch (err) {
        console.error('[scheduleUiStatePersistAtom] Write failed:', err)
      }
    }, UI_STATE_DEBOUNCE_MS)

    set(uiStatePersistTimerAtom, timer)
  }
)

// ─── localStorage Migration ──────────────────────────────────────────────────

/**
 * localStorage keys used by the old global UI state atoms.
 * These are migrated to .flow/ui-state.json on first load, then cleared.
 */
const LEGACY_STORAGE_KEYS = {
  selectedEpicId: 'tasks-selected-epic-id',
  openTabs: 'tasks-open-tabs',
  activeTab: 'tasks-active-tab',
  viewModePrefix: 'tasks-view-mode-',
} as const

/**
 * Read and parse legacy localStorage UI state.
 * Returns null if no legacy data exists.
 *
 * Uses localStorage intentionally for one-time migration to .flow/ui-state.json.
 */
function readLegacyUiState(): FlowUiState | null {
  try {
    /* eslint-disable craft-agent/no-localstorage -- migration reads legacy localStorage keys */
    const openTabsRaw = localStorage.getItem(LEGACY_STORAGE_KEYS.openTabs)
    const activeTabRaw = localStorage.getItem(LEGACY_STORAGE_KEYS.activeTab)

    // If neither key exists, no migration needed
    if (!openTabsRaw && !activeTabRaw) return null

    const openTabs: string[] = openTabsRaw ? JSON.parse(openTabsRaw) : []
    const activeTab: string | null = activeTabRaw ? JSON.parse(activeTabRaw) : null

    // Validate types to guard against corrupted localStorage data
    if (!Array.isArray(openTabs) || (activeTab !== null && typeof activeTab !== 'string')) {
      console.warn('[Migration] Invalid localStorage data shape, skipping migration')
      return null
    }

    // Collect view mode overrides from localStorage (keyed by prefix)
    const viewModePerEpic: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(LEGACY_STORAGE_KEYS.viewModePrefix)) {
        const epicId = key.slice(LEGACY_STORAGE_KEYS.viewModePrefix.length)
        try {
          const mode = JSON.parse(localStorage.getItem(key) ?? 'null')
          if (mode) {
            viewModePerEpic[epicId] = mode
          }
        } catch {
          // Skip invalid entries
        }
      }
    }
    /* eslint-enable craft-agent/no-localstorage */

    return { openTabs, activeTab, viewModePerEpic }
  } catch {
    return null
  }
}

/**
 * Clear legacy localStorage keys after successful migration.
 *
 * Uses localStorage intentionally to clean up migrated keys.
 */
function clearLegacyUiState(): void {
  try {
    /* eslint-disable craft-agent/no-localstorage -- migration clears legacy localStorage keys */
    localStorage.removeItem(LEGACY_STORAGE_KEYS.selectedEpicId)
    localStorage.removeItem(LEGACY_STORAGE_KEYS.openTabs)
    localStorage.removeItem(LEGACY_STORAGE_KEYS.activeTab)

    // Remove all view mode keys
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(LEGACY_STORAGE_KEYS.viewModePrefix)) {
        keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key)
    }
    /* eslint-enable craft-agent/no-localstorage */
  } catch {
    // Best-effort cleanup
  }
}

// ─── UI State Hydration ──────────────────────────────────────────────────────

/**
 * Apply a FlowUiState object to the in-memory atoms via individual set calls.
 * Does not trigger persistence (avoids circular write-back).
 *
 * Returns the values to set — caller applies them with `set()`.
 */
function parseUiState(state: FlowUiState): {
  openTabs: string[]
  activeTab: string | null
  selectedEpicId: string | null
  viewModeMap: Record<string, ViewMode | null>
  welcomeDismissed: boolean
} {
  const viewModeMap: Record<string, ViewMode | null> = {}
  if (state.viewModePerEpic) {
    for (const [epicId, mode] of Object.entries(state.viewModePerEpic)) {
      viewModeMap[epicId] = mode as ViewMode
    }
  }
  return {
    openTabs: state.openTabs ?? [],
    activeTab: state.activeTab ?? null,
    selectedEpicId: state.activeTab ?? null, // selectedEpicId mirrors activeTab
    viewModeMap,
    welcomeDismissed: state.welcomeDismissed ?? false,
  }
}

/**
 * Action atom: Hydrate UI state from .flow/ui-state.json for a project.
 * Handles migration from localStorage on first load.
 * When no ui-state.json exists (first open): will auto-open the most active epic
 * once epics are loaded (see loadEpicsAtom).
 *
 * Called internally by setActiveFlowProjectAtom — not for external use.
 */
export const hydrateUiStateAtom = atom(
  null,
  async (get, set, projectPath: string) => {
    // Clear any pending writes from previous project to prevent stale data
    // being written to the new project's ui-state.json (race condition on
    // rapid project switches where the 500ms debounce timer fires after
    // the switch completes).
    const existingTimer = get(uiStatePersistTimerAtom)
    if (existingTimer) {
      clearTimeout(existingTimer)
      set(uiStatePersistTimerAtom, null)
    }

    try {
      // Read persisted UI state from .flow/ui-state.json
      const persisted = await window.electronAPI.flowUiStateRead(projectPath)

      if (persisted) {
        // Apply persisted state
        const parsed = parseUiState(persisted)
        set(openTabsAtom, parsed.openTabs)
        set(activeTabAtom, parsed.activeTab)
        set(selectedEpicIdAtom, parsed.selectedEpicId)
        set(viewModeMapAtom, parsed.viewModeMap)
        set(welcomeDismissedAtom, parsed.welcomeDismissed)
        set(uiStateMigrationDoneAtom, true)
        return
      }

      // No persisted state — check if this is a migration scenario
      const project = get(activeFlowProjectAtom)
      if (project.flowStatus === 'needs-setup') {
        // .flow/ doesn't exist yet — use in-memory defaults, skip migration
        set(openTabsAtom, [])
        set(activeTabAtom, null)
        set(selectedEpicIdAtom, null)
        set(viewModeMapAtom, {})
        set(welcomeDismissedAtom, false)
        set(uiStateMigrationDoneAtom, true)
        return
      }

      // .flow/ exists but no ui-state.json — attempt localStorage migration
      if (!get(uiStateMigrationDoneAtom)) {
        const legacyState = readLegacyUiState()
        if (legacyState) {
          // Apply legacy state to atoms
          const parsed = parseUiState(legacyState)
          set(openTabsAtom, parsed.openTabs)
          set(activeTabAtom, parsed.activeTab)
          set(selectedEpicIdAtom, parsed.selectedEpicId)
          set(viewModeMapAtom, parsed.viewModeMap)
          set(welcomeDismissedAtom, parsed.welcomeDismissed)

          // Persist to .flow/ui-state.json
          try {
            await window.electronAPI.flowUiStateWrite(projectPath, legacyState)
          } catch {
            // Best-effort — state is in memory regardless
          }

          // Clear legacy localStorage keys after successful migration
          clearLegacyUiState()
          set(uiStateMigrationDoneAtom, true)
          return
        }
      }

      // No legacy state and no persisted state — use defaults.
      // The "auto-open most active epic" logic runs in loadEpicsAtom
      // after epics are loaded (since we need epic data to determine which to open).
      set(openTabsAtom, [])
      set(activeTabAtom, null)
      set(selectedEpicIdAtom, null)
      set(viewModeMapAtom, {})
      set(welcomeDismissedAtom, false)
      set(uiStateMigrationDoneAtom, true)
    } catch (err) {
      console.error('[hydrateUiStateAtom] Error:', err)
      // Fall through to defaults on error
      set(openTabsAtom, [])
      set(activeTabAtom, null)
      set(selectedEpicIdAtom, null)
      set(viewModeMapAtom, {})
      set(welcomeDismissedAtom, false)
      set(uiStateMigrationDoneAtom, true)
    }
  }
)

// ─── Tasks per Epic ──────────────────────────────────────────────────────────

/**
 * Atom family for tasks per epic
 * Each epic has its own atom with its task list
 */
export const tasksAtomFamily = atomFamily(
  (_epicId: string) => atom<TaskSummary[]>([]),
  (a, b) => a === b
)

/**
 * Loading state for tasks per epic
 */
export const tasksLoadingAtomFamily = atomFamily(
  (_epicId: string) => atom<LoadingState>('idle'),
  (a, b) => a === b
)

// ─── Derived Atoms ───────────────────────────────────────────────────────────

/**
 * Get the currently selected epic (full summary object)
 */
export const selectedEpicAtom = atom((get) => {
  const selectedId = get(selectedEpicIdAtom)
  if (!selectedId) return null
  const epics = get(epicsAtom)
  return epics.find(e => e.id === selectedId) ?? null
})

/**
 * Get tasks for the selected epic
 */
export const selectedEpicTasksAtom = atom((get) => {
  const selectedId = get(selectedEpicIdAtom)
  if (!selectedId) return []
  return get(tasksAtomFamily(selectedId))
})

// ─── Auto-Open Most Active Epic ──────────────────────────────────────────────

/**
 * Determine the most active epic to auto-open when no UI state exists.
 * Priority: most in-progress tasks → most recently updated → first by epic ID.
 *
 * When `in_progress` isn't available from flowctl (older versions), uses
 * `(tasks - done)` as a proxy for activity level.
 */
function findMostActiveEpic(epics: EpicSummary[]): EpicSummary | null {
  if (epics.length === 0) return null

  return epics.reduce((best, epic) => {
    // Compare in-progress task count (fallback: tasks - done as proxy for active work)
    const epicActive = epic.in_progress ?? (epic.tasks - epic.done)
    const bestActive = best.in_progress ?? (best.tasks - best.done)
    if (epicActive > bestActive) return epic
    if (epicActive < bestActive) return best

    // Tiebreaker: most recently updated (updated_at)
    const epicUpdated = epic.updated_at ? new Date(epic.updated_at).getTime() : 0
    const bestUpdated = best.updated_at ? new Date(best.updated_at).getTime() : 0
    if (epicUpdated > bestUpdated) return epic
    if (epicUpdated < bestUpdated) return best

    // Tiebreaker: first by epic ID (alphabetical)
    return epic.id < best.id ? epic : best
  })
}

// ─── Action Atoms ────────────────────────────────────────────────────────────

/**
 * Action atom: Load epics from IPC
 */
export const loadEpicsAtom = atom(
  null,
  async (get, set, workspaceRoot: string) => {
    set(epicsLoadingStateAtom, 'loading')
    set(epicsErrorAtom, null)

    try {
      const result: FlowBridgeResult<EpicListResponse> = await window.electronAPI.flowEpicsList(workspaceRoot)

      if (result.ok) {
        set(epicsAtom, result.data.epics)
        set(epicsLoadingStateAtom, 'success')

        const epicIds = result.data.epics.map(e => e.id)

        // Auto-open most active epic if no tab is currently selected
        // (happens on first open with no ui-state.json, or if persisted state had activeTab: null)
        const currentSelected = get(selectedEpicIdAtom)
        if (!currentSelected && result.data.epics.length > 0) {
          const mostActive = findMostActiveEpic(result.data.epics)
          if (mostActive) {
            set(selectedEpicIdAtom, mostActive.id)
            set(activeTabAtom, mostActive.id)
            set(openTabsAtom, [mostActive.id])
            // Persist the auto-opened state
            set(scheduleUiStatePersistAtom)
          }
        }

        // If selected epic no longer exists, select first available
        if (currentSelected && !epicIds.includes(currentSelected)) {
          const fallback = result.data.epics[0]?.id ?? null
          set(selectedEpicIdAtom, fallback)
          set(activeTabAtom, fallback)
          if (fallback) {
            const currentTabs = get(openTabsAtom)
            if (!currentTabs.includes(fallback)) {
              set(openTabsAtom, [...currentTabs, fallback])
            }
          }
          set(scheduleUiStatePersistAtom)
        }

        // Validate persisted tabs against loaded epics (filter out stale tabs)
        const openTabs = get(openTabsAtom)
        const validTabs = openTabs.filter(id => epicIds.includes(id))
        if (validTabs.length !== openTabs.length) {
          set(openTabsAtom, validTabs)
          set(scheduleUiStatePersistAtom)
        }

        // Validate active tab
        const activeTab = get(activeTabAtom)
        if (activeTab && !epicIds.includes(activeTab)) {
          set(activeTabAtom, validTabs[0] ?? null)
          set(selectedEpicIdAtom, validTabs[0] ?? null)
          set(scheduleUiStatePersistAtom)
        }
      } else {
        // Handle error
        let errorMsg = 'Failed to load epics'
        if (result.error.type === 'no_project_configured') {
          errorMsg = 'no-project-configured'
        } else if (result.error.type === 'flowctl_not_found') {
          errorMsg = 'flowctl not found - .flow/ may not be initialized'
        } else if (result.error.type === 'command_failed') {
          // Check if it's "no .flow directory" error - use specific exit code
          // flowctl returns exit code 1 with "not found" or "no such" in stderr
          const stderr = result.error.stderr.toLowerCase()
          const isNoFlowDir = result.error.exitCode === 1 && (
            stderr.includes('not found') ||
            stderr.includes('no such') ||
            stderr.includes('does not exist') ||
            stderr.includes('not initialized')
          )
          if (isNoFlowDir) {
            errorMsg = 'no-flow-directory'
          } else {
            errorMsg = result.error.stderr || 'Command failed'
          }
        }
        set(epicsErrorAtom, errorMsg)
        set(epicsAtom, [])
        set(epicsLoadingStateAtom, 'error')
      }
    } catch (err) {
      set(epicsErrorAtom, err instanceof Error ? err.message : 'Unknown error')
      set(epicsAtom, [])
      set(epicsLoadingStateAtom, 'error')
    }
  }
)

/**
 * Action atom: Load tasks for a specific epic
 */
export const loadTasksAtom = atom(
  null,
  async (_get, set, workspaceRoot: string, epicId: string) => {
    set(tasksLoadingAtomFamily(epicId), 'loading')

    try {
      const result: FlowBridgeResult<TaskListResponse> = await window.electronAPI.flowTasksList(workspaceRoot, epicId)

      if (result.ok) {
        set(tasksAtomFamily(epicId), result.data.tasks)
        set(tasksLoadingAtomFamily(epicId), 'success')
      } else {
        set(tasksAtomFamily(epicId), [])
        set(tasksLoadingAtomFamily(epicId), 'error')
      }
    } catch {
      set(tasksAtomFamily(epicId), [])
      set(tasksLoadingAtomFamily(epicId), 'error')
    }
  }
)

/**
 * Action atom: Initialize flow-next in the workspace
 * After successful init, relies on flow:changed event to trigger reload
 * (avoids race condition from duplicate IPC calls)
 */
export const initFlowAtom = atom(
  null,
  async (_get, set, workspaceRoot: string) => {
    set(epicsLoadingStateAtom, 'loading')

    try {
      const result = await window.electronAPI.flowInit(workspaceRoot)

      if (result.ok) {
        // Clear error state - the flow:changed event will trigger a reload
        // Don't manually reload here to avoid race condition with event handler
        set(epicsErrorAtom, null)
        // Set to idle so the flow:changed handler can transition to loading
        set(epicsLoadingStateAtom, 'idle')
      } else {
        set(epicsErrorAtom, 'Failed to initialize flow-next')
        set(epicsLoadingStateAtom, 'error')
      }
    } catch (err) {
      set(epicsErrorAtom, err instanceof Error ? err.message : 'Unknown error')
      set(epicsLoadingStateAtom, 'error')
    }
  }
)

/**
 * Action atom: Reset all tasks state (for workspace changes)
 * Clears selected epic and tab state to prevent cross-workspace bugs
 */
export const resetTasksStateAtom = atom(
  null,
  (_get, set) => {
    set(epicsAtom, [])
    set(epicsLoadingStateAtom, 'idle')
    set(epicsErrorAtom, null)
    // Clear selection on workspace change to prevent cross-workspace selection bugs
    set(selectedEpicIdAtom, null)
    // Clear tab state to prevent stale tabs from previous workspace
    set(openTabsAtom, [])
    set(activeTabAtom, null)
    set(viewModeMapAtom, {})
    set(welcomeDismissedAtom, false)
    // Reset migration flag so next project hydration can migrate if needed
    set(uiStateMigrationDoneAtom, false)
    // Reset active flow project to prevent cross-workspace bugs (project registration persists in localStorage)
    set(activeFlowProjectAtom, { path: null, flowStatus: 'needs-setup' })
  }
)

// ─── Tab Action Atoms ─────────────────────────────────────────────────────────

/**
 * Action atom: Open an epic tab (or activate if already open)
 * Adds to openTabs if not present, sets as activeTab
 */
export const openEpicTabAtom = atom(
  null,
  (get, set, epicId: string) => {
    const openTabs = get(openTabsAtom)

    if (!openTabs.includes(epicId)) {
      // Add new tab at end
      set(openTabsAtom, [...openTabs, epicId])
    }

    // Activate the tab
    set(activeTabAtom, epicId)
    // Also sync with selectedEpicIdAtom for backward compatibility
    set(selectedEpicIdAtom, epicId)
    // Persist
    set(scheduleUiStatePersistAtom)
  }
)

/**
 * Action atom: Close an epic tab
 * Removes from openTabs, selects adjacent tab if closing active tab
 */
export const closeEpicTabAtom = atom(
  null,
  (get, set, epicId: string) => {
    const openTabs = get(openTabsAtom)
    const activeTab = get(activeTabAtom)

    const tabIndex = openTabs.indexOf(epicId)
    if (tabIndex === -1) return

    // Remove the tab
    const newTabs = openTabs.filter(id => id !== epicId)
    set(openTabsAtom, newTabs)

    // If closing active tab, select adjacent (prefer next, then previous)
    if (activeTab === epicId) {
      if (newTabs.length === 0) {
        set(activeTabAtom, null)
        set(selectedEpicIdAtom, null)
      } else {
        // Prefer the tab at same index, or the last tab if at end
        const newIndex = Math.min(tabIndex, newTabs.length - 1)
        const newActive = newTabs[newIndex]
        set(activeTabAtom, newActive)
        set(selectedEpicIdAtom, newActive)
      }
    }

    // Persist
    set(scheduleUiStatePersistAtom)
  }
)

/**
 * Action atom: Set active tab (switch between open tabs)
 */
export const setActiveTabAtom = atom(
  null,
  (get, set, epicId: string) => {
    const openTabs = get(openTabsAtom)
    if (openTabs.includes(epicId)) {
      set(activeTabAtom, epicId)
      set(selectedEpicIdAtom, epicId)
      // Persist
      set(scheduleUiStatePersistAtom)
    }
  }
)

/**
 * Action atom: Dismiss the welcome banner for the current project.
 * Sets welcomeDismissed to true and schedules a debounced persist.
 */
export const dismissWelcomeBannerAtom = atom(
  null,
  (_get, set) => {
    set(welcomeDismissedAtom, true)
    set(scheduleUiStatePersistAtom)
  }
)

/**
 * Action atom: Set view mode for an epic
 */
export const setViewModeAtom = atom(
  null,
  (_get, set, epicId: string, mode: ViewMode) => {
    set(viewModePerEpicAtomFamily(epicId), mode)
    // Note: viewModePerEpicAtomFamily setter already schedules persist
  }
)

// ─── View Mode Selectors ──────────────────────────────────────────────────────

/**
 * Determine the best view mode for an epic based on task count and dependencies
 * - <5 tasks: list view
 * - >=5 tasks: kanban view
 * - Any dependencies: graph available (but not auto-selected)
 */
export function suggestViewMode(tasks: TaskSummary[]): ViewMode {
  if (tasks.length < 5) return 'list'
  return 'kanban'
}

/**
 * Check if graph view should be available (any task has dependencies)
 */
export function isGraphViewAvailable(tasks: TaskSummary[]): boolean {
  return tasks.some(task => task.depends_on && task.depends_on.length > 0)
}

/**
 * Get effective view mode for an epic (user override or auto-suggested)
 */
export function getEffectiveViewMode(
  userOverride: ViewMode | null,
  tasks: TaskSummary[]
): ViewMode {
  if (userOverride !== null) return userOverride
  return suggestViewMode(tasks)
}

// ─── Graph Viewport State ─────────────────────────────────────────────────────

/**
 * Viewport state for dependency graph (zoom, pan position)
 * Matches React Flow's Viewport type
 */
export interface GraphViewport {
  x: number
  y: number
  zoom: number
}

/**
 * Viewport state per epic for the dependency graph
 * Persists zoom/pan position when switching between views/tabs
 */
export const graphViewportPerEpicAtomFamily = atomFamily(
  (_epicId: string) => atom<GraphViewport | null>(null),
  (a, b) => a === b
)

/**
 * Track whether initial fitView has been applied for each epic
 * Prevents fitView from running on every re-render
 */
export const graphInitializedPerEpicAtomFamily = atomFamily(
  (_epicId: string) => atom<boolean>(false),
  (a, b) => a === b
)

/**
 * Track whether dagre layout has been applied for each epic
 * Per-epic state prevents race conditions when switching tabs
 */
export const graphLayoutAppliedPerEpicAtomFamily = atomFamily(
  (_epicId: string) => atom<boolean>(false),
  (a, b) => a === b
)

/**
 * Action atom: Update task status via drag-drop
 * Performs optimistic update with rollback on failure.
 * Shows sonner toast on error.
 *
 * @param workspaceRoot - Workspace path for IPC calls
 * @param epicId - Epic ID the task belongs to (avoids fragile ID parsing)
 * @param taskId - Task ID to update
 * @param newStatus - Target status
 */
export const updateTaskStatusAtom = atom(
  null,
  async (get, set, workspaceRoot: string, epicId: string, taskId: string, newStatus: TaskStatus) => {

    const tasksAtom = tasksAtomFamily(epicId)
    const currentTasks = get(tasksAtom)
    const taskIndex = currentTasks.findIndex((t) => t.id === taskId)

    if (taskIndex === -1) {
      console.error('[updateTaskStatusAtom] Task not found:', taskId)
      return
    }

    const originalTask = currentTasks[taskIndex]
    const originalStatus = originalTask.status

    // Optimistic update
    const updatedTasks = [...currentTasks]
    updatedTasks[taskIndex] = { ...originalTask, status: newStatus }
    set(tasksAtom, updatedTasks)

    try {
      const result: FlowBridgeResult<CommandSuccess> = await window.electronAPI.flowTaskUpdateStatus(
        workspaceRoot,
        taskId,
        newStatus
      )

      if (!result.ok) {
        // Rollback on failure
        const rollbackTasks = [...get(tasksAtom)]
        const rollbackIndex = rollbackTasks.findIndex((t) => t.id === taskId)
        if (rollbackIndex !== -1) {
          rollbackTasks[rollbackIndex] = { ...rollbackTasks[rollbackIndex], status: originalStatus }
          set(tasksAtom, rollbackTasks)
        }

        // Show error toast
        const errorMsg =
          result.error.type === 'command_failed'
            ? result.error.stderr || 'Command failed'
            : result.error.type === 'flowctl_not_found'
              ? 'flowctl not found'
              : 'Failed to update task status'

        // Import toast dynamically to avoid circular dependency
        const { toast } = await import('sonner')
        toast.error('Failed to update task status', {
          description: errorMsg,
        })
      }
    } catch (err) {
      // Rollback on error
      const rollbackTasks = [...get(tasksAtom)]
      const rollbackIndex = rollbackTasks.findIndex((t) => t.id === taskId)
      if (rollbackIndex !== -1) {
        rollbackTasks[rollbackIndex] = { ...rollbackTasks[rollbackIndex], status: originalStatus }
        set(tasksAtom, rollbackTasks)
      }

      // Show error toast
      const { toast } = await import('sonner')
      toast.error('Failed to update task status', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }
)

// ─── Epic Creation Wizard State ───────────────────────────────────────────────

/**
 * Controls visibility of the epic creation wizard dialog.
 * Can be triggered from navigator panel header or tab bar '+' button.
 */
export const epicWizardOpenAtom = atom<boolean>(false)

// ─── AI Suggestion Sidebar State ──────────────────────────────────────────────
// These atoms intentionally stay in localStorage — they're not per-project critical state.

/**
 * Controls visibility of the AI suggestion sidebar.
 * Persisted to localStorage so it remembers user preference.
 * Defaults to collapsed (false).
 */
export const suggestionSidebarOpenAtom = atomWithStorage<boolean>(
  'tasks-suggestion-sidebar-open',
  false
)

/**
 * Dismissed suggestions per epic.
 * Each epic has a Set of suggestion IDs that have been dismissed.
 * Persisted to localStorage per epic.
 */
export const dismissedSuggestionsAtomFamily = atomFamily(
  (epicId: string) => atomWithStorage<string[]>(
    `tasks-dismissed-suggestions-${epicId}`,
    []
  ),
  (a, b) => a === b
)

/**
 * Tracks when the "all tasks done" banner has been shown for an epic.
 * Used to prevent repeated prompts.
 */
export const epicReviewPromptShownAtomFamily = atomFamily(
  (epicId: string) => atomWithStorage<boolean>(
    `tasks-epic-review-prompted-${epicId}`,
    false
  ),
  (a, b) => a === b
)
