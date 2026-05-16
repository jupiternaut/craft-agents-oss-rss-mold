/**
 * TasksEmptyState
 *
 * Empty state component shown when no .flow/ directory exists.
 * Provides an "Initialize Flow-Next" button to create the directory structure.
 */

import * as React from 'react'
import { KanbanSquare, FolderPlus } from 'lucide-react'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface TasksEmptyStateProps {
  /** Called when user clicks Initialize button */
  onInitialize: () => void
  /** Whether initialization is in progress */
  isInitializing?: boolean
  /** Optional error message to display */
  error?: string | null
  /** Optional className */
  className?: string
}

export function TasksEmptyState({
  onInitialize,
  isInitializing = false,
  error,
  className,
}: TasksEmptyStateProps) {
  // Check if error is "no flow directory" (expected state, not an error)
  const isNoFlowDirectory = error === 'no-flow-directory'

  return (
    <div className={cn('flex flex-col flex-1', className)}>
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <KanbanSquare />
          </EmptyMedia>
          <EmptyTitle>
            {isNoFlowDirectory || !error ? 'No tasks yet' : 'Error loading tasks'}
          </EmptyTitle>
          <EmptyDescription>
            {isNoFlowDirectory || !error ? (
              <>
                Initialize Flow-Next to start tracking tasks and epics in this workspace.
              </>
            ) : (
              <span className="text-destructive">{error}</span>
            )}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="secondary"
            size="sm"
            onClick={onInitialize}
            disabled={isInitializing}
            className="gap-2"
          >
            <FolderPlus className="h-4 w-4" />
            {isInitializing ? 'Initializing...' : 'Initialize Flow-Next'}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
