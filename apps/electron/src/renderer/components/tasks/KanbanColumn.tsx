/**
 * KanbanColumn
 *
 * Droppable column for the Kanban board.
 * Accepts task cards via drag-drop and displays a list of tasks.
 *
 * Uses @dnd-kit useDroppable for drop target support.
 */

import * as React from 'react'
import { useDroppable } from '@dnd-kit/core'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { DraggableTaskCard, type TaskCardData } from './TaskCard'
import type { TaskStatus } from '../../../shared/flow-schemas'

export interface KanbanColumnProps {
  /** Column status (todo, in_progress, blocked, done) */
  status: TaskStatus
  /** Column title */
  title: string
  /** Tasks to display in this column */
  tasks: TaskCardData[]
  /** Callback when a task card is clicked */
  onTaskClick?: (taskId: string) => void
  /** Optional className */
  className?: string
}

const COLUMN_COLORS: Record<TaskStatus, { bg: string; border: string; accent: string }> = {
  todo: {
    bg: 'bg-zinc-500/5',
    border: 'border-zinc-500/10',
    accent: 'bg-zinc-500',
  },
  in_progress: {
    bg: 'bg-blue-500/5',
    border: 'border-blue-500/10',
    accent: 'bg-blue-500',
  },
  blocked: {
    bg: 'bg-orange-500/5',
    border: 'border-orange-500/10',
    accent: 'bg-orange-500',
  },
  done: {
    bg: 'bg-emerald-500/5',
    border: 'border-emerald-500/10',
    accent: 'bg-emerald-500',
  },
}

export function KanbanColumn({
  status,
  title,
  tasks,
  onTaskClick,
  className,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    data: { status },
  })

  const colors = COLUMN_COLORS[status]

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col min-w-[280px] max-w-[320px] flex-1 rounded-lg border',
        colors.bg,
        colors.border,
        isOver && 'ring-2 ring-blue-500/50',
        className
      )}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-inherit">
        {/* Status accent dot */}
        <div className={cn('h-2 w-2 rounded-full shrink-0', colors.accent)} />
        <span className="text-sm font-medium flex-1">{title}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {tasks.length}
        </span>
      </div>

      {/* Task list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-2">
          {tasks.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-xs text-muted-foreground">
              No tasks
            </div>
          ) : (
            tasks.map((task) => (
              <DraggableTaskCard
                key={task.id}
                task={task}
                onClick={() => onTaskClick?.(task.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
