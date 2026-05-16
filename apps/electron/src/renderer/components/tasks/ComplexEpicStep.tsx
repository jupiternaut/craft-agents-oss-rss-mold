/**
 * ComplexEpicStep
 *
 * Complex epic creation: creates an epic shell and opens split-view chat
 * for a deep AI-assisted interview.
 * Part of the EpicCreationWizard flow.
 *
 * Features:
 * - Title and brief description input
 * - Zod validation for form data
 * - Creates epic shell immediately
 * - Opens split-view chat for detailed planning (task 10)
 * - Full accessibility support
 */

import * as React from 'react'
import { z } from 'zod'
import { MessageSquarePlus, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

// ─── Validation Schema ────────────────────────────────────────────────────────

export const complexEpicSchema = z.object({
  title: z
    .string()
    .min(3, 'Title must be at least 3 characters')
    .max(100, 'Title must be less than 100 characters'),
  description: z
    .string()
    .max(2000, 'Description must be less than 2000 characters')
    .optional()
    .default(''),
})

export type ComplexEpicFormData = z.infer<typeof complexEpicSchema>

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ComplexEpicStepProps {
  /** Callback when user goes back to template selection */
  onBack: () => void
  /** Callback to create the epic shell and open chat */
  onCreate: (data: ComplexEpicFormData) => Promise<void>
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

export function ComplexEpicStep({
  onBack,
  onCreate,
  isCreating,
  error,
  onClearError,
  className,
}: ComplexEpicStepProps) {
  const [formData, setFormData] = React.useState<ComplexEpicFormData>({
    title: '',
    description: '',
  })
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})

  const titleInputRef = React.useRef<HTMLInputElement>(null)

  // Combined error for display (server error takes precedence)
  const displayError = error

  // Focus title input on mount
  React.useEffect(() => {
    titleInputRef.current?.focus()
  }, [])

  // Update form field
  const updateField = <K extends keyof ComplexEpicFormData>(
    field: K,
    value: ComplexEpicFormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    // Clear field error when user starts typing
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
    // Clear server error
    if (error) {
      onClearError?.()
    }
  }

  // Validate form
  const validate = React.useCallback((): boolean => {
    const result = complexEpicSchema.safeParse(formData)
    if (!result.success) {
      const errors: Record<string, string> = {}
      for (const issue of result.error.issues) {
        const field = issue.path[0]
        if (typeof field === 'string' && !errors[field]) {
          errors[field] = issue.message
        }
      }
      setFieldErrors(errors)
      return false
    }
    setFieldErrors({})
    return true
  }, [formData])

  // Handle form submit
  const handleSubmit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (isCreating) return
      if (!validate()) return
      await onCreate(formData)
    },
    [formData, isCreating, onCreate, validate]
  )

  // Field IDs for accessibility
  const ids = {
    title: 'complex-epic-title',
    titleError: 'complex-epic-title-error',
    description: 'complex-epic-description',
    descriptionError: 'complex-epic-description-error',
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('flex flex-col items-center w-full max-w-md', className)}
      data-testid="complex-epic-step"
      aria-label="Complex epic creation form"
    >
      {/* Icon */}
      <div className="mb-6 flex size-14 items-center justify-center rounded-full bg-violet-500/10" aria-hidden="true">
        <MessageSquarePlus className="size-7 text-violet-500" />
      </div>

      {/* Header */}
      <div className="text-center mb-6">
        <h2 className="text-lg font-semibold" id="complex-epic-heading">Complex Epic</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Start with a title and description. Then dive deep with an AI-assisted planning session.
        </p>
      </div>

      {/* Form */}
      <div className="w-full space-y-5">
        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor={ids.title} className="text-sm font-medium">
            Title <span className="text-destructive" aria-hidden="true">*</span>
            <span className="sr-only">(required)</span>
          </Label>
          <Input
            ref={titleInputRef}
            id={ids.title}
            value={formData.title}
            onChange={(e) => updateField('title', e.target.value)}
            placeholder="e.g., Complete Platform Redesign"
            disabled={isCreating}
            aria-invalid={!!fieldErrors.title}
            aria-describedby={fieldErrors.title ? ids.titleError : undefined}
            data-testid="complex-epic-title-input"
            className={cn(fieldErrors.title && 'border-destructive')}
          />
          {fieldErrors.title && (
            <p id={ids.titleError} className="text-xs text-destructive" role="alert">
              {fieldErrors.title}
            </p>
          )}
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor={ids.description} className="text-sm font-medium">
            Initial Description
          </Label>
          <Textarea
            id={ids.description}
            value={formData.description}
            onChange={(e) => updateField('description', e.target.value)}
            placeholder="Briefly describe what you want to accomplish. We'll explore the details together in a chat session..."
            className={cn('min-h-[120px] resize-none', fieldErrors.description && 'border-destructive')}
            disabled={isCreating}
            aria-invalid={!!fieldErrors.description}
            aria-describedby={fieldErrors.description ? ids.descriptionError : undefined}
            data-testid="complex-epic-description-input"
          />
          {fieldErrors.description && (
            <p id={ids.descriptionError} className="text-xs text-destructive" role="alert">
              {fieldErrors.description}
            </p>
          )}
        </div>

        {/* Info box */}
        <div
          className="rounded-lg bg-violet-500/5 border border-violet-500/10 p-4"
          role="note"
          aria-label="What happens next"
        >
          <p className="text-sm text-muted-foreground">
            After creating the epic shell, a split-view chat will open where you can work with AI to:
          </p>
          <ul className="mt-2 text-sm text-muted-foreground space-y-1" aria-label="Chat session features">
            <li className="flex items-start gap-2">
              <span className="text-violet-500" aria-hidden="true">-</span>
              Explore requirements and edge cases
            </li>
            <li className="flex items-start gap-2">
              <span className="text-violet-500" aria-hidden="true">-</span>
              Break down into well-scoped tasks
            </li>
            <li className="flex items-start gap-2">
              <span className="text-violet-500" aria-hidden="true">-</span>
              Define dependencies and priorities
            </li>
          </ul>
        </div>
      </div>

      {/* Error message */}
      {displayError && (
        <div
          role="alert"
          className="flex items-center gap-2 text-sm text-destructive mt-4 w-full"
          data-testid="complex-epic-error"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <span>{displayError}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 w-full mt-6">
        <Button
          type="button"
          variant="ghost"
          className="flex-1 bg-foreground-2"
          onClick={onBack}
          disabled={isCreating}
          data-testid="complex-epic-back-button"
        >
          Back
        </Button>
        <Button
          type="submit"
          className="flex-1"
          disabled={!formData.title.trim() || isCreating}
          aria-busy={isCreating}
          data-testid="complex-epic-submit-button"
        >
          {isCreating ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" aria-hidden="true" />
              <span>Creating...</span>
            </>
          ) : (
            <>
              Create & Start Chat
            </>
          )}
        </Button>
      </div>
    </form>
  )
}
