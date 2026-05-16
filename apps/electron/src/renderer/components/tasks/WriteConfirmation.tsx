/**
 * WriteConfirmation
 *
 * Confirmation dialog for AI-proposed task mutations.
 * Shows a preview of the proposed change with Apply/Dismiss buttons.
 *
 * Supported mutations:
 * - Task status change
 * - Task creation
 * - Epic spec edit (future)
 */

import * as React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Check, X, AlertTriangle, Plus, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

// ─── Types ────────────────────────────────────────────────────────────────────

export type MutationType = 'status_change' | 'create_task' | 'edit_spec'

export interface StatusChangeMutation {
  type: 'status_change'
  taskId: string
  taskTitle: string
  fromStatus: string
  toStatus: string
}

export interface CreateTaskMutation {
  type: 'create_task'
  epicId: string
  title: string
  description?: string
  dependsOn?: string[]
}

export interface EditSpecMutation {
  type: 'edit_spec'
  taskId: string
  taskTitle: string
  field: string
  oldValue: string
  newValue: string
}

export type TaskMutation = StatusChangeMutation | CreateTaskMutation | EditSpecMutation

export interface WriteConfirmationProps {
  /** The proposed mutation */
  mutation: TaskMutation | null
  /** Whether the mutation is currently being applied */
  isApplying?: boolean
  /** Callback when Apply is clicked */
  onApply: (mutation: TaskMutation) => void
  /** Callback when Dismiss is clicked */
  onDismiss: () => void
  /** Optional className */
  className?: string
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    todo: 'bg-foreground/5 text-foreground/70',
    in_progress: 'bg-blue-500/10 text-blue-600',
    blocked: 'bg-amber-500/10 text-amber-600',
    done: 'bg-emerald-500/10 text-emerald-600',
  }

  const labels: Record<string, string> = {
    todo: 'Todo',
    in_progress: 'In Progress',
    blocked: 'Blocked',
    done: 'Done',
  }

  return (
    <Badge variant="outline" className={cn('text-xs', colors[status])}>
      {labels[status] ?? status}
    </Badge>
  )
}

// ─── Mutation Preview Cards ───────────────────────────────────────────────────

function StatusChangePreview({ mutation }: { mutation: StatusChangeMutation }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowRight className="h-4 w-4" />
        <span>Change task status</span>
      </div>
      <div className="p-3 rounded-lg bg-foreground/3 space-y-2">
        <p className="text-sm font-medium truncate">{mutation.taskTitle}</p>
        <p className="text-xs text-muted-foreground">{mutation.taskId}</p>
        <div className="flex items-center gap-2 mt-2">
          <StatusBadge status={mutation.fromStatus} />
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <StatusBadge status={mutation.toStatus} />
        </div>
      </div>
    </div>
  )
}

function CreateTaskPreview({ mutation }: { mutation: CreateTaskMutation }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Plus className="h-4 w-4" />
        <span>Create new task</span>
      </div>
      <div className="p-3 rounded-lg bg-foreground/3 space-y-2">
        <p className="text-sm font-medium">{mutation.title}</p>
        {mutation.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {mutation.description}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Epic: {mutation.epicId}
        </p>
        {mutation.dependsOn && mutation.dependsOn.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Depends on: {mutation.dependsOn.join(', ')}
          </p>
        )}
      </div>
    </div>
  )
}

function EditSpecPreview({ mutation }: { mutation: EditSpecMutation }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AlertTriangle className="h-4 w-4" />
        <span>Edit task spec</span>
      </div>
      <div className="p-3 rounded-lg bg-foreground/3 space-y-2">
        <p className="text-sm font-medium truncate">{mutation.taskTitle}</p>
        <p className="text-xs text-muted-foreground">{mutation.taskId}</p>
        <div className="mt-2 space-y-1">
          <p className="text-xs">
            <span className="text-muted-foreground">Field:</span>{' '}
            <span className="font-medium">{mutation.field}</span>
          </p>
          <div className="text-xs">
            <span className="text-muted-foreground">From:</span>{' '}
            <span className="line-through text-muted-foreground/70">
              {mutation.oldValue || '(empty)'}
            </span>
          </div>
          <div className="text-xs">
            <span className="text-muted-foreground">To:</span>{' '}
            <span className="text-emerald-600">{mutation.newValue}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function WriteConfirmation({
  mutation,
  isApplying = false,
  onApply,
  onDismiss,
  className,
}: WriteConfirmationProps) {
  const handleApply = React.useCallback(() => {
    if (mutation) {
      onApply(mutation)
    }
  }, [mutation, onApply])

  if (!mutation) return null

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={mutation.type + (('taskId' in mutation) ? mutation.taskId : 'new')}
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ duration: 0.2 }}
        className={cn(
          'border border-border/50 rounded-lg p-4 bg-background shadow-minimal',
          className
        )}
      >
        {/* Preview content based on mutation type */}
        {mutation.type === 'status_change' && (
          <StatusChangePreview mutation={mutation} />
        )}
        {mutation.type === 'create_task' && (
          <CreateTaskPreview mutation={mutation} />
        )}
        {mutation.type === 'edit_spec' && (
          <EditSpecPreview mutation={mutation} />
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-border/30">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            disabled={isApplying}
            className="text-muted-foreground"
          >
            <X className="h-4 w-4 mr-1" />
            Dismiss
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleApply}
            disabled={isApplying}
          >
            {isApplying ? (
              <>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="h-4 w-4 mr-1"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4">
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                      strokeDasharray="30 70"
                    />
                  </svg>
                </motion.div>
                Applying...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-1" />
                Apply
              </>
            )}
          </Button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

// ─── Mutation Parser ──────────────────────────────────────────────────────────

/**
 * Parse AI response for proposed mutations.
 * Looks for structured mutation blocks in the AI's response.
 *
 * Expected format in AI response:
 * ```mutation
 * {
 *   "type": "status_change",
 *   "taskId": "fn-1.5",
 *   "taskTitle": "Implement feature X",
 *   "fromStatus": "todo",
 *   "toStatus": "in_progress"
 * }
 * ```
 */
export function parseMutationFromResponse(content: string): TaskMutation | null {
  // Look for mutation code blocks
  const mutationMatch = content.match(/```mutation\n([\s\S]*?)```/)
  if (!mutationMatch) return null

  try {
    const json = JSON.parse(mutationMatch[1])

    // Validate based on type
    if (json.type === 'status_change') {
      if (!json.taskId || !json.taskTitle || !json.fromStatus || !json.toStatus) {
        return null
      }
      return json as StatusChangeMutation
    }

    if (json.type === 'create_task') {
      if (!json.epicId || !json.title) {
        return null
      }
      return json as CreateTaskMutation
    }

    if (json.type === 'edit_spec') {
      if (!json.taskId || !json.taskTitle || !json.field || json.newValue === undefined) {
        return null
      }
      return json as EditSpecMutation
    }

    return null
  } catch {
    return null
  }
}
