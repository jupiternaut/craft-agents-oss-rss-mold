/**
 * useAddProject
 *
 * Shared hook for the "Add Project" flow used by both ProjectSwitcher
 * and NoProjectsEmptyState. Opens native folder picker, detects git root,
 * optionally shows git root suggestion dialog, and registers the project.
 *
 * Returns:
 * - handleAddProject: trigger the add-project flow
 * - gitRootDialog: state for the GitRootDialog sub-component
 * - resolveGitRootDialog: handlers for the dialog choices
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import {
  registerFlowProjectAtom,
} from '@/atoms/tasks-state'

/** State for the git root suggestion dialog */
export interface GitRootDialogState {
  open: boolean
  selectedPath: string
  gitRoot: string
}

const INITIAL_GIT_ROOT_DIALOG: GitRootDialogState = {
  open: false,
  selectedPath: '',
  gitRoot: '',
}

/**
 * Get the basename from a file path (last segment).
 */
function getBasename(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/')
  return segments[segments.length - 1] || segments[segments.length - 2] || 'Unknown'
}

export function useAddProject() {
  const registerProject = useSetAtom(registerFlowProjectAtom)
  const [gitRootDialog, setGitRootDialog] = React.useState<GitRootDialogState>(INITIAL_GIT_ROOT_DIALOG)

  /** Register a project at the given path with best-effort name resolution */
  const registerWithPath = React.useCallback(async (path: string) => {
    let name = getBasename(path)
    try {
      const context = await window.electronAPI.flowReadProjectContext(path)
      if (context?.name) {
        name = context.name
      }
    } catch {
      // Use basename fallback
    }

    await registerProject(path, name, true)
  }, [registerProject])

  /** Handle adding a new project via folder picker */
  const handleAddProject = React.useCallback(async () => {
    try {
      const selectedPath = await window.electronAPI.openFolderDialog()
      if (!selectedPath) return // User cancelled

      // Detect git root
      let gitRoot: string | null = null
      try {
        gitRoot = await window.electronAPI.getGitRoot(selectedPath)
      } catch {
        // Git not available or not a repo — proceed with selected path
      }

      // If git root differs from selected path, validate it and show suggestion dialog
      if (gitRoot && gitRoot !== selectedPath) {
        try {
          const validation = await window.electronAPI.flowProjectCheckStatus(gitRoot)
          if (validation.status !== 'error') {
            setGitRootDialog({
              open: true,
              selectedPath,
              gitRoot,
            })
            return
          }
        } catch {
          // Validation failed — fall through to register with selected path
        }
      }

      // Register with the selected path
      await registerWithPath(selectedPath)
    } catch (err) {
      console.error('[useAddProject] Failed to add project:', err)
    }
  }, [registerWithPath])

  /** Handle git root dialog: use git root */
  const handleUseGitRoot = React.useCallback(async () => {
    const { gitRoot } = gitRootDialog
    setGitRootDialog(INITIAL_GIT_ROOT_DIALOG)
    await registerWithPath(gitRoot)
  }, [gitRootDialog, registerWithPath])

  /** Handle git root dialog: use selected folder */
  const handleUseSelected = React.useCallback(async () => {
    const { selectedPath } = gitRootDialog
    setGitRootDialog(INITIAL_GIT_ROOT_DIALOG)
    await registerWithPath(selectedPath)
  }, [gitRootDialog, registerWithPath])

  /** Set dialog open state */
  const setGitRootDialogOpen = React.useCallback((open: boolean) => {
    setGitRootDialog(prev => ({ ...prev, open }))
  }, [])

  return {
    handleAddProject,
    gitRootDialog,
    setGitRootDialogOpen,
    handleUseGitRoot,
    handleUseSelected,
  }
}
