/**
 * TaskDetailSlideOver
 *
 * Slide-over panel that opens from the right when clicking a task card.
 * Contains tabbed content: Spec, Deps, Activity.
 *
 * Features:
 * - Radix Dialog for accessibility (focus trap, aria attributes)
 * - Motion spring animation for slide-in/out
 * - Sticky header with task info and action buttons
 * - Sticky tab bar with independent scrolling tab panels
 * - Escape key closes panel
 */

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'motion/react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  X,
  PlayCircle,
  CheckCircle2,
  Lock,
  Circle,
  Loader2,
  FileText,
  GitBranch,
  Activity,
} from 'lucide-react'
import { toast } from 'sonner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { TaskSpecTab } from './TaskSpecTab'
import { TaskDepsTab, type DependencyTask } from './TaskDepsTab'
import { TaskActivityTab } from './TaskActivityTab'
import {
  tasksAtomFamily,
  updateTaskStatusAtom,
} from '@/atoms/tasks-state'
import type { Task, TaskStatus, FlowBridgeResult } from '../../../shared/flow-schemas'

// Spring transition config - snappy, no bounce
const springTransition = {
  type: 'spring' as const,
  stiffness: 600,
  damping: 49,
}

export interface TaskDetailSlideOverProps {
  /** Whether the panel is open */
  open: boolean
  /** Callback when panel open state changes */
  onOpenChange: (open: boolean) => void
  /** Task ID to display */
  taskId: string | null
  /** Epic ID the task belongs to */
  epicId: string
  /** Workspace root for IPC calls */
  workspaceRoot: string
  /** Callback when a dependency task is clicked (to navigate) */
  onTaskNavigate?: (taskId: string) => void
}

const STATUS_ICONS: Record<TaskStatus, React.ComponentType<{ className?: string }>> = {
  todo: Circle,
  in_progress: PlayCircle,
  blocked: Lock,
  done: CheckCircle2,
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  todo: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20',
  in_progress: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  blocked: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  done: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
}

type LoadingState = 'idle' | 'loading' | 'success' | 'error'

