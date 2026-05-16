/**
 * NoProjectsEmptyState
 *
 * Polished empty state shown in the Tasks view when no projects
 * are registered (registeredFlowProjectsAtom is empty).
 *
 * Follows the existing Empty compound component pattern from TasksEmptyState.tsx.
 * Provides an "Add a Project" CTA that reuses the same handler logic as
 * the sidebar's "+ Add Project" button via the shared useAddProject hook.
 */

import * as React from 'react'
import { FolderOpen, FolderPlus } from 'lucide-react'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useAddProject } from '@/hooks/useAddProject'
import { cn } from '@/lib/utils'

export interface NoProjectsEmptyStateProps {
  /** Optional className */
  className?: string
}

export function NoProjectsEmptyState({ className }: NoProjectsEmptyStateProps) {
  const {
    handleAddProject,
    gitRootDialog,
    setGitRootDialogOpen,
    handleUseGitRoot,
    handleUseSelected,
  } = useAddProject()

  return (
    <div className={cn('flex flex-col flex-1', className)}>
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderOpen />
          </EmptyMedia>
          <EmptyTitle>
            No projects yet
          </EmptyTitle>
          <EmptyDescription>
            Add a project folder to start tracking epics and tasks
            with flow-next. Projects are local directories — your code
            stays on your machine.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleAddProject}
            className="gap-2"
          >
            <FolderPlus className="h-4 w-4" />
            Add a Project
          </Button>
        </EmptyContent>
      </Empty>

      {/* Git root suggestion dialog (reuses same pattern as ProjectSwitcher) */}
      <Dialog open={gitRootDialog.open} onOpenChange={setGitRootDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Git Repository Detected</DialogTitle>
            <DialogDescription>
              The selected folder is inside a git repository. Would you like to register the repository root instead?
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-3">
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Selected:</span>{' '}
              <code className="bg-muted px-1 py-0.5 rounded text-[11px]">{gitRootDialog.selectedPath}</code>
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Git root:</span>{' '}
              <code className="bg-muted px-1 py-0.5 rounded text-[11px]">{gitRootDialog.gitRoot}</code>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleUseSelected}>
              Use Selected Folder
            </Button>
            <Button onClick={handleUseGitRoot}>
              Use Git Root
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
