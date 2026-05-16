/**
 * ProjectSwitcher - Sidebar component for switching between registered flow projects.
 *
 * Renders in the sidebar near the Tasks navigation item. Each project shows:
 * - Auto-generated colored avatar (2-letter initials + deterministic color from name hash)
 * - Project name (priority: package.json name > directory basename)
 * - Truncated directory path with tooltip for full path
 * - Health badge: green check (initialized + epic count) or yellow warning (needs setup)
 *
 * Actions:
 * - Click project: switches active project via setActiveFlowProjectAtom
 * - "+ Add Project": opens native folder picker with git root auto-detection
 * - Right-click > Remove: unregisters project (does NOT delete .flow/ on disk)
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { FolderPlus, Check, CircleCheck, CircleAlert, Trash2, MoreHorizontal } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  activeFlowProjectAtom,
  registeredFlowProjectsAtom,
  setActiveFlowProjectAtom,
  unregisterFlowProjectAtom,
  epicsAtom,
} from '@/atoms/tasks-state'
import { useAddProject } from '@/hooks/useAddProject'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@craft-agent/ui'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { FlowProjectStatus } from '../../../shared/types'

// ─── Color Palette for Project Avatars ──────────────────────────────────────

/** Deterministic color palette for project avatars (pastanaga-inspired hash approach) */
const AVATAR_COLORS = [
  '#4F46E5', // indigo
  '#0891B2', // cyan
  '#059669', // emerald
  '#D97706', // amber
  '#DC2626', // red
  '#7C3AED', // violet
  '#DB2777', // pink
  '#2563EB', // blue
  '#CA8A04', // yellow
  '#0D9488', // teal
  '#9333EA', // purple
  '#EA580C', // orange
]

/**
 * Generate a deterministic hash code from a string.
 * Used to pick a consistent avatar color for each project name.
 */
function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0 // Convert to 32-bit integer
  }
  return Math.abs(hash)
}

/**
 * Get 2-letter initials from a project name.
 * E.g., "my-project" → "MP", "craft-agents-oss" → "CA"
 */
