/**
 * EpicListItem
 *
 * Single epic row in the Tasks navigator panel.
 * Shows title, status badge, and progress bar (done/total tasks).
 * Right-click context menu for delete action.
 */

import * as React from 'react'
import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { calculateEpicProgress } from '@/atoms/tasks-state'
import type { EpicSummary } from '../../../shared/flow-schemas'

export interface EpicListItemProps {
  epic: EpicSummary
  isSelected: boolean
  onClick: () => void
  onDelete?: (epicId: string) => void
}

export function EpicListItem({ epic, isSelected, onClick, onDelete }: EpicListItemProps) {
  const progressPercent = calculateEpicProgress(epic)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full flex-col gap-2 px-3 py-2.5 text-left transition-colors rounded-lg',
            isSelected
              ? 'bg-foreground/5 hover:bg-foreground/7'
              : 'hover:bg-foreground/2'
          )}
          onClick={onClick}
        >
          {/* Title row with status badge */}
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-medium line-clamp-2 flex-1 min-w-0">
              {epic.title}
            </span>
            <Badge
              variant={epic.status === 'done' ? 'secondary' : 'outline'}
              className={cn(
                'shrink-0 text-[10px] px-1.5 py-0 h-5',
                epic.status === 'done' && 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
              )}
            >
              {epic.status === 'done' ? 'Done' : 'Open'}
            </Badge>
          </div>

          {/* Progress bar and count */}
          <div className="flex items-center gap-2">
            {/* Progress bar background */}
            <div className="flex-1 h-1.5 bg-foreground/5 rounded-full overflow-hidden">
              {/* Progress bar fill */}
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
            {/* Task count */}
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {epic.done}/{epic.tasks}
            </span>
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onClick={() => onDelete?.(epic.id)}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete Epic
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
