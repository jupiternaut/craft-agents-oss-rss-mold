/**
 * AISuggestionSidebar
 *
 * Collapsible AI suggestion sidebar that analyzes current epic/task state
 * and recommends actions. Appears as a right panel that can be toggled.
 *
 * Features:
 * - Rule-based suggestions (not LLM-powered)
 * - Debounced re-evaluation on state change (500ms)
 * - Max 3 suggestions shown, prioritized by urgency
 * - Dismissable suggestions (remembered per epic)
 * - Smooth animations with Motion AnimatePresence
 * - Auto-prompt banner when all tasks are done
 */

import * as React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Sparkles, ChevronRight, PartyPopper } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SuggestionCard, type Suggestion, type SuggestionType } from './SuggestionCard'

// Re-export types for consumers
export type { Suggestion, SuggestionType }
import {
  epicsAtom,
  epicsLoadingStateAtom,
  tasksAtomFamily,
  suggestionSidebarOpenAtom,
  dismissedSuggestionsAtomFamily,
  epicReviewPromptShownAtomFamily,
} from '@/atoms/tasks-state'
import type { TaskSummary, EpicSummary } from '../../../shared/flow-schemas'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Debounce delay for re-evaluating suggestions (ms) */
const DEBOUNCE_DELAY = 500

/** Maximum number of suggestions to show */
const MAX_SUGGESTIONS = 3

/** Time threshold for "stuck" task detection (24 hours in ms) */
const STUCK_THRESHOLD_MS = 24 * 60 * 60 * 1000

// ─── Suggestion Generation ────────────────────────────────────────────────────

/**
 * Generate rule-based suggestions for the current epic state.
 * Rules:
 * - Epic has no tasks -> "Run /plan to create tasks"
 * - Task stuck in_progress >24h -> "Check on this task"
 * - All tasks done -> "Run epic review"
 * - Epic has no dependencies -> "Add dependencies if needed"
 * - Tasks have no specs -> "Interview to add detail"
 */
function generateSuggestions(
  epic: EpicSummary | null,
  tasks: TaskSummary[],
  dismissedIds: string[]
): Suggestion[] {
  const suggestions: Suggestion[] = []

  if (!epic) return suggestions

  const dismissedSet = new Set(dismissedIds)

  // Rule 1: Epic has no tasks
  if (tasks.length === 0) {
    const id = `${epic.id}:no_tasks`
    if (!dismissedSet.has(id)) {
      suggestions.push({
        id,
        type: 'no_tasks',
        title: 'Create tasks',
        description: 'This epic has no tasks yet. Run /plan to generate an implementation plan.',
        actionLabel: 'Run /plan',
        priority: 100,
      })
    }
  }

  // Rule 2: Task stuck in_progress > 24h
  // Note: TaskSummary doesn't have timestamps, so we'd need to track this separately
  // For now, we'll check if any task has been in_progress status
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress')
  for (const task of inProgressTasks) {
    // Since we don't have timestamp data, we'll show this for any in_progress task
    // In production, you'd check updated_at or claimed_at
    const id = `${epic.id}:task_stuck:${task.id}`
    if (!dismissedSet.has(id)) {
      suggestions.push({
        id,
        type: 'task_stuck',
        title: 'Check on task',
        description: `"${task.title}" is in progress. Make sure it's not blocked.`,
        actionLabel: 'View task',
        priority: 80,
        taskId: task.id,
      })
    }
  }

  // Rule 3: All tasks done
  if (tasks.length > 0 && tasks.every((t) => t.status === 'done')) {
    const id = `${epic.id}:all_done`
    if (!dismissedSet.has(id)) {
      suggestions.push({
        id,
        type: 'all_done',
        title: 'Review epic',
        description: 'All tasks are complete! Run a final review before closing the epic.',
        actionLabel: 'Run /review',
        priority: 95,
      })
    }
  }

  // Rule 4: No dependencies defined
  const hasDependencies = tasks.some((t) => t.depends_on && t.depends_on.length > 0)
  if (tasks.length > 1 && !hasDependencies) {
    const id = `${epic.id}:no_dependencies`
    if (!dismissedSet.has(id)) {
      suggestions.push({
        id,
        type: 'no_dependencies',
        title: 'Add dependencies',
        description: 'Consider adding task dependencies to clarify the execution order.',
        actionLabel: 'View graph',
        priority: 30,
      })
    }
  }

  // Rule 5: Tasks without detailed specs (checking if title is short)
  // In production, you'd check the actual spec content
  const shortTitleTasks = tasks.filter(
    (t) => t.title.length < 30 && t.status === 'todo'
  )
  if (shortTitleTasks.length > 0) {
    const id = `${epic.id}:no_specs`
    if (!dismissedSet.has(id)) {
      suggestions.push({
        id,
        type: 'no_specs',
        title: 'Add more detail',
        description: `${shortTitleTasks.length} task(s) may need more detailed specs. Run /interview to clarify.`,
        actionLabel: 'Run /interview',
        priority: 40,
      })
    }
  }

  // Sort by priority (highest first) and limit to MAX_SUGGESTIONS
  return suggestions
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_SUGGESTIONS)
}

