/**
 * TaskNode
 *
 * Custom React Flow node component for the dependency graph.
 * Shows task title, status color-coded border, and size badge.
 */

import * as React from 'react'
import { Handle, Position, type Node } from '@xyflow/react'
import { Circle, CheckCircle2, Loader2, AlertCircle, Lock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { TaskStatus } from '../../../shared/flow-schemas'

export interface TaskNodeData extends Record<string, unknown> {
  id: string
  title: string
  status: TaskStatus
  size?: string
  isBlocked?: boolean
  hasDependencies?: boolean
  hasDependents?: boolean
}

export type TaskNode = Node<TaskNodeData, 'task'>

const STATUS_COLORS: Record<TaskStatus, { border: string; bg: string; icon: string }> = {
  todo: {
    border: 'border-zinc-400/50',
    bg: 'bg-zinc-500/5',
    icon: 'text-zinc-500',
  },
  in_progress: {
    border: 'border-blue-500/50',
    bg: 'bg-blue-500/5',
    icon: 'text-blue-500',
  },
  blocked: {
    border: 'border-orange-500/50',
    bg: 'bg-orange-500/5',
    icon: 'text-orange-500',
  },
  done: {
    border: 'border-emerald-500/50',
    bg: 'bg-emerald-500/5',
    icon: 'text-emerald-600',
  },
}

const SIZE_COLORS: Record<string, string> = {
  S: 'bg-emerald-500/10 text-emerald-600',
  M: 'bg-blue-500/10 text-blue-600',
  L: 'bg-orange-500/10 text-orange-600',
  XL: 'bg-red-500/10 text-red-600',
}

function StatusIcon({ status }: { status: TaskStatus }) {
  const iconClass = 'h-3.5 w-3.5'
  switch (status) {
    case 'todo':
      return <Circle className={iconClass} />
    case 'in_progress':
      return <Loader2 className={cn(iconClass, 'animate-spin')} />
    case 'blocked':
      return <AlertCircle className={iconClass} />
    case 'done':
      return <CheckCircle2 className={iconClass} />
  }
}

/**
 * Extract size from task title (e.g., "[M]" or "(M)")
 */
function extractSize(title: string): string | undefined {
  const match = title.match(/[\[(](S|M|L|XL)[\])]/)
  return match?.[1]
}

interface TaskNodeComponentProps {
  data: TaskNodeData
  selected?: boolean
}

export function TaskNodeComponent({ data, selected }: TaskNodeComponentProps) {
  const colors = STATUS_COLORS[data.status]
  const size = data.size ?? extractSize(data.title)

  return (
    <>
      {/* Target handle (top) - where edges come IN */}
      {data.hasDependencies && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-2 !h-2 !bg-foreground/30 !border-0"
        />
      )}

      <div
        className={cn(
          'px-3 py-2 rounded-lg border-2 min-w-[160px] max-w-[240px] transition-all',
          'bg-background shadow-minimal',
          colors.border,
          selected && 'ring-2 ring-blue-500 ring-offset-2 ring-offset-background'
        )}
      >
        {/* Title row */}
        <div className="flex items-start gap-2">
          {/* Status icon */}
          <div className={cn('shrink-0 mt-0.5', colors.icon)}>
            <StatusIcon status={data.status} />
          </div>

          {/* Title */}
          <span className="text-sm font-medium line-clamp-2 flex-1 leading-tight">
            {data.title}
          </span>
        </div>

        {/* Metadata row */}
        <div className="flex items-center gap-1.5 mt-1.5">
          {/* Blocked indicator */}
          {data.isBlocked && (
            <Lock className="h-3 w-3 text-orange-500" />
          )}

          {/* Size badge */}
          {size && (
            <Badge
              variant="secondary"
              className={cn(
                'text-[9px] px-1 py-0 h-4',
                SIZE_COLORS[size] ?? 'bg-foreground/5 text-muted-foreground'
              )}
            >
              {size}
            </Badge>
          )}

          {/* Task ID (truncated) */}
          <span className="text-[10px] text-muted-foreground truncate">
            {data.id.split('.').pop()}
          </span>
        </div>
      </div>

      {/* Source handle (bottom) - where edges go OUT */}
      {data.hasDependents && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-2 !h-2 !bg-foreground/30 !border-0"
        />
      )}
    </>
  )
}
