/**
 * TaskDepsTab
 *
 * Tab content that displays task dependencies.
 * Shows both blocking tasks (tasks this one blocks) and
 * blocked-by tasks (tasks that must complete before this one).
 */

import * as React from 'react'
import { ArrowRight, ArrowLeft, CheckCircle2, Circle, Lock, Loader2 } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { TaskStatus } from '../../../shared/flow-schemas'

export interface DependencyTask {
  id: string
  title: string
  status: TaskStatus
}

export interface TaskDepsTabProps {
  /** Task ID */
  taskId: string
  /** Tasks that this task depends on (blocked by) */
  blockedBy: DependencyTask[]
  /** Tasks that depend on this task (blocking) */
  blocking: DependencyTask[]
  /** Callback when a dependency task is clicked */
  onTaskClick?: (taskId: string) => void
  /** Optional className */
  className?: string
}

const STATUS_ICONS: Record<TaskStatus, React.ComponentType<{ className?: string }>> = {
  todo: Circle,
  in_progress: Loader2,
  blocked: Lock,
  done: CheckCircle2,
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  todo: 'text-zinc-400',
  in_progress: 'text-blue-500',
  blocked: 'text-orange-500',
  done: 'text-emerald-500',
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
}

interface DependencyListProps {
  title: string
  icon: React.ReactNode
  tasks: DependencyTask[]
  onTaskClick?: (taskId: string) => void
  emptyMessage: string
}

function DependencyList({ title, icon, tasks, onTaskClick, emptyMessage }: DependencyListProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon}
        <span>{title}</span>
        <Badge variant="secondary" className="ml-auto text-xs">
          {tasks.length}
        </Badge>
      </div>

      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground/60 pl-6">{emptyMessage}</p>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const StatusIcon = STATUS_ICONS[task.status]
            const statusColor = STATUS_COLORS[task.status]

            return (
              <button
                key={task.id}
                onClick={() => onTaskClick?.(task.id)}
                className={cn(
                  'w-full flex items-start gap-3 p-3 rounded-lg border bg-background',
                  'hover:border-foreground/20 hover:bg-foreground/[0.02] transition-colors',
                  'text-left cursor-pointer'
                )}
              >
                <StatusIcon
                  className={cn(
                    'h-4 w-4 mt-0.5 shrink-0',
                    statusColor,
                    task.status === 'in_progress' && 'animate-spin'
                  )}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium line-clamp-2">{task.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{task.id}</p>
                </div>
                <Badge
                  variant="outline"
                  className={cn('shrink-0 text-[10px] px-1.5 py-0 h-5', statusColor)}
                >
                  {STATUS_LABELS[task.status]}
                </Badge>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function TaskDepsTab({
  taskId,
  blockedBy,
  blocking,
  onTaskClick,
  className,
}: TaskDepsTabProps) {
  const hasNoDeps = blockedBy.length === 0 && blocking.length === 0

  if (hasNoDeps) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-full gap-2', className)}>
        <Circle className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No dependencies</p>
        <p className="text-xs text-muted-foreground/60">
          This task has no blocking or blocked-by relationships
        </p>
      </div>
    )
  }

  return (
    <ScrollArea className={cn('h-full', className)}>
      <div className="p-4 space-y-6">
        {/* Blocked By: Tasks that must complete before this one */}
        <DependencyList
          title="Blocked By"
          icon={<ArrowLeft className="h-4 w-4" />}
          tasks={blockedBy}
          onTaskClick={onTaskClick}
          emptyMessage="No upstream dependencies"
        />

        {/* Blocking: Tasks that depend on this one */}
        <DependencyList
          title="Blocking"
          icon={<ArrowRight className="h-4 w-4" />}
          tasks={blocking}
          onTaskClick={onTaskClick}
          emptyMessage="No downstream dependencies"
        />
      </div>
    </ScrollArea>
  )
}
