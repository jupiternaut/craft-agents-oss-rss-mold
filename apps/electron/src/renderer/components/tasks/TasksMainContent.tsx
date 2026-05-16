/**
 * TasksMainContent
 *
 * Main content area for the Tasks view.
 * Routes to correct view (List/Kanban/Graph) based on active tab and view mode.
 *
 * Features:
 * - Tab bar for multi-epic navigation
 * - View mode selector (List/Kanban/Graph)
 * - Auto-selects best view based on epic state
 * - Persists view preference per epic
 * - Keeps inactive views mounted (display: none) to preserve state
 * - Slide-over task detail panel on task click
 * - Split-view chat panel with persistent history
 * - Collapsible AI suggestion sidebar with contextual nudges
 */

import * as React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { KanbanSquare, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { EpicTabBar } from './EpicTabBar'
import { ViewModeSelector } from './ViewModeSelector'
import { ListView } from './ListView'
import { KanbanBoard } from './KanbanBoard'
// Lazy load DependencyGraph to avoid blocking app startup with heavy @xyflow/react import
const DependencyGraph = React.lazy(() => import('./DependencyGraph').then(m => ({ default: m.DependencyGraph })))
import { TaskDetailSlideOver } from './TaskDetailSlideOver'
import { EpicChatPanel, ChatToggleButton, epicChatOpenAtom } from './EpicChatPanel'
import {
  AISuggestionSidebar,
  SuggestionToggleButton,
  useSuggestionCount,
  type Suggestion,
} from './AISuggestionSidebar'
import {
  openTabsAtom,
  activeTabAtom,
  epicsAtom,
  epicsLoadingStateAtom,
  tasksAtomFamily,
  viewModePerEpicAtomFamily,
  setViewModeAtom,
  calculateEpicProgress,
  isGraphViewAvailable,
  getEffectiveViewMode,
  suggestionSidebarOpenAtom,
  type ViewMode,
} from '@/atoms/tasks-state'

// Spring transition - snappy
const springTransition = {
  type: 'spring' as const,
  stiffness: 600,
  damping: 49,
}

export interface TasksMainContentProps {
  /** Workspace root for IPC calls */
  workspaceRoot: string
  /** Callback when a task is clicked */
  onTaskClick?: (epicId: string, taskId: string) => void
  /** Callback when "add" tab button is clicked */
  onAddTab?: () => void
  /** Optional className */
  className?: string
}

interface EpicViewContainerProps {
  epicId: string
  workspaceRoot: string
  isActive: boolean
  onTaskClick?: (taskId: string) => void
}

/**
 * Container for a single epic's view.
 * Stays mounted but hidden when inactive to preserve scroll/zoom state.
 * Handles its own view mode state.
 */
function EpicViewContainer({
  epicId,
  workspaceRoot,
  isActive,
  onTaskClick,
}: EpicViewContainerProps) {
  const tasks = useAtomValue(tasksAtomFamily(epicId))
  const userOverride = useAtomValue(viewModePerEpicAtomFamily(epicId))
  const viewMode = getEffectiveViewMode(userOverride, tasks)

  return (
    <div
      className="absolute inset-0"
      style={{ display: isActive ? 'block' : 'none' }}
    >
      {viewMode === 'list' && (
        <ListView
          epicId={epicId}
          workspaceRoot={workspaceRoot}
          onTaskClick={onTaskClick}
          className="h-full"
        />
      )}
      {viewMode === 'kanban' && (
        <KanbanBoard
          epicId={epicId}
          workspaceRoot={workspaceRoot}
          onTaskClick={onTaskClick}
          className="h-full"
        />
      )}
      {viewMode === 'graph' && (
        <React.Suspense fallback={<div className="h-full flex items-center justify-center text-muted-foreground">Loading graph...</div>}>
          <DependencyGraph
            epicId={epicId}
            workspaceRoot={workspaceRoot}
            onTaskClick={onTaskClick}
            className="h-full"
          />
        </React.Suspense>
      )}
    </div>
  )
}

/**
 * View selector wrapper that tracks per-epic view mode
 */
function EpicViewSelector({
  epicId,
  onViewChange,
}: {
  epicId: string
  onViewChange?: (mode: ViewMode) => void
}) {
  const tasks = useAtomValue(tasksAtomFamily(epicId))
  const [userOverride, setUserOverride] = useAtom(viewModePerEpicAtomFamily(epicId))
  const setViewMode = useSetAtom(setViewModeAtom)

  const effectiveMode = getEffectiveViewMode(userOverride, tasks)
  const graphAvailable = isGraphViewAvailable(tasks)

  const handleChange = React.useCallback(
    (mode: ViewMode) => {
      setViewMode(epicId, mode)
      onViewChange?.(mode)
    },
    [epicId, setViewMode, onViewChange]
  )

  return (
    <ViewModeSelector
      value={effectiveMode}
      onChange={handleChange}
      graphAvailable={graphAvailable}
    />
  )
}

/**
 * Epic header with title, progress, view selector, chat toggle, and suggestion toggle
 */
function EpicHeader({
  epicId,
  isChatOpen,
  onChatToggle,
  isSuggestionSidebarOpen,
  onSuggestionToggle,
  suggestionCount,
}: {
  epicId: string
  isChatOpen: boolean
  onChatToggle: () => void
  isSuggestionSidebarOpen: boolean
  onSuggestionToggle: () => void
  suggestionCount: number
}) {
  const epics = useAtomValue(epicsAtom)
  const epicsLoading = useAtomValue(epicsLoadingStateAtom)
  const epic = epics.find((e) => e.id === epicId)

  // Show loading state while epics are loading
  if (epicsLoading === 'loading' && !epic) {
    return (
      <div className="px-6 py-4 border-b border-border/50">
        <div className="h-6 w-48 bg-foreground/5 rounded animate-pulse" />
        <div className="h-4 w-32 bg-foreground/5 rounded mt-2 animate-pulse" />
      </div>
    )
  }

  // Epic not found (was deleted while tab was open)
  if (!epic) {
    return (
      <div className="px-6 py-4 border-b border-border/50 text-muted-foreground">
        <p className="text-sm">Epic not found: {epicId}</p>
      </div>
    )
  }

  const progressPercent = calculateEpicProgress(epic)

  return (
    <div className="px-6 py-4 border-b border-border/50 titlebar-no-drag">
      {/* Title row */}
      <h1 className="text-lg font-semibold">{epic.title}</h1>

      {/* Epic ID row */}
      <p className="text-sm text-muted-foreground mt-1">{epic.id}</p>

      {/* Controls row */}
      <div className="flex items-center gap-3 mt-3">
        <ChatToggleButton isOpen={isChatOpen} onClick={onChatToggle} />
        <SuggestionToggleButton
          isOpen={isSuggestionSidebarOpen}
          onClick={onSuggestionToggle}
          suggestionCount={suggestionCount}
        />
        <EpicViewSelector epicId={epicId} />
        <Badge
          variant={epic.status === 'done' ? 'secondary' : 'outline'}
          className={cn(
            epic.status === 'done' &&
              'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
          )}
        >
          {epic.status === 'done' ? 'Done' : 'Open'}
        </Badge>
      </div>

      {/* Progress bar */}
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-foreground/5 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              epic.status === 'done'
                ? 'bg-emerald-500'
                : progressPercent > 0
                  ? 'bg-blue-500'
                  : 'bg-transparent'
            )}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {epic.done}/{epic.tasks}
        </span>
      </div>
    </div>
  )
}

