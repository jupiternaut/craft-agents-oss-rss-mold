/**
 * TaskCard
 *
 * Draggable task card for the Kanban board.
 * Displays title, status badge, size indicator, assignee, and agent status.
 *
 * Uses @dnd-kit useDraggable for drag-drop support.
 */

import * as React from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Loader2, Lock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { TaskStatus } from '../../../shared/flow-schemas'

export interface TaskCardData {
  id: string
  title: string
  status: TaskStatus
  priority: string | null
  depends_on: string[]
  /** Size indicator (S/M/L/XL) - extracted from title or spec */
  size?: string
  /** Assignee email or name */
  assignee?: string | null
  /** Whether an agent is actively working on this task */
  isAgentActive?: boolean
  /** Whether this task is blocked by unresolved dependencies */
  isBlocked?: boolean
}

export interface TaskCardProps {
  task: TaskCardData
  /** Whether the card is currently being dragged (ghost state) */
  isDragging?: boolean
  /** Whether this is the overlay (floating clone during drag) */
  isOverlay?: boolean
  /** Click handler for card selection */
  onClick?: () => void
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

const SIZE_COLORS: Record<string, string> = {
  S: 'bg-emerald-500/10 text-emerald-600',
  M: 'bg-blue-500/10 text-blue-600',
  L: 'bg-orange-500/10 text-orange-600',
  XL: 'bg-red-500/10 text-red-600',
}

/**
 * Extract size from task title (e.g., "[M]" or "(M)")
 * Returns undefined if no size found
 */
function extractSize(title: string): string | undefined {
  const match = title.match(/[\[(](S|M|L|XL)[\])]/)
  return match?.[1]
}

/**
 * Check if assignee looks like an agent (contains "agent", "bot", "ai", etc.)
 */
function isAgentAssignee(assignee: string | null | undefined): boolean {
  if (!assignee) return false
  const lower = assignee.toLowerCase()
  return lower.includes('agent') || lower.includes('bot') || lower.includes('ai') || lower.includes('ralph')
}

export function TaskCard({
  task,
  isDragging = false,
  isOverlay = false,
  onClick,
}: TaskCardProps) {
  const size = task.size ?? extractSize(task.title)
  const isAgent = task.isAgentActive ?? isAgentAssignee(task.assignee)
  const isBlocked = task.isBlocked ?? (task.status === 'blocked' || (task.depends_on.length > 0 && task.status === 'todo'))

  return (
    <div
      className={cn(
        'group relative flex flex-col gap-2 p-3 rounded-lg border bg-background transition-all',
        'hover:border-foreground/20 hover:shadow-minimal',
        isDragging && 'opacity-50',
        isOverlay && 'shadow-strong border-foreground/20 cursor-grabbing',
        !isOverlay && !isDragging && 'cursor-grab',
        onClick && 'cursor-pointer'
      )}
      onClick={onClick}
    >
      {/* Title */}
      <div className="flex items-start gap-2">
        {isBlocked && (
          <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-orange-500" />
        )}
        <span className="text-sm font-medium line-clamp-2 flex-1">
          {task.title}
        </span>
      </div>

      {/* Metadata row: status badge, size, assignee */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Status badge */}
        <Badge
          variant="outline"
          className={cn(
            'text-[10px] px-1.5 py-0 h-5 shrink-0',
            STATUS_COLORS[task.status]
          )}
        >
          {STATUS_LABELS[task.status]}
        </Badge>

        {/* Size badge */}
        {size && (
          <Badge
            variant="secondary"
            className={cn(
              'text-[10px] px-1.5 py-0 h-5 shrink-0',
              SIZE_COLORS[size] ?? 'bg-foreground/5 text-muted-foreground'
            )}
          >
            {size}
          </Badge>
        )}

        {/* Agent status indicator */}
        {isAgent && (
          <div className="flex items-center gap-1 text-[10px] text-blue-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Agent working...</span>
          </div>
        )}
      </div>

      {/* Assignee (if present and not an agent) */}
      {task.assignee && !isAgent && (
        <div className="text-xs text-muted-foreground truncate">
          {task.assignee}
        </div>
      )}
    </div>
  )
}

/**
 * DraggableTaskCard - TaskCard wrapped with useDraggable
 */
export interface DraggableTaskCardProps extends Omit<TaskCardProps, 'isDragging'> {
  task: TaskCardData
}

export function DraggableTaskCard({ task, onClick, ...props }: DraggableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: task.id,
    data: { task },
  })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
    >
      <TaskCard
        task={task}
        isDragging={isDragging}
        onClick={onClick}
        {...props}
      />
    </div>
  )
}
