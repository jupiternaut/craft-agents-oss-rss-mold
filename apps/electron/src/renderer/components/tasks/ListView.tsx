/**
 * ListView
 *
 * Simple table/list view for tasks when there are few tasks (<5).
 * Shows: task title, status, size (extracted from title), assignee.
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Circle, CheckCircle2, Loader2, AlertCircle, ChevronRight, Sparkles, MessageSquare, ListTodo } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { TaskStatus, TaskSummary } from '../../../shared/flow-schemas'
import {
  tasksAtomFamily,
  tasksLoadingAtomFamily,
  loadTasksAtom,
  suggestionSidebarOpenAtom,
} from '@/atoms/tasks-state'
import { epicChatOpenAtom } from './EpicChatPanel'

export interface ListViewProps {
  /** Epic ID to display tasks for */
  epicId: string
  /** Workspace root for IPC calls */
  workspaceRoot: string
  /** Callback when a task is clicked */
  onTaskClick?: (taskId: string) => void
  /** Optional className */
  className?: string
}

/**
 * Empty state component shown when epic has no tasks.
 * Provides actionable guidance for what to do next.
 */
function EmptyTasksState() {
  const setIsChatOpen = useSetAtom(epicChatOpenAtom)
  const setIsSuggestionsOpen = useSetAtom(suggestionSidebarOpenAtom)

  const handleOpenChat = React.useCallback(() => {
    setIsChatOpen(true)
  }, [setIsChatOpen])

  const handleOpenSuggestions = React.useCallback(() => {
    setIsSuggestionsOpen(true)
  }, [setIsSuggestionsOpen])

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
        <ListTodo className="h-6 w-6 text-blue-500" />
      </div>
      <h3 className="text-base font-medium mb-1">No tasks yet</h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-[280px]">
        This epic needs tasks to work on. Use AI to plan tasks or check suggestions.
      </p>
      <div className="flex flex-col gap-2 w-full max-w-[200px]">
        <Button
          variant="default"
          size="sm"
          onClick={handleOpenChat}
          className="w-full gap-2"
        >
          <MessageSquare className="h-4 w-4" />
          Open Chat & Run /plan
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenSuggestions}
          className="w-full gap-2"
        >
          <Sparkles className="h-4 w-4" />
          View Suggestions
        </Button>
      </div>
      <p className="text-xs text-muted-foreground/60 mt-4">
        Tip: Type <code className="px-1 py-0.5 bg-foreground/5 rounded text-[11px]">/plan</code> in the chat to generate tasks from your epic description.
      </p>
    </div>
  )
}

/** Extract size tag from title (e.g., "[S]", "[M]", "[L]", "[XL]") */
function extractSizeFromTitle(title: string): string | null {
  const match = title.match(/\[([SMLX]+)\]/i)
  return match ? match[1].toUpperCase() : null
}

/** Status badge styling and icons */
const STATUS_CONFIG: Record<TaskStatus, { label: string; icon: React.ReactNode; className: string }> = {
  todo: {
    label: 'To Do',
    icon: <Circle className="h-3.5 w-3.5" />,
    className: 'bg-muted/50 text-muted-foreground border-border/50',
  },
  in_progress: {
    label: 'In Progress',
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    className: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  },
  blocked: {
    label: 'Blocked',
    icon: <AlertCircle className="h-3.5 w-3.5" />,
    className: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  },
  done: {
    label: 'Done',
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  },
}

interface TaskRowProps {
  task: TaskSummary
  onClick?: () => void
}

function TaskRow({ task, onClick }: TaskRowProps) {
  const config = STATUS_CONFIG[task.status]
  const size = extractSizeFromTitle(task.title)
  // Clean title (remove size tag for display)
  const cleanTitle = task.title.replace(/\s*\[[SMLX]+\]\s*/i, ' ').trim()

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 text-left',
        'border-b border-border/30 last:border-b-0',
        'hover:bg-foreground/[0.02] transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
      )}
    >
      {/* Status indicator */}
      <div className={cn('shrink-0', config.className.includes('text-') ? config.className.split(' ').find(c => c.startsWith('text-')) : 'text-muted-foreground')}>
        {config.icon}
      </div>

      {/* Title */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{cleanTitle}</p>
        <p className="text-xs text-muted-foreground truncate">{task.id}</p>
      </div>

      {/* Size badge */}
      {size && (
        <Badge
          variant="outline"
          className="shrink-0 text-[10px] px-1.5 py-0 h-5"
        >
          {size}
        </Badge>
      )}

      {/* Status badge */}
      <Badge
        variant="outline"
        className={cn('shrink-0 text-xs', config.className)}
      >
        {config.label}
      </Badge>

      {/* Chevron */}
      <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
    </button>
  )
}

export function ListView({
  epicId,
  workspaceRoot,
  onTaskClick,
  className,
}: ListViewProps) {
  const tasks = useAtomValue(tasksAtomFamily(epicId))
  const loadingState = useAtomValue(tasksLoadingAtomFamily(epicId))
  const loadTasks = useSetAtom(loadTasksAtom)

  // Load tasks when epicId or workspaceRoot changes
  React.useEffect(() => {
    if (epicId && workspaceRoot) {
      loadTasks(workspaceRoot, epicId)
    }
  }, [epicId, workspaceRoot, loadTasks])

  // Subscribe to flow:changed events for live updates
  React.useEffect(() => {
    if (!workspaceRoot || !epicId) return

    const cleanup = window.electronAPI.onFlowChanged((changedWorkspaceRoot, payload) => {
      if (changedWorkspaceRoot === workspaceRoot && (payload.type === 'task' || payload.type === 'epic')) {
        loadTasks(workspaceRoot, epicId)
      }
    })

    return cleanup
  }, [workspaceRoot, epicId, loadTasks])

  // Loading state
  if (loadingState === 'loading' && tasks.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <span className="text-sm text-muted-foreground">Loading tasks...</span>
      </div>
    )
  }

  // Empty state - show actionable guidance
  if (tasks.length === 0) {
    return (
      <div className={cn('h-full', className)}>
        <EmptyTasksState />
      </div>
    )
  }

  // Sort tasks: in_progress first, then todo, blocked, done
  const sortedTasks = [...tasks].sort((a, b) => {
    const order: Record<TaskStatus, number> = {
      in_progress: 0,
      todo: 1,
      blocked: 2,
      done: 3,
    }
    return order[a.status] - order[b.status]
  })

  return (
    <ScrollArea className={cn('h-full', className)}>
      <div className="divide-y divide-border/30">
        {sortedTasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            onClick={() => onTaskClick?.(task.id)}
          />
        ))}
      </div>
    </ScrollArea>
  )
}