export function TasksMainContent({
  workspaceRoot,
  onTaskClick,
  onAddTab,
  className,
}: TasksMainContentProps) {
  const openTabs = useAtomValue(openTabsAtom)
  const activeTab = useAtomValue(activeTabAtom)

  // Chat panel state
  const [isChatOpen, setIsChatOpen] = useAtom(epicChatOpenAtom)

  // Suggestion sidebar state
  const [isSuggestionSidebarOpen, setIsSuggestionSidebarOpen] = useAtom(suggestionSidebarOpenAtom)
  const suggestionCount = useSuggestionCount(activeTab)
  const setViewMode = useSetAtom(setViewModeAtom)

  // Slide-over state
  const [slideOverOpen, setSlideOverOpen] = React.useState(false)
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null)
  const [selectedTaskEpicId, setSelectedTaskEpicId] = React.useState<string | null>(null)

  // Toggle chat panel
  const handleChatToggle = React.useCallback(() => {
    setIsChatOpen((prev) => !prev)
  }, [setIsChatOpen])

  // Toggle suggestion sidebar
  const handleSuggestionToggle = React.useCallback(() => {
    setIsSuggestionSidebarOpen((prev) => !prev)
  }, [setIsSuggestionSidebarOpen])

  // Handle suggestion action
  const handleSuggestionAction = React.useCallback(
    (suggestion: Suggestion) => {
      // Open chat panel and insert the appropriate command
      setIsChatOpen(true)

      // Map suggestion type to slash command
      const commandMap: Record<string, string> = {
        no_tasks: '/plan',
        all_done: '/review',
        no_specs: '/interview',
        no_dependencies: '', // Just opens graph view
        task_stuck: '', // Handled separately via onTaskClick
      }

      const command = commandMap[suggestion.type]
      if (command) {
        // Could dispatch to chat input here if needed
        console.log('[TasksMainContent] Suggestion action:', suggestion.type, command)
      }

      // Special handling for 'no_dependencies' - switch to graph view
      if (suggestion.type === 'no_dependencies' && activeTab) {
        setViewMode(activeTab, 'graph')
      }
    },
    [setIsChatOpen, activeTab, setViewMode]
  )

  // Handle task click - open slide-over
  const handleTaskClick = React.useCallback(
    (epicId: string, taskId: string) => {
      setSelectedTaskId(taskId)
      setSelectedTaskEpicId(epicId)
      setSlideOverOpen(true)
      // Also call parent callback if provided
      onTaskClick?.(epicId, taskId)
    },
    [onTaskClick]
  )

  // Handle task navigation from within slide-over (clicking a dependency)
  // Parses epicId from taskId format: "<epicId>.<taskNum>"
  const handleTaskNavigate = React.useCallback(
    (taskId: string) => {
      // Keep the slide-over open but switch to the new task
      setSelectedTaskId(taskId)

      // Parse epicId from taskId (format: "<epicId>.<num>")
      // e.g., "fn-1-interactive-guided-tasks-gui.5" -> "fn-1-interactive-guided-tasks-gui"
      const lastDotIndex = taskId.lastIndexOf('.')
      if (lastDotIndex > 0) {
        const parsedEpicId = taskId.substring(0, lastDotIndex)
        setSelectedTaskEpicId(parsedEpicId)
      }
    },
    []
  )

  // No tabs open - show empty state with create button
  if (openTabs.length === 0 || !activeTab) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center h-full gap-4 text-muted-foreground',
          className
        )}
      >
        <KanbanSquare className="h-10 w-10 text-foreground/40" />
        <div className="text-center">
          <p className="text-sm font-medium">Tasks</p>
          <p className="text-xs opacity-60 mt-1">Select an epic or create a new one</p>
        </div>
        {onAddTab && (
          <button
            onClick={onAddTab}
            data-tutorial="create-epic-button"
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              'bg-foreground text-background hover:bg-foreground/90',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            <Plus className="h-4 w-4" />
            Create Epic
          </button>
        )}
      </div>
    )
  }

  // Main content (tab bar, header, view)
  const mainContent = (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <EpicTabBar workspaceRoot={workspaceRoot} onAddTab={onAddTab} />

      {/* Epic header (for active tab) */}
      <EpicHeader
        epicId={activeTab}
        isChatOpen={isChatOpen}
        onChatToggle={handleChatToggle}
        isSuggestionSidebarOpen={isSuggestionSidebarOpen}
        onSuggestionToggle={handleSuggestionToggle}
        suggestionCount={suggestionCount}
      />

      {/* View content area */}
      <div className="flex-1 relative min-h-0" data-tutorial="kanban-area">
        {openTabs.map((epicId) => (
          <EpicViewContainer
            key={epicId}
            epicId={epicId}
            workspaceRoot={workspaceRoot}
            isActive={epicId === activeTab}
            onTaskClick={(taskId) => handleTaskClick(epicId, taskId)}
          />
        ))}
      </div>

      {/* Task detail slide-over */}
      <TaskDetailSlideOver
        open={slideOverOpen}
        onOpenChange={setSlideOverOpen}
        taskId={selectedTaskId}
        epicId={selectedTaskEpicId ?? activeTab}
        workspaceRoot={workspaceRoot}
        onTaskNavigate={handleTaskNavigate}
      />
    </div>
  )

  return (
    <AISuggestionSidebar
      epicId={activeTab}
      workspaceRoot={workspaceRoot}
      isOpen={isSuggestionSidebarOpen}
      onToggle={handleSuggestionToggle}
      onSuggestionAction={handleSuggestionAction}
      onTaskClick={(taskId) => handleTaskClick(activeTab, taskId)}
      className={className}
    >
      <EpicChatPanel
        epicId={activeTab}
        workspaceRoot={workspaceRoot}
        isOpen={isChatOpen}
        onToggle={handleChatToggle}
      >
        {mainContent}
      </EpicChatPanel>
    </AISuggestionSidebar>
  )
}