// ─── Hook: useDebouncedSuggestions ────────────────────────────────────────────

function useDebouncedSuggestions(
  epic: EpicSummary | null,
  tasks: TaskSummary[],
  dismissedIds: string[]
): Suggestion[] {
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([])
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // Debounce suggestion generation
    timeoutRef.current = setTimeout(() => {
      const newSuggestions = generateSuggestions(epic, tasks, dismissedIds)
      setSuggestions(newSuggestions)
    }, DEBOUNCE_DELAY)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [epic, tasks, dismissedIds])

  return suggestions
}

// ─── All Tasks Done Banner ────────────────────────────────────────────────────

interface AllTasksDoneBannerProps {
  epicId: string
  onReview: () => void
  onDismiss: () => void
}

function AllTasksDoneBanner({ epicId, onReview, onDismiss }: AllTasksDoneBannerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        'mx-3 mb-3 p-4 rounded-lg',
        'bg-gradient-to-r from-emerald-500/10 to-blue-500/10',
        'border border-emerald-500/20'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <PartyPopper className="h-5 w-5 text-emerald-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-emerald-600">
            All tasks complete!
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Great work! Run a final review to ensure everything is ready.
          </p>
          <div className="flex gap-2 mt-3">
            <Button
              variant="default"
              size="sm"
              onClick={onReview}
              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
            >
              Run /review
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              className="h-7 text-xs"
            >
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ─── Toggle Button ────────────────────────────────────────────────────────────

export interface SuggestionToggleButtonProps {
  onClick: () => void
  isOpen: boolean
  suggestionCount: number
  className?: string
}

export function SuggestionToggleButton({
  onClick,
  isOpen,
  suggestionCount,
  className,
}: SuggestionToggleButtonProps) {
  return (
    <Button
      variant={isOpen ? 'secondary' : 'ghost'}
      size="sm"
      onClick={onClick}
      className={cn('gap-1.5 relative', className)}
    >
      <Sparkles className="h-4 w-4" />
      <span>Suggestions</span>
      {suggestionCount > 0 && !isOpen && (
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-blue-500 text-[10px] font-medium text-white flex items-center justify-center">
          {suggestionCount}
        </span>
      )}
    </Button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export interface AISuggestionSidebarProps {
  /** Currently active epic ID */
  epicId: string | null
  /** Workspace root for IPC calls */
  workspaceRoot: string
  /** Whether the sidebar is open */
  isOpen: boolean
  /** Callback to toggle sidebar */
  onToggle: () => void
  /** Callback to execute a suggestion action */
  onSuggestionAction: (suggestion: Suggestion) => void
  /** Callback when task is clicked (for 'task_stuck' suggestions) */
  onTaskClick?: (taskId: string) => void
  /** Children to render in main content area */
  children: React.ReactNode
  /** Optional className */
  className?: string
}

export function AISuggestionSidebar({
  epicId,
  workspaceRoot,
  isOpen,
  onToggle,
  onSuggestionAction,
  onTaskClick,
  children,
  className,
}: AISuggestionSidebarProps) {
  const epics = useAtomValue(epicsAtom)
  const epicsLoading = useAtomValue(epicsLoadingStateAtom)
  const tasks = useAtomValue(epicId ? tasksAtomFamily(epicId) : tasksAtomFamily('__empty__'))
  const [dismissedIds, setDismissedIds] = useAtom(
    epicId ? dismissedSuggestionsAtomFamily(epicId) : dismissedSuggestionsAtomFamily('__empty__')
  )
  const [reviewPromptShown, setReviewPromptShown] = useAtom(
    epicId ? epicReviewPromptShownAtomFamily(epicId) : epicReviewPromptShownAtomFamily('__empty__')
  )

  const epic = epicId ? epics.find((e) => e.id === epicId) ?? null : null

  // Generate debounced suggestions
  const suggestions = useDebouncedSuggestions(epic, tasks, dismissedIds)

  // Check if all tasks are done (for banner)
  const allTasksDone = tasks.length > 0 && tasks.every((t) => t.status === 'done')
  const showBanner = allTasksDone && !reviewPromptShown && epic?.status !== 'done'

  // Show toast when all tasks become done
  React.useEffect(() => {
    if (allTasksDone && !reviewPromptShown && epic && epic.status !== 'done') {
      toast.success('All tasks complete!', {
        description: `Epic "${epic.title}" is ready for review.`,
        action: {
          label: 'Review',
          onClick: () => {
            // Trigger review action
            onSuggestionAction({
              id: `${epic.id}:all_done`,
              type: 'all_done',
              title: 'Review epic',
              description: 'Run a final review before closing the epic.',
              actionLabel: 'Run /review',
              priority: 95,
            })
          },
        },
      })
    }
  }, [allTasksDone, reviewPromptShown, epic, onSuggestionAction])

  // Handle dismiss
  const handleDismiss = React.useCallback(
    (suggestionId: string) => {
      setDismissedIds((prev) => [...prev, suggestionId])
    },
    [setDismissedIds]
  )

  // Handle banner dismiss
  const handleBannerDismiss = React.useCallback(() => {
    setReviewPromptShown(true)
  }, [setReviewPromptShown])

  // Handle banner review action
  const handleBannerReview = React.useCallback(() => {
    if (!epic) return
    setReviewPromptShown(true)
    onSuggestionAction({
      id: `${epic.id}:all_done`,
      type: 'all_done',
      title: 'Review epic',
      description: 'Run a final review before closing the epic.',
      actionLabel: 'Run /review',
      priority: 95,
    })
  }, [epic, setReviewPromptShown, onSuggestionAction])

  // Handle suggestion action
  const handleAction = React.useCallback(
    (suggestion: Suggestion) => {
      // For task_stuck, navigate to task
      if (suggestion.type === 'task_stuck' && suggestion.taskId && onTaskClick) {
        onTaskClick(suggestion.taskId)
      } else {
        onSuggestionAction(suggestion)
      }
    },
    [onSuggestionAction, onTaskClick]
  )

  // Don't show sidebar when .flow/ doesn't exist (error state or loading)
  const showSidebar = isOpen && epicsLoading === 'success' && epicId

  // Spring transition
  const springTransition = {
    type: 'spring' as const,
    stiffness: 600,
    damping: 49,
  }

  return (
    <div className={cn('flex h-full overflow-hidden', className)}>
      {/* Main content */}
      <div className="flex-1 min-w-0 h-full relative z-panel">{children}</div>

      {/* Sidebar */}
      <AnimatePresence initial={false}>
        {showSidebar && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={springTransition}
            className="h-full border-l border-border/50 bg-background/50 flex flex-col overflow-hidden relative z-panel"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-3 border-b border-border/50">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium">Suggestions</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={onToggle}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Content */}
            <ScrollArea className="flex-1">
              <div className="py-3">
                {/* All tasks done banner */}
                <AnimatePresence>
                  {showBanner && epicId && (
                    <AllTasksDoneBanner
                      epicId={epicId}
                      onReview={handleBannerReview}
                      onDismiss={handleBannerDismiss}
                    />
                  )}
                </AnimatePresence>

                {/* Suggestions */}
                <AnimatePresence mode="popLayout">
                  {suggestions.length > 0 ? (
                    <div className="space-y-2 px-3">
                      {suggestions.map((suggestion) => (
                        <SuggestionCard
                          key={suggestion.id}
                          suggestion={suggestion}
                          onAction={handleAction}
                          onDismiss={handleDismiss}
                        />
                      ))}
                    </div>
                  ) : !showBanner ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="px-3 py-8 text-center"
                    >
                      <Sparkles className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">
                        No suggestions right now
                      </p>
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        Suggestions appear based on epic state
                      </p>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Hook for suggestion count ────────────────────────────────────────────────

/**
 * Hook to get suggestion count for the toggle button badge.
 * Re-evaluates on epic/task state change with debounce.
 */
export function useSuggestionCount(epicId: string | null): number {
  const epics = useAtomValue(epicsAtom)
  const epicsLoading = useAtomValue(epicsLoadingStateAtom)
  const tasks = useAtomValue(epicId ? tasksAtomFamily(epicId) : tasksAtomFamily('__empty__'))
  const dismissedIds = useAtomValue(
    epicId ? dismissedSuggestionsAtomFamily(epicId) : dismissedSuggestionsAtomFamily('__empty__')
  )

  const epic = epicId ? epics.find((e) => e.id === epicId) ?? null : null

  // Don't count when not loaded
  if (epicsLoading !== 'success' || !epicId) return 0

  const suggestions = generateSuggestions(epic, tasks, dismissedIds)
  return suggestions.length
}
