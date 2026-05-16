/**
 * StandardInterviewStep
 *
 * Standard epic creation: 6-question structured form.
 * Part of the EpicCreationWizard flow.
 *
 * Questions:
 * 1. Title (required)
 * 2. Description / problem statement
 * 3. Acceptance criteria (textarea, one per line)
 * 4. Dependencies on other epics (optional dropdown)
 * 5. Estimated complexity (S/M/L selector)
 * 6. Technical notes / constraints
 *
 * Features:
 * - Zod validation for form data
 * - Full accessibility support
 * - Keyboard navigation
 */

import * as React from 'react'
import { z } from 'zod'
import { ClipboardList, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { EpicSummary } from '../../../shared/flow-schemas'

// ─── Validation Schema ────────────────────────────────────────────────────────

export const epicComplexitySchema = z.enum(['S', 'M', 'L'])
export type EpicComplexity = z.infer<typeof epicComplexitySchema>

export const standardEpicSchema = z.object({
  title: z
    .string()
    .min(3, 'Title must be at least 3 characters')
    .max(100, 'Title must be less than 100 characters'),
  description: z
    .string()
    .max(2000, 'Description must be less than 2000 characters')
    .optional()
    .default(''),
  acceptanceCriteria: z
    .string()
    .max(5000, 'Acceptance criteria must be less than 5000 characters')
    .optional()
    .default(''),
  dependsOnEpic: z.string().nullable().optional().default(null),
  complexity: epicComplexitySchema.default('M'),
  technicalNotes: z
    .string()
    .max(2000, 'Technical notes must be less than 2000 characters')
    .optional()
    .default(''),
})

export type StandardEpicFormData = z.infer<typeof standardEpicSchema>

// ─── Props ────────────────────────────────────────────────────────────────────

export interface StandardInterviewStepProps {
  /** Available epics for dependency selection */
  epics: EpicSummary[]
  /** Callback when user goes back to template selection */
  onBack: () => void
  /** Callback to create the epic */
  onCreate: (data: StandardEpicFormData) => Promise<void>
  /** Whether creation is in progress */
  isCreating: boolean
  /** Error message if creation failed */
  error: string | null
  /** Callback to clear error */
  onClearError?: () => void
  /** Optional className */
  className?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COMPLEXITY_OPTIONS: { value: EpicComplexity; label: string; description: string }[] = [
  { value: 'S', label: 'Small', description: '1-3 tasks, few hours' },
  { value: 'M', label: 'Medium', description: '4-8 tasks, 1-3 days' },
  { value: 'L', label: 'Large', description: '9+ tasks, week+' },
]

// ─── Component ────────────────────────────────────────────────────────────────

export function StandardInterviewStep({
  epics,
  onBack,
  onCreate,
  isCreating,
  error,
  onClearError,
  className,
}: StandardInterviewStepProps) {
  const [formData, setFormData] = React.useState<StandardEpicFormData>({
    title: '',
    description: '',
    acceptanceCriteria: '',
    dependsOnEpic: null,
    complexity: 'M',
    technicalNotes: '',
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
  const updateField = <K extends keyof StandardEpicFormData>(
    field: K,
    value: StandardEpicFormData[K]
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
    const result = standardEpicSchema.safeParse(formData)
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

  // Filter out done epics for dependency selection
  const availableEpics = epics.filter((e) => e.status !== 'done')

  // Field IDs for accessibility
  const ids = {
    title: 'standard-epic-title',
    titleError: 'standard-epic-title-error',
    description: 'standard-epic-description',
    descriptionError: 'standard-epic-description-error',
    acceptance: 'standard-epic-acceptance',
    acceptanceError: 'standard-epic-acceptance-error',
    complexity: 'standard-epic-complexity',
    depends: 'standard-epic-depends',
    techNotes: 'standard-epic-tech-notes',
    techNotesError: 'standard-epic-tech-notes-error',
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('flex flex-col items-center w-full', className)}
      data-testid="standard-epic-step"
      aria-label="Standard epic creation form"
    >
      {/* Icon */}
      <div className="mb-6 flex size-14 items-center justify-center rounded-full bg-blue-500/10" aria-hidden="true">
        <ClipboardList className="size-7 text-blue-500" />
      </div>

      {/* Header */}
      <div className="text-center mb-6">
        <h2 className="text-lg font-semibold" id="standard-epic-heading">Standard Epic</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Fill out the details to create a well-structured epic.
        </p>
      </div>

      {/* Form */}
      <ScrollArea className="w-full max-h-[50vh]">
        <div className="w-full space-y-5 px-1">
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
              placeholder="e.g., User Authentication System"
              disabled={isCreating}
              aria-invalid={!!fieldErrors.title}
              aria-describedby={fieldErrors.title ? ids.titleError : undefined}
              data-testid="standard-epic-title-input"
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
              Description
            </Label>
            <Textarea
              id={ids.description}
              value={formData.description}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="Describe the problem this epic solves..."
              className={cn('min-h-[80px] resize-none', fieldErrors.description && 'border-destructive')}
              disabled={isCreating}
              aria-invalid={!!fieldErrors.description}
              aria-describedby={fieldErrors.description ? ids.descriptionError : undefined}
              data-testid="standard-epic-description-input"
            />
            {fieldErrors.description && (
              <p id={ids.descriptionError} className="text-xs text-destructive" role="alert">
                {fieldErrors.description}
              </p>
            )}
          </div>

          {/* Acceptance Criteria */}
          <div className="space-y-2">
            <Label htmlFor={ids.acceptance} className="text-sm font-medium">
              Acceptance Criteria
            </Label>
            <Textarea
              id={ids.acceptance}
              value={formData.acceptanceCriteria}
              onChange={(e) => updateField('acceptanceCriteria', e.target.value)}
              placeholder="One criterion per line..."
              className={cn('min-h-[80px] resize-none font-mono text-sm', fieldErrors.acceptanceCriteria && 'border-destructive')}
              disabled={isCreating}
              aria-invalid={!!fieldErrors.acceptanceCriteria}
              aria-describedby={fieldErrors.acceptanceCriteria ? ids.acceptanceError : 'acceptance-hint'}
              data-testid="standard-epic-acceptance-input"
            />
            {fieldErrors.acceptanceCriteria ? (
              <p id={ids.acceptanceError} className="text-xs text-destructive" role="alert">
                {fieldErrors.acceptanceCriteria}
              </p>
            ) : (
              <p id="acceptance-hint" className="text-xs text-muted-foreground">
                Enter each criterion on a new line
              </p>
            )}
          </div>

          {/* Complexity & Dependencies Row */}
          <div className="grid grid-cols-2 gap-4">
            {/* Complexity */}
            <div className="space-y-2">
              <Label htmlFor={ids.complexity} className="text-sm font-medium">Complexity</Label>
              <Select
                value={formData.complexity}
                onValueChange={(v) => updateField('complexity', v as EpicComplexity)}
                disabled={isCreating}
              >
                <SelectTrigger
                  id={ids.complexity}
                  data-testid="standard-epic-complexity-select"
                  aria-label="Select epic complexity"
                >
                  <SelectValue placeholder="Select size" />
                </SelectTrigger>
                <SelectContent>
                  {COMPLEXITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{opt.label}</span>
                        <span className="text-muted-foreground text-xs">
                          ({opt.description})
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Dependencies */}
            <div className="space-y-2">
              <Label htmlFor={ids.depends} className="text-sm font-medium">Depends On</Label>
              <Select
                value={formData.dependsOnEpic ?? '__none__'}
                onValueChange={(v) => updateField('dependsOnEpic', v === '__none__' ? null : v)}
                disabled={isCreating}
              >
                <SelectTrigger
                  id={ids.depends}
                  data-testid="standard-epic-depends-select"
                  aria-label="Select epic dependency"
                >
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {availableEpics.map((epic) => (
                    <SelectItem key={epic.id} value={epic.id}>
                      {epic.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Technical Notes */}
          <div className="space-y-2">
            <Label htmlFor={ids.techNotes} className="text-sm font-medium">
              Technical Notes
            </Label>
            <Textarea
              id={ids.techNotes}
              value={formData.technicalNotes}
              onChange={(e) => updateField('technicalNotes', e.target.value)}
              placeholder="Any technical constraints or considerations..."
              className={cn('min-h-[60px] resize-none', fieldErrors.technicalNotes && 'border-destructive')}
              disabled={isCreating}
              aria-invalid={!!fieldErrors.technicalNotes}
              aria-describedby={fieldErrors.technicalNotes ? ids.techNotesError : undefined}
              data-testid="standard-epic-tech-notes-input"
            />
            {fieldErrors.technicalNotes && (
              <p id={ids.techNotesError} className="text-xs text-destructive" role="alert">
                {fieldErrors.technicalNotes}
              </p>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Error message */}
      {displayError && (
        <div
          role="alert"
          className="flex items-center justify-center gap-2 text-sm text-destructive mt-4 w-full"
          data-testid="standard-epic-error"
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
          data-testid="standard-epic-back-button"
        >
          Back
        </Button>
        <Button
          type="submit"
          className="flex-1"
          disabled={!formData.title.trim() || isCreating}
          aria-busy={isCreating}
          data-testid="standard-epic-submit-button"
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