function getInitials(name: string): string {
  // Split on common separators: space, dash, underscore, dot, camelCase
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase → space-separated
    .split(/[\s\-_./]+/)
    .filter(Boolean)

  if (words.length === 0) return '??'
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/**
 * Get deterministic avatar color for a project name.
 */
function getAvatarColor(name: string): string {
  return AVATAR_COLORS[hashCode(name) % AVATAR_COLORS.length]
}

/**
 * Get the basename from a file path (last segment).
 */
function getBasename(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/')
  return segments[segments.length - 1] || segments[segments.length - 2] || 'Unknown'
}

/**
 * Truncate a directory path for display.
 * Shows ~/ prefix for home directory, abbreviates middle segments.
 */
function truncatePath(path: string, maxLength = 32): string {
  // Replace home directory with ~
  const homeDir = typeof window !== 'undefined'
    ? (navigator.userAgent.includes('Mac') ? '/Users/' : '/home/')
    : '/home/'
  let display = path

  // Try to detect and replace home dir prefix
  const homeParts = display.split('/')
  if (homeParts.length >= 3 && (homeParts[1] === 'Users' || homeParts[1] === 'home')) {
    display = '~/' + homeParts.slice(3).join('/')
  }

  if (display.length <= maxLength) return display

  // Truncate from the left, keeping the last few segments
  const parts = display.split('/')
  if (parts.length <= 2) return display.substring(display.length - maxLength)

  // Keep ~ prefix and last 2 segments
  const last2 = parts.slice(-2).join('/')
  if (last2.length >= maxLength - 4) return '.../' + parts[parts.length - 1]
  return '.../' + last2
}

// ─── Project Avatar ─────────────────────────────────────────────────────────

interface ProjectAvatarProps {
  name: string
  size?: 'sm' | 'md'
  className?: string
}

function ProjectAvatar({ name, size = 'sm', className }: ProjectAvatarProps) {
  const color = getAvatarColor(name)
  const initials = getInitials(name)
  const sizeClass = size === 'sm' ? 'h-5 w-5 text-[9px]' : 'h-6 w-6 text-[10px]'

  return (
    <div
      className={cn(
        'rounded-md flex items-center justify-center font-semibold text-white shrink-0 select-none',
        sizeClass,
        className,
      )}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {initials}
    </div>
  )
}

// ─── Health Badge ───────────────────────────────────────────────────────────

interface HealthBadgeProps {
  status: FlowProjectStatus
  epicCount?: number
  isActive: boolean
}

function HealthBadge({ status, epicCount, isActive }: HealthBadgeProps) {
  if (status === 'initialized') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1 text-[10px] text-emerald-500">
              <CircleCheck className="h-3 w-3" />
              {isActive && epicCount !== undefined && (
                <span className="text-foreground/40">{epicCount}</span>
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {isActive && epicCount !== undefined
              ? `Initialized \u00B7 ${epicCount} epic${epicCount !== 1 ? 's' : ''}`
              : 'Initialized \u00B7 switch to update'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center text-[10px] text-amber-500">
            <CircleAlert className="h-3 w-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {status === 'needs-setup' ? 'Needs setup' : 'Error'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// ─── Git Root Suggestion Dialog ─────────────────────────────────────────────

interface GitRootDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedPath: string
  gitRoot: string
  onUseGitRoot: () => void
  onUseSelected: () => void
}

function GitRootDialog({ open, onOpenChange, selectedPath, gitRoot, onUseGitRoot, onUseSelected }: GitRootDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            <code className="bg-muted px-1 py-0.5 rounded text-[11px]">{selectedPath}</code>
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Git root:</span>{' '}
            <code className="bg-muted px-1 py-0.5 rounded text-[11px]">{gitRoot}</code>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onUseSelected}>
            Use Selected Folder
          </Button>
          <Button onClick={onUseGitRoot}>
            Use Git Root
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Project Item ───────────────────────────────────────────────────────────

interface ProjectItemProps {
  path: string
  name: string
  isActive: boolean
  status: FlowProjectStatus
  epicCount?: number
  onSelect: () => void
  onRemove: () => void
}

function ProjectItem({ path, name, isActive, status, epicCount, onSelect, onRemove }: ProjectItemProps) {
  const statusLabel = status === 'initialized'
    ? (isActive && epicCount !== undefined ? `${epicCount} epic${epicCount !== 1 ? 's' : ''}` : 'initialized')
    : status === 'needs-setup' ? 'needs setup' : 'error'

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors',
        isActive
          ? 'bg-foreground/[0.07]'
          : 'hover:bg-foreground/[0.04]',
      )}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-label={`${name} \u2014 ${statusLabel}${isActive ? ' (active)' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <ProjectAvatar name={name} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-[12px] font-medium text-foreground truncate">
            {name}
          </span>
          {isActive && (
            <Check className="h-3 w-3 text-foreground/50 shrink-0" />
          )}
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-[10px] text-foreground/40 truncate leading-tight">
                {truncatePath(path)}
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {path}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <HealthBadge status={status} epicCount={epicCount} isActive={isActive} />
        {/* More actions dropdown - visible on hover */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-foreground/10 transition-opacity focus:opacity-100"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Actions for ${name}`}
            >
              <MoreHorizontal className="h-3 w-3 text-foreground/50" />
            </button>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" sideOffset={4}>
            <StyledDropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove Project
            </StyledDropdownMenuItem>
          </StyledDropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

// ─── Main ProjectSwitcher Component ─────────────────────────────────────────

interface ProjectSwitcherProps {
  className?: string
}

/**
 * ProjectSwitcher — renders the list of registered flow projects in the sidebar.
 * Placed near the Tasks navigation item for quick project switching.
 */
export function ProjectSwitcher({ className }: ProjectSwitcherProps) {
  const registeredProjects = useAtomValue(registeredFlowProjectsAtom)
  const activeProject = useAtomValue(activeFlowProjectAtom)
  const setActiveProject = useSetAtom(setActiveFlowProjectAtom)
  const unregisterProject = useSetAtom(unregisterFlowProjectAtom)
  const epics = useAtomValue(epicsAtom)

  // Shared add-project hook (replaces local handleAddProject + git root dialog)
  const {
    handleAddProject,
    gitRootDialog,
    setGitRootDialogOpen,
    handleUseGitRoot,
    handleUseSelected,
  } = useAddProject()

  // Per-project status cache (only live-update active project, stale for inactive)
  const [statusCache, setStatusCache] = React.useState<Record<string, FlowProjectStatus>>({})

  // Fetch project names from package.json / project context for display
  const [projectNames, setProjectNames] = React.useState<Record<string, string>>({})

  // Fetch status for all registered projects on mount and when list changes
  React.useEffect(() => {
    const fetchStatuses = async () => {
      for (const project of registeredProjects) {
        // Skip active project (its status comes from activeFlowProjectAtom)
        if (project.path === activeProject.path) continue

        try {
          const result = await window.electronAPI.flowProjectCheckStatus(project.path)
          setStatusCache(prev => ({ ...prev, [project.path]: result.status }))
        } catch {
          setStatusCache(prev => ({ ...prev, [project.path]: 'error' }))
        }
      }
    }
    fetchStatuses()
  }, [registeredProjects, activeProject.path])

  // Track which project paths we've already fetched names for to avoid re-fetching
  const fetchedNamesRef = React.useRef<Set<string>>(new Set())

  // Fetch project context (name from package.json) for all projects
  React.useEffect(() => {
    // Clean up ref for removed projects so re-added projects get re-fetched
    const currentPaths = new Set(registeredProjects.map(p => p.path))
    fetchedNamesRef.current.forEach(path => {
      if (!currentPaths.has(path)) {
        fetchedNamesRef.current.delete(path)
      }
    })

    const fetchNames = async () => {
      for (const project of registeredProjects) {
        // Skip if already fetched
        if (fetchedNamesRef.current.has(project.path)) continue
        fetchedNamesRef.current.add(project.path)

        try {
          const context = await window.electronAPI.flowReadProjectContext(project.path)
          if (typeof context?.name === 'string') {
            const name = context.name
            setProjectNames(prev => ({ ...prev, [project.path]: name }))
          }
        } catch {
          // Use directory basename fallback (already handled in getDisplayName)
        }
      }
    }
    fetchNames()
  }, [registeredProjects])

  /** Get the display name for a project: (1) package.json name, (2) registered name, (3) directory basename */
  const getDisplayName = React.useCallback((path: string, registeredName: string): string => {
    return projectNames[path] || registeredName || getBasename(path)
  }, [projectNames])

  /** Get the flow status for a project */
  const getStatus = React.useCallback((path: string): FlowProjectStatus => {
    if (path === activeProject.path) return activeProject.flowStatus
    return statusCache[path] || 'needs-setup'
  }, [activeProject, statusCache])

  if (registeredProjects.length === 0) {
    return (
      <div className={cn('px-2', className)}>
        <button
          onClick={handleAddProject}
          className={cn(
            'flex items-center gap-2 w-full rounded-[6px] px-2 py-[5px] text-[12px]',
            'text-foreground/50 hover:text-foreground/70 hover:bg-foreground/[0.04] transition-colors',
          )}
        >
          <FolderPlus className="h-3.5 w-3.5 shrink-0" />
          Add Project...
        </button>

        <GitRootDialog
          open={gitRootDialog.open}
          onOpenChange={setGitRootDialogOpen}
          selectedPath={gitRootDialog.selectedPath}
          gitRoot={gitRootDialog.gitRoot}
          onUseGitRoot={handleUseGitRoot}
          onUseSelected={handleUseSelected}
        />
      </div>
    )
  }

  return (
    <div className={cn('px-2', className)}>
      <div className="grid gap-0.5">
        {registeredProjects.map((project) => {
          const isActive = activeProject.path === project.path
          const status = getStatus(project.path)
          const displayName = getDisplayName(project.path, project.name)
          // Only show epic count for active project (live-updated via FlowWatcher)
          const epicCount = isActive ? epics.length : undefined

          return (
            <ProjectItem
              key={project.path}
              path={project.path}
              name={displayName}
              isActive={isActive}
              status={status}
              epicCount={epicCount}
              onSelect={() => setActiveProject(project.path)}
              onRemove={() => unregisterProject(project.path)}
            />
          )
        })}
      </div>

      {/* Add Project button */}
      <button
        onClick={handleAddProject}
        className={cn(
          'flex items-center gap-2 w-full rounded-[6px] px-2 py-[5px] mt-0.5 text-[12px]',
          'text-foreground/50 hover:text-foreground/70 hover:bg-foreground/[0.04] transition-colors',
        )}
      >
        <FolderPlus className="h-3.5 w-3.5 shrink-0" />
        Add Project...
      </button>

      <GitRootDialog
        open={gitRootDialog.open}
        onOpenChange={setGitRootDialogOpen}
        selectedPath={gitRootDialog.selectedPath}
        gitRoot={gitRootDialog.gitRoot}
        onUseGitRoot={handleUseGitRoot}
        onUseSelected={handleUseSelected}
      />
    </div>
  )
}
