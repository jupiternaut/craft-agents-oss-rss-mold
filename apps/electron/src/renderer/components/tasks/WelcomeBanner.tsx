/**
 * WelcomeBanner
 *
 * Brief dismissible banner shown when a cloned repo with .flow/ is opened
 * for the first time (no ui-state.json yet). Displays:
 * - Project name
 * - Epic count and total task count
 * - In-progress work summary
 *
 * Auto-opens the most active epic (handled by loadEpicsAtom, not here).
 * Dismissal is persisted to .flow/ui-state.json via welcomeDismissedAtom.
 */

import * as React from 'react'
import { X, FolderGit2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { EpicSummary } from '../../../shared/flow-schemas'

export interface WelcomeBannerProps {
  /** Project name (from package.json or directory basename) */
  projectName: string
  /** List of epics in the project */
  epics: EpicSummary[]
  /** Called when user dismisses the banner */
  onDismiss: () => void
  /** Optional className */
  className?: string
}

/**
 * Build a concise in-progress summary from epics.
 * E.g., "2 tasks in progress across 1 epic"
 */
function buildInProgressSummary(epics: EpicSummary[]): string | null {
  let inProgressTasks = 0
  let inProgressEpics = 0

  for (const epic of epics) {
    const active = epic.in_progress ?? (epic.tasks - epic.done)
    if (active > 0) {
      inProgressTasks += active
      inProgressEpics++
    }
  }

  if (inProgressTasks === 0) return null

  const taskWord = inProgressTasks === 1 ? 'task' : 'tasks'
  const epicWord = inProgressEpics === 1 ? 'epic' : 'epics'
  return `${inProgressTasks} ${taskWord} in progress across ${inProgressEpics} ${epicWord}`
}

export function WelcomeBanner({
  projectName,
  epics,
  onDismiss,
  className,
}: WelcomeBannerProps) {
  const totalTasks = epics.reduce((sum, e) => sum + e.tasks, 0)
  const inProgressSummary = buildInProgressSummary(epics)

  const epicWord = epics.length === 1 ? 'epic' : 'epics'
  const taskWord = totalTasks === 1 ? 'task' : 'tasks'

  return (
    <div
      className={cn(
        'relative flex items-start gap-3 rounded-lg border border-border/60 bg-card/80 backdrop-blur-sm px-4 py-3 shadow-minimal',
        className,
      )}
      role="status"
      aria-label={`Welcome to ${projectName}`}
    >
      {/* Icon */}
      <div className="flex items-center justify-center rounded-md bg-blue-500/10 p-1.5 mt-0.5 shrink-0">
        <FolderGit2 className="h-4 w-4 text-blue-500" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          Welcome to {projectName}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {epics.length} {epicWord} with {totalTasks} {taskWord}
          {inProgressSummary && (
            <>
              {' \u00B7 '}
              <span className="text-foreground/60">{inProgressSummary}</span>
            </>
          )}
        </p>
      </div>

      {/* Dismiss button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={onDismiss}
        aria-label="Dismiss welcome banner"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
