/**
 * TaskActivityTab
 *
 * Tab content that displays task status change history.
 * Shows timestamps and status transitions.
 */

import * as React from 'react'
import {
  Circle,
  PlayCircle,
  Lock,
  CheckCircle2,
  Clock,
  User,
  Calendar,
} from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { TaskStatus } from '../../../shared/flow-schemas'

export interface ActivityEvent {
  id: string
  type: 'status_change' | 'claimed' | 'created'
  timestamp: string
  fromStatus?: TaskStatus
  toStatus?: TaskStatus
  assignee?: string | null
}

export interface TaskActivityTabProps {
  /** Task creation timestamp */
  createdAt: string
  /** Task last updated timestamp */
  updatedAt: string
  /** Current task status */
  status: TaskStatus
  /** Task assignee (if claimed) */
  assignee?: string | null
  /** Claimed at timestamp */
  claimedAt?: string | null
  /** Optional className */
  className?: string
}

const STATUS_ICONS: Record<TaskStatus, React.ComponentType<{ className?: string }>> = {
  todo: Circle,
  in_progress: PlayCircle,
  blocked: Lock,
  done: CheckCircle2,
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  todo: 'text-zinc-400 bg-zinc-500/10',
  in_progress: 'text-blue-500 bg-blue-500/10',
  blocked: 'text-orange-500 bg-orange-500/10',
  done: 'text-emerald-500 bg-emerald-500/10',
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
}

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    // Relative time for recent events
    if (diffDays === 0) {
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
      if (diffHours === 0) {
        const diffMinutes = Math.floor(diffMs / (1000 * 60))
        if (diffMinutes < 1) return 'Just now'
        return `${diffMinutes}m ago`
      }
      return `${diffHours}h ago`
    }
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays}d ago`

    // Full date for older events
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    })
  } catch {
    return isoString
  }
}

function formatFullTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return isoString
  }
}

interface ActivityItemProps {
  icon: React.ReactNode
  title: string
  subtitle?: string
  timestamp: string
  isLast?: boolean
}

function ActivityItem({ icon, title, subtitle, timestamp, isLast }: ActivityItemProps) {
  return (
    <div className="flex gap-3 relative">
      {/* Timeline connector */}
      {!isLast && (
        <div className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />
      )}

      {/* Icon */}
      <div className="shrink-0 z-10">{icon}</div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-6">
        <p className="text-sm font-medium">{title}</p>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        )}
        <p
          className="text-xs text-muted-foreground/60 mt-1"
          title={formatFullTimestamp(timestamp)}
        >
          {formatTimestamp(timestamp)}
        </p>
      </div>
    </div>
  )
}

export function TaskActivityTab({
  createdAt,
  updatedAt,
  status,
  assignee,
  claimedAt,
  className,
}: TaskActivityTabProps) {
  // Build activity timeline from available data
  // Note: flowctl doesn't expose full history, so we reconstruct from timestamps
  const activities: Array<{
    id: string
    icon: React.ReactNode
    title: string
    subtitle?: string
    timestamp: string
  }> = []

  // Current status (most recent)
  const StatusIcon = STATUS_ICONS[status]
  const statusColor = STATUS_COLORS[status]
  activities.push({
    id: 'current-status',
    icon: (
      <div className={cn('w-8 h-8 rounded-full flex items-center justify-center', statusColor)}>
        <StatusIcon className="h-4 w-4" />
      </div>
    ),
    title: `Status: ${STATUS_LABELS[status]}`,
    subtitle: status === 'done' ? 'Task completed' : undefined,
    timestamp: updatedAt,
  })

  // Claimed event (if claimed)
  if (claimedAt && assignee) {
    activities.push({
      id: 'claimed',
      icon: (
        <div className="w-8 h-8 rounded-full bg-foreground/5 flex items-center justify-center">
          <User className="h-4 w-4 text-muted-foreground" />
        </div>
      ),
      title: 'Task claimed',
      subtitle: assignee,
      timestamp: claimedAt,
    })
  }

  // Created event
  activities.push({
    id: 'created',
    icon: (
      <div className="w-8 h-8 rounded-full bg-foreground/5 flex items-center justify-center">
        <Calendar className="h-4 w-4 text-muted-foreground" />
      </div>
    ),
    title: 'Task created',
    timestamp: createdAt,
  })

  // Sort by timestamp (newest first)
  activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return (
    <ScrollArea className={cn('h-full', className)}>
      <div className="p-4">
        <div className="space-y-0">
          {activities.map((activity, index) => (
            <ActivityItem
              key={activity.id}
              icon={activity.icon}
              title={activity.title}
              subtitle={activity.subtitle}
              timestamp={activity.timestamp}
              isLast={index === activities.length - 1}
            />
          ))}
        </div>

        {/* Note about limited history */}
        <div className="mt-4 pt-4 border-t border-border/50">
          <p className="text-xs text-muted-foreground/60 text-center">
            Activity history is reconstructed from task metadata
          </p>
        </div>
      </div>
    </ScrollArea>
  )
}
