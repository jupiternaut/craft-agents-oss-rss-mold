/**
 * KanbanBoard
 *
 * Main Kanban board view for the Tasks panel.
 * Four columns (todo, in_progress, blocked, done) with task cards and drag-drop.
 *
 * Features:
 * - Drag-drop status changes via @dnd-kit
 * - Optimistic updates with rollback on failure
 * - Keyboard sensor for accessibility
 * - DragOverlay for floating preview
 * - Sonner toast for error feedback
 */

import * as React from 'react'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { toast } from 'sonner'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { KanbanColumn } from './KanbanColumn'
import { KanbanDragOverlay } from './KanbanDragOverlay'
import type { TaskCardData } from './TaskCard'
import type { TaskStatus, TaskSummary } from '../../../shared/flow-schemas'
import {
  tasksAtomFamily,
  tasksLoadingAtomFamily,
  loadTasksAtom,
  updateTaskStatusAtom,
} from '@/atoms/tasks-state'

export interface KanbanBoardProps {
  /** Currently selected epic ID */
  epicId: string
  /** Workspace root for IPC calls */
  workspaceRoot: string
  /** Callback when a task card is clicked */
  onTaskClick?: (taskId: string) => void
  /** Optional className */
  className?: string
}

/** Column definitions in display order */
const COLUMNS: Array<{ status: TaskStatus; title: string }> = [
  { status: 'todo', title: 'To Do' },
  { status: 'in_progress', title: 'In Progress' },
  { status: 'blocked', title: 'Blocked' },
  { status: 'done', title: 'Done' },
]

/** Valid status values for drop target validation */
const VALID_STATUSES = COLUMNS.map((c) => c.status)

/**
 * Convert TaskSummary to TaskCardData
 */
function taskSummaryToCardData(task: TaskSummary, allTasks: TaskSummary[]): TaskCardData {
  // Determine if blocked: has unresolved dependencies (deps not done)
  const unresolvedDeps = task.depends_on.filter((depId) => {
    const depTask = allTasks.find((t) => t.id === depId)
    return depTask && depTask.status !== 'done'
  })
  const isBlocked = task.status === 'blocked' || (unresolvedDeps.length > 0 && task.status === 'todo')

  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    depends_on: task.depends_on,
    isBlocked,
    // assignee and size not in TaskSummary - would need full Task fetch
    // For now, leave undefined (TaskCard extracts size from title)
  }
}

/**
 * Group tasks by status into columns
 */
function groupTasksByStatus(tasks: TaskCardData[]): Map<TaskStatus, TaskCardData[]> {
  const grouped = new Map<TaskStatus, TaskCardData[]>()
  for (const status of ['todo', 'in_progress', 'blocked', 'done'] as TaskStatus[]) {
    grouped.set(status, [])
  }
  for (const task of tasks) {
    const column = grouped.get(task.status)
    if (column) {
      column.push(task)
    }
  }
  return grouped
}

export function KanbanBoard({
  epicId,
  workspaceRoot,
  onTaskClick,
  className,
}: KanbanBoardProps) {
  const tasks = useAtomValue(tasksAtomFamily(epicId))
  const loadingState = useAtomValue(tasksLoadingAtomFamily(epicId))
  const loadTasks = useSetAtom(loadTasksAtom)
  const updateTaskStatus = useSetAtom(updateTaskStatusAtom)

  // Track the active (dragging) task
  const [activeTask, setActiveTask] = React.useState<TaskCardData | null>(null)

  // Sensors: PointerSensor with 8px activation distance, KeyboardSensor for a11y
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor)
  )

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
      // Reload if change is for our workspace and affects tasks
      if (changedWorkspaceRoot === workspaceRoot && (payload.type === 'task' || payload.type === 'epic')) {
        console.log('[KanbanBoard] flow:changed event received:', payload)
        loadTasks(workspaceRoot, epicId)
      }
    })

    return cleanup
  }, [workspaceRoot, epicId, loadTasks])

  // Convert tasks to card data
  const cardTasks = React.useMemo(
    () => tasks.map((t) => taskSummaryToCardData(t, tasks)),
    [tasks]
  )

  // Group by status
  const tasksByStatus = React.useMemo(
    () => groupTasksByStatus(cardTasks),
    [cardTasks]
  )

  // Handle drag start
  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    const task = event.active.data.current?.task as TaskCardData | undefined
    if (task) {
      setActiveTask(task)
    }
  }, [])

  // Handle drag end
  const handleDragEnd = React.useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      setActiveTask(null)

      if (!over) return

      const sourceTask = active.data.current?.task as TaskCardData | undefined

      if (!sourceTask) return

      // Validate drop target is a known status
      const targetStatusStr = over.id as string
      if (!VALID_STATUSES.includes(targetStatusStr as TaskStatus)) {
        console.warn('[KanbanBoard] Invalid drop target:', over.id)
        return
      }
      const targetStatus = targetStatusStr as TaskStatus

      // No-op if dropping in same column
      if (sourceTask.status === targetStatus) return

      // Optimistic update via atom action (handles rollback internally)
      // Pass epicId explicitly to avoid fragile task ID parsing
      try {
        await updateTaskStatus(workspaceRoot, epicId, sourceTask.id, targetStatus)
      } catch (err) {
        // updateTaskStatus atom already shows toast on failure
        console.error('[KanbanBoard] Status update failed:', err)
      }
    },
    [workspaceRoot, epicId, updateTaskStatus]
  )

  // Handle drag cancel
  const handleDragCancel = React.useCallback(() => {
    setActiveTask(null)
  }, [])

  // Loading state
  if (loadingState === 'loading' && tasks.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <span className="text-sm text-muted-foreground">Loading tasks...</span>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <ScrollArea className={cn('h-full', className)}>
        <div className="flex gap-4 p-4 min-h-full">
          {COLUMNS.map(({ status, title }) => (
            <KanbanColumn
              key={status}
              status={status}
              title={title}
              tasks={tasksByStatus.get(status) ?? []}
              onTaskClick={onTaskClick}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <KanbanDragOverlay activeTask={activeTask} />
    </DndContext>
  )
}
