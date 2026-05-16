/**
 * ViewModeSelector
 *
 * Segmented control for switching between List, Kanban, and Graph views.
 * Graph option only appears when the epic has task dependencies.
 */

import * as React from 'react'
import { motion } from 'motion/react'
import { List, KanbanSquare, GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ViewMode } from '@/atoms/tasks-state'

// Spring transition - snappy
const springTransition = {
  type: 'spring' as const,
  stiffness: 600,
  damping: 49,
}

export interface ViewModeSelectorProps {
  /** Current view mode */
  value: ViewMode
  /** Callback when view mode changes */
  onChange: (mode: ViewMode) => void
  /** Whether graph view is available (has dependencies) */
  graphAvailable?: boolean
  /** Optional className */
  className?: string
}

interface ViewOption {
  value: ViewMode
  label: string
  icon: React.ReactNode
}

const VIEW_OPTIONS: ViewOption[] = [
  { value: 'list', label: 'List', icon: <List className="h-3.5 w-3.5" /> },
  { value: 'kanban', label: 'Kanban', icon: <KanbanSquare className="h-3.5 w-3.5" /> },
  { value: 'graph', label: 'Graph', icon: <GitBranch className="h-3.5 w-3.5" /> },
]

export function ViewModeSelector({
  value,
  onChange,
  graphAvailable = false,
  className,
}: ViewModeSelectorProps) {
  // Filter options based on graph availability
  const options = React.useMemo(() => {
    return VIEW_OPTIONS.filter((opt) => opt.value !== 'graph' || graphAvailable)
  }, [graphAvailable])

  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 p-0.5 rounded-md bg-foreground/5',
        className
      )}
      role="tablist"
    >
      {options.map((option) => {
        const isActive = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground/80'
            )}
          >
            {isActive && (
              <motion.div
                layoutId="viewModeIndicator"
                className="absolute inset-0 bg-background shadow-minimal rounded"
                transition={springTransition}
              />
            )}
            <span className="relative z-10">{option.icon}</span>
            <span className="relative z-10">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