export function TaskDetailSlideOver({
  open,
  onOpenChange,
  taskId,
  epicId,
  workspaceRoot,
  onTaskNavigate,
}: TaskDetailSlideOverProps) {
  const [task, setTask] = React.useState<Task | null>(null)
  const [loadingState, setLoadingState] = React.useState<LoadingState>('idle')
  const [error, setError] = React.useState<string | null>(null)
  const [actionLoading, setActionLoading] = React.useState(false)

  // Get all tasks for dependency resolution
  const allTasks = useAtomValue(tasksAtomFamily(epicId))
  const updateTaskStatus = useSetAtom(updateTaskStatusAtom)

  // Fetch task details helper
  const fetchTaskDetails = React.useCallback(async () => {
    if (!taskId || !workspaceRoot) return

    setLoadingState('loading')
    setError(null)

    try {
      const result: FlowBridgeResult<Task> = await window.electronAPI.flowTaskShow(workspaceRoot, taskId)
      if (result.ok) {
        setTask(result.data)
        setLoadingState('success')
      } else {
        const errorMsg =
          result.error.type === 'command_failed'
            ? result.error.stderr || 'Failed to load task'
            : result.error.type === 'flowctl_not_found'
              ? 'flowctl not found'
              : 'Failed to load task'
        setError(errorMsg)
        setLoadingState('error')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load task')
      setLoadingState('error')
    }
  }, [taskId, workspaceRoot])

  // Fetch full task details when taskId changes
  React.useEffect(() => {
    if (!taskId || !open) {
      setTask(null)
      setLoadingState('idle')
      setError(null)
      return
    }

    fetchTaskDetails()
  }, [taskId, open, fetchTaskDetails])

  // Subscribe to flow:changed events for live updates
  React.useEffect(() => {
    if (!taskId || !open || !workspaceRoot) return

    const cleanup = window.electronAPI.onFlowChanged((changedWorkspaceRoot, payload) => {
      // Refetch if change affects our task
      if (changedWorkspaceRoot === workspaceRoot && payload.type === 'task') {
        fetchTaskDetails()
      }
    })

    return cleanup
  }, [taskId, open, workspaceRoot, fetchTaskDetails])

  // Build dependency lists
  const { blockedBy, blocking } = React.useMemo(() => {
    if (!task) return { blockedBy: [], blocking: [] }

    // Tasks that this task depends on (blocked by)
    const blockedByTasks: DependencyTask[] = task.depends_on
      .map((depId) => {
        const depTask = allTasks.find((t) => t.id === depId)
        return depTask
          ? { id: depTask.id, title: depTask.title, status: depTask.status }
          : null
      })
      .filter((t): t is DependencyTask => t !== null)

    // Tasks that depend on this task (blocking)
    const blockingTasks: DependencyTask[] = allTasks
      .filter((t) => t.depends_on.includes(task.id))
      .map((t) => ({ id: t.id, title: t.title, status: t.status }))

    return { blockedBy: blockedByTasks, blocking: blockingTasks }
  }, [task, allTasks])

  // Handle status action buttons
  // Note: Relies on flow:changed event subscription to update task data after status change
  const handleStartTask = async () => {
    if (!task || actionLoading) return
    setActionLoading(true)

    try {
      await updateTaskStatus(workspaceRoot, epicId, task.id, 'in_progress')
      // flow:changed event will trigger refetch via subscription
    } catch (err) {
      // Error toast is shown by updateTaskStatus atom
    } finally {
      setActionLoading(false)
    }
  }

  const handleCompleteTask = async () => {
    if (!task || actionLoading) return
    setActionLoading(true)

    try {
      await updateTaskStatus(workspaceRoot, epicId, task.id, 'done')
      // flow:changed event will trigger refetch via subscription
    } catch (err) {
      // Error toast is shown by updateTaskStatus atom
    } finally {
      setActionLoading(false)
    }
  }

  // Handle dependency task click
  const handleDependencyClick = (depTaskId: string) => {
    if (onTaskNavigate) {
      onTaskNavigate(depTaskId)
    }
  }

  // Render action buttons based on current status
  const renderActionButtons = () => {
    if (!task) return null

    switch (task.status) {
      case 'todo':
        return (
          <Button
            size="sm"
            onClick={handleStartTask}
            disabled={actionLoading}
            className="gap-1.5"
          >
            {actionLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlayCircle className="h-3.5 w-3.5" />
            )}
            Start
          </Button>
        )
      case 'in_progress':
        return (
          <Button
            size="sm"
            onClick={handleCompleteTask}
            disabled={actionLoading}
            className="gap-1.5"
          >
            {actionLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Complete
          </Button>
        )
      case 'done':
        return (
          <Badge variant="outline" className={cn('text-xs', STATUS_COLORS.done)}>
            Completed
          </Badge>
        )
      case 'blocked':
        return (
          <Badge variant="outline" className={cn('text-xs', STATUS_COLORS.blocked)}>
            Blocked
          </Badge>
        )
      default:
        return null
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            {/* Overlay */}
            <DialogPrimitive.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-modal bg-black/40"
              />
            </DialogPrimitive.Overlay>

            {/* Content - Slide from right */}
            <DialogPrimitive.Content asChild>
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={springTransition}
                className={cn(
                  'fixed inset-y-0 right-0 z-modal w-[400px] max-w-[90vw]',
                  'bg-background border-l border-border shadow-modal-small',
                  'flex flex-col outline-none'
                )}
              >
                {/* Loading state */}
                {loadingState === 'loading' && (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}

                {/* Error state */}
                {loadingState === 'error' && (
                  <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
                    <p className="text-sm text-muted-foreground">{error || 'Failed to load task'}</p>
                    <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                      Close
                    </Button>
                  </div>
                )}

                {/* Content when loaded */}
                {loadingState === 'success' && task && (
                  <>
                    {/* Header - sticky */}
                    <div className="shrink-0 px-4 py-3 border-b border-border/50">
                      {/* Close button */}
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs text-muted-foreground font-mono">{task.id}</p>
                        <DialogPrimitive.Close asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <X className="h-4 w-4" />
                            <span className="sr-only">Close</span>
                          </Button>
                        </DialogPrimitive.Close>
                      </div>

                      {/* Title */}
                      <h2 className="text-base font-semibold pr-8 mb-3">{task.title}</h2>

                      {/* Status badge and action buttons */}
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn('text-xs', STATUS_COLORS[task.status])}
                        >
                          {STATUS_LABELS[task.status]}
                        </Badge>
                        <div className="flex-1" />
                        {renderActionButtons()}
                      </div>
                    </div>

                    {/* Tabs */}
                    <Tabs defaultValue="spec" className="flex-1 flex flex-col min-h-0">
                      {/* Tab bar - sticky */}
                      <TabsList className="shrink-0 mx-4 mt-3 h-9 w-auto">
                        <TabsTrigger value="spec" className="gap-1.5 text-xs">
                          <FileText className="h-3.5 w-3.5" />
                          Spec
                        </TabsTrigger>
                        <TabsTrigger value="deps" className="gap-1.5 text-xs">
                          <GitBranch className="h-3.5 w-3.5" />
                          Deps
                          {(blockedBy.length > 0 || blocking.length > 0) && (
                            <Badge
                              variant="secondary"
                              className="ml-1 h-4 min-w-4 px-1 text-[10px]"
                            >
                              {blockedBy.length + blocking.length}
                            </Badge>
                          )}
                        </TabsTrigger>
                        <TabsTrigger value="activity" className="gap-1.5 text-xs">
                          <Activity className="h-3.5 w-3.5" />
                          Activity
                        </TabsTrigger>
                      </TabsList>

                      {/* Tab panels - scrollable */}
                      <div className="flex-1 min-h-0 mt-3">
                        <TabsContent value="spec" className="h-full m-0 data-[state=inactive]:hidden">
                          <TaskSpecTab specPath={task.spec_path} className="h-full" />
                        </TabsContent>

                        <TabsContent value="deps" className="h-full m-0 data-[state=inactive]:hidden">
                          <TaskDepsTab
                            taskId={task.id}
                            blockedBy={blockedBy}
                            blocking={blocking}
                            onTaskClick={handleDependencyClick}
                            className="h-full"
                          />
                        </TabsContent>

                        <TabsContent value="activity" className="h-full m-0 data-[state=inactive]:hidden">
                          <TaskActivityTab
                            createdAt={task.created_at}
                            updatedAt={task.updated_at}
                            status={task.status}
                            assignee={task.assignee}
                            claimedAt={task.claimed_at}
                            className="h-full"
                          />
                        </TabsContent>
                      </div>
                    </Tabs>
                  </>
                )}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}
