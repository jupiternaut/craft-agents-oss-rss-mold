/**
 * QuickEpicStep
 *
 * Quick epic creation: single text input that creates an epic from a one-liner.
 * Part of the EpicCreationWizard flow.
 *
 * Features:
 * - Single textarea for epic description
 * - Zod validation for input
 * - Auto-generates title from description
 * - Creates epic immediately on submit
 * - Full accessibility support
 */

import * as React from 'react'
import { z } from 'zod'
import { Zap, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

// ─── Validation Schema ────────────────────────────────────────────────────────

export const quickEpicSchema = z.object({
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(500, 'Description must be less than 500 characters'),
})

export type QuickEpicFormData = z.infer<typeof quickEpicSchema>

// ─── Props ────────────────────────────────────────────────────────────────────

export interface QuickEpicStepProps {
  /** Callback when user goes back to template selection */
  onBack: () => void
  /** Callback to create the epic */
  onCreate: (description: string) => Promise<void>
  /** Whether creation is in progress */
  isCreating: boolean
  /** Error message if creation failed */
  error: string | null
  /** Callback to clear error */
  onClearError?: () => void
  /** Optional className */
  className?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function QuickEpicStep({
  onBack,
  onCreate,
  isCreating,
  error,
  onClearError,
  className,
}: QuickEpicStepProps) {
  const [description, setDescription] = React.useState('')
  const [validationError, setValidationError] = React.useState<string | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // Combined error for display
  const displayError = error || validationError

  // Focus textarea on mount
  React.useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // Validate input
  const validate = React.useCallback((value: string): boolean => {
    const result = quickEpicSchema.safeParse({ description: value })
    if (!result.success) {
      setValidationError(result.error.issues[0]?.message ?? 'Invalid input')
      return false
    }
    setValidationError(null)
    return true
  }, [])

  // Handle form submit
  const handleSubmit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const trimmed = description.trim()
      if (!trimmed || isCreating) return
      if (!validate(trimmed)) return
      await onCreate(trimmed)
    },
    [description, isCreating, onCreate, validate]
  )

  // Handle Cmd/Ctrl+Enter to submit
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        const trimmed = description.trim()
        if (trimmed && !isCreating && validate(trimmed)) {
          onCreate(trimmed)
        }
      }
    },
    [description, isCreating, onCreate, validate]
  )

  // Clear errors when description changes
  React.useEffect(() => {
    if (displayError && description) {
      setValidationError(null)
      onClearError?.()
    }
  }, [description, displayError, onClearError])

  const inputId = 'quick-epic-description'
  const errorId = 'quick-epic-error'

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('flex flex-col items-center w-full max-w-md', className)}
      data-testid="quick-epic-step"
      aria-label="Quick epic creation form"
    >
      {/* Icon */}
      <div className="mb-6 flex size-14 items-center justify-center rounded-full bg-amber-500/10" aria-hidden="true">
        <Zap className="size-7 text-amber-500" />
      </div>

      {/* Header */}
      <div className="text-center mb-6">
        <h2 className="text-lg font-semibold" id="quick-epic-title">Quick Epic</h2>
        <p className="text-sm text-muted-foreground mt-1" id="quick-epic-desc">
          Describe your epic in a sentence. We'll create it instantly.
        </p>
      </div>

      {/* Input */}
      <div className="w-full space-y-4">
        <div className="space-y-2">
          <label htmlFor={inputId} className="sr-only">
            Epic description
          </label>
          <Textarea
            ref={textareaRef}
            id={inputId}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g., Add user authentication with OAuth support"
            className={cn(
              'min-h-[100px] resize-none',
              displayError && 'border-destructive focus-visible:ring-destructive'
            )}
            disabled={isCreating}
            aria-invalid={!!displayError}
            aria-describedby={displayError ? errorId : 'quick-epic-hint'}
            data-testid="quick-epic-textarea"
          />
        </div>

        {/* Error message */}
        {displayError && (
          <div
            id={errorId}
            role="alert"
            className="flex items-center gap-2 text-sm text-destructive"
            data-testid="quick-epic-error"
          >
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            <span>{displayError}</span>
          </div>
        )}

        {/* Hint */}
        <p id="quick-epic-hint" className="text-xs text-muted-foreground">
          Press <kbd className="px-1.5 py-0.5 rounded bg-foreground/5 font-mono text-xs">Cmd+Enter</kbd> to create
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-3 w-full mt-6">
        <Button
          type="button"
          variant="ghost"
          className="flex-1 bg-foreground-2"
          onClick={onBack}
          disabled={isCreating}
          data-testid="quick-epic-back-button"
        >
          Back
        </Button>
        <Button
          type="submit"
          className="flex-1"
          disabled={!description.trim() || isCreating}
          aria-busy={isCreating}
          data-testid="quick-epic-submit-button"
        >
          {isCreating ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" aria-hidden="true" />
              <span>Creating...</span>
            </>
          ) : (
            'Create Epic'
          )}
        </Button>
      </div>
    </form>
  )
}
