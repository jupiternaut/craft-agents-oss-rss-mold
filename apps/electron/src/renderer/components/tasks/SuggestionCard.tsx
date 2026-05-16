/**
 * SuggestionCard
 *
 * Individual suggestion card for the AI Suggestion Sidebar.
 * Displays icon, title, description, and action button.
 * Can be dismissed by clicking the X button.
 */

import * as React from 'react'
import { motion } from 'motion/react'
import {
  Lightbulb,
  ClipboardList,
  Clock,
  CheckCircle2,
  GitBranch,
  FileText,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SuggestionType =
  | 'no_tasks'
  | 'task_stuck'
  | 'all_done'
  | 'no_dependencies'
  | 'no_specs'

export interface Suggestion {
  /** Unique identifier for this suggestion (used for dismissal tracking) */
  id: string
  /** Type of suggestion for icon selection */
  type: SuggestionType
  /** Short title displayed prominently */
  title: string
  /** Longer description explaining the suggestion */
  description: string
  /** Text for the action button */
  actionLabel: string
  /** Priority for sorting (higher = more urgent, shown first) */
  priority: number
  /** Optional: task ID if suggestion relates to a specific task */
  taskId?: string
}

export interface SuggestionCardProps {
  /** The suggestion to display */
  suggestion: Suggestion
  /** Callback when action button is clicked */
  onAction: (suggestion: Suggestion) => void
  /** Callback when dismiss button is clicked */
  onDismiss: (suggestionId: string) => void
  /** Optional className */
  className?: string
}

// ─── Icon Map ─────────────────────────────────────────────────────────────────

const iconMap: Record<SuggestionType, React.ElementType> = {
  no_tasks: ClipboardList,
  task_stuck: Clock,
  all_done: CheckCircle2,
  no_dependencies: GitBranch,
  no_specs: FileText,
}

const iconColorMap: Record<SuggestionType, string> = {
  no_tasks: 'text-blue-500',
  task_stuck: 'text-amber-500',
  all_done: 'text-emerald-500',
  no_dependencies: 'text-purple-500',
  no_specs: 'text-orange-500',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SuggestionCard({
  suggestion,
  onAction,
  onDismiss,
  className,
}: SuggestionCardProps) {
  const Icon = iconMap[suggestion.type] ?? Lightbulb
  const iconColor = iconColorMap[suggestion.type] ?? 'text-blue-500'

  const handleAction = React.useCallback(() => {
    onAction(suggestion)
  }, [onAction, suggestion])

  const handleDismiss = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onDismiss(suggestion.id)
    },
    [onDismiss, suggestion.id]
  )

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={cn(
        'group relative p-3 rounded-lg border border-border/50 bg-background/50',
        'hover:bg-accent/50 hover:border-border transition-colors',
        className
      )}
    >
      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        className={cn(
          'absolute top-2 right-2 p-1 rounded-md',
          'opacity-0 group-hover:opacity-100 transition-opacity',
          'hover:bg-foreground/10 text-muted-foreground hover:text-foreground'
        )}
        aria-label="Dismiss suggestion"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {/* Content */}
      <div className="flex gap-3">
        {/* Icon */}
        <div
          className={cn(
            'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center',
            'bg-foreground/5'
          )}
        >
          <Icon className={cn('h-4 w-4', iconColor)} />
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0 pr-4">
          <h4 className="text-sm font-medium truncate">{suggestion.title}</h4>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {suggestion.description}
          </p>

          {/* Action button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleAction}
            className="mt-2 h-7 text-xs"
          >
            {suggestion.actionLabel}
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
