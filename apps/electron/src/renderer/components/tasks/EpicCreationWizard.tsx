/**
 * EpicCreationWizard
 *
 * Modal dialog wizard for creating new epics with three complexity tiers:
 * - Quick: One-liner input, auto-generates epic
 * - Standard: 6-question structured interview
 * - Complex: Creates shell and opens split-view chat
 *
 * Features:
 * - Radix Dialog modal with full accessibility support
 * - Step 1: Template picker with three cards
 * - Step 2: Template-specific form with Zod validation
 * - Back/Next navigation with keyboard support
 * - Loading states during IPC calls with abort handling
 * - Error handling with retry option
 * - Escape to close
 */

import * as React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Zap, ClipboardList, MessageSquarePlus, Check } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { QuickEpicStep } from './QuickEpicStep'
import { StandardInterviewStep, type StandardEpicFormData } from './StandardInterviewStep'
import { ComplexEpicStep, type ComplexEpicFormData } from './ComplexEpicStep'
import type { EpicSummary, FlowBridgeError } from '../../../shared/flow-schemas'

// ─── Error Helpers ─────────────────────────────────────────────────────────────

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    // Handle abort errors gracefully
    if (err.name === 'AbortError') {
      return 'Operation cancelled'
    }
    return err.message
  }
  return 'An unexpected error occurred'
}

function getFlowBridgeErrorMessage(error: FlowBridgeError): string {
  switch (error.type) {
    case 'flowctl_not_found':
      return 'Flow CLI not found. Make sure flowctl is installed in .flow/bin/'
    case 'invalid_json':
      return 'Unexpected response from Flow CLI.'
    case 'invalid_output':
      return 'Invalid response format from Flow CLI.'
    case 'command_failed':
      return error.stderr || 'Flow command failed.'
    case 'timeout':
      return 'Command timed out. Please try again.'
    case 'no_project_configured':
      return 'No project configured. Register a project first.'
  }
}

// ─── Spec Generation ───────────────────────────────────────────────────────────

function generateStandardEpicSpec(data: StandardEpicFormData, epicId: string): string {
  const lines: string[] = [
    `# ${data.title}`,
    '',
    `Epic ID: ${epicId}`,
    '',
  ]

  if (data.description) {
    lines.push('## Description', '', data.description, '')
  }

  if (data.acceptanceCriteria) {
    lines.push('## Acceptance Criteria', '')
    const criteria = data.acceptanceCriteria.split('\n').filter(Boolean)
    criteria.forEach(c => lines.push(`- [ ] ${c.trim()}`))
    lines.push('')
  }

  if (data.dependsOnEpic) {
    lines.push('## Dependencies', '', `- Depends on: ${data.dependsOnEpic}`, '')
  }

  lines.push('## Complexity', '', `Estimated: ${data.complexity}`, '')

  if (data.technicalNotes) {
    lines.push('## Technical Notes', '', data.technicalNotes, '')
  }

  return lines.join('\n')
}

function generateComplexEpicSpec(data: ComplexEpicFormData, epicId: string): string {
  const lines: string[] = [
    `# ${data.title}`,
    '',
    `Epic ID: ${epicId}`,
    '',
    '## Initial Description',
    '',
    data.description || '_To be defined through planning chat._',
    '',
    '## Tasks',
    '',
    '_To be created during planning session._',
    '',
  ]

  return lines.join('\n')
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type EpicTemplate = 'quick' | 'standard' | 'complex'

export type WizardStep = 'template' | 'form'

export interface EpicCreationWizardProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void
  /** Workspace root for IPC calls */
  workspaceRoot: string
  /** Available epics for dependency selection */
  epics: EpicSummary[]
  /** Callback when epic is created successfully */
  onEpicCreated: (epicId: string) => void
  /** Callback to open split-view chat for complex epics (task 10) */
  onOpenChat?: (epicId: string) => void
}

// ─── Template Options ────────────────────────────────────────────────────────

interface TemplateOption {
  id: EpicTemplate
  name: string
  description: string
  icon: React.ReactNode
  iconBgClass: string
  recommended?: boolean
}

const TEMPLATE_OPTIONS: TemplateOption[] = [
  {
    id: 'quick',
    name: 'Quick',
    description: 'One-liner that auto-generates an epic. Best for small, well-understood tasks.',
    icon: <Zap className="size-5" />,
    iconBgClass: 'bg-amber-500/10 text-amber-500',
  },
  {
    id: 'standard',
    name: 'Standard',
    description: 'Guided form with 6 questions. Good for most features and improvements.',
    icon: <ClipboardList className="size-5" />,
    iconBgClass: 'bg-blue-500/10 text-blue-500',
    recommended: true,
  },
  {
    id: 'complex',
    name: 'Complex',
    description: 'Creates a shell and opens a chat for deep AI-assisted planning.',
    icon: <MessageSquarePlus className="size-5" />,
    iconBgClass: 'bg-violet-500/10 text-violet-500',
  },
]

// ─── Spring Animation Config ─────────────────────────────────────────────────

const springTransition = {
  type: 'spring' as const,
  stiffness: 600,
  damping: 49,
}

// ─── Component ───────────────────────────────────────────────────────────────

export function EpicCreationWizard({
  open,
  onOpenChange,
  workspaceRoot,
  epics,
  onEpicCreated,
  onOpenChat,
}: EpicCreationWizardProps) {
  // State
  const [step, setStep] = React.useState<WizardStep>('template')
  const [selectedTemplate, setSelectedTemplate] = React.useState<EpicTemplate | null>(null)
  const [isCreating, setIsCreating] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [shouldReset, setShouldReset] = React.useState(false)

  // Abort controller for cancelling in-flight requests
  const abortControllerRef = React.useRef<AbortController | null>(null)

  // Mark for reset when dialog closes (actual reset happens on animation complete)
  React.useEffect(() => {
    if (!open) {
      setShouldReset(true)
      // Cancel any in-flight requests
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
    }
  }, [open])

  // Reset state after close animation completes
  const handleCloseAnimationComplete = React.useCallback(() => {
    if (shouldReset) {
      setStep('template')
      setSelectedTemplate(null)
      setIsCreating(false)
      setError(null)
      setShouldReset(false)
    }
  }, [shouldReset])

  // Handle template selection
  const handleSelectTemplate = React.useCallback((template: EpicTemplate) => {
    setSelectedTemplate(template)
  }, [])

  // Handle continue to form step
  const handleContinue = React.useCallback(() => {
    if (selectedTemplate) {
      setStep('form')
      setError(null)
    }
  }, [selectedTemplate])

  // Handle back to template selection
  const handleBack = React.useCallback(() => {
    setStep('template')
    setError(null)
  }, [])

  // Clear error
  const handleClearError = React.useCallback(() => {
    setError(null)
  }, [])

  // ─── Creation Handlers ─────────────────────────────────────────────────────

  // Quick epic creation
  const handleQuickCreate = React.useCallback(
    async (description: string) => {
      // Cancel any previous request
      abortControllerRef.current?.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller

      setIsCreating(true)
      setError(null)

      try {
        // Extract title from description (first sentence or first ~60 chars)
        const title = description.split(/[.\n]/)[0].slice(0, 100).trim() || description.slice(0, 60)

        const result = await window.electronAPI.flowEpicCreate(workspaceRoot, title)

        if (controller.signal.aborted) return

        if (!result.ok) {
          throw new Error(getFlowBridgeErrorMessage(result.error))
        }

        toast.success('Epic created!', {
          description: 'Run /plan in the chat to generate tasks.',
        })

        onOpenChange(false)
        onEpicCreated(result.data.id)
      } catch (err) {
        // Don't show error for intentional aborts
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(getErrorMessage(err))
      } finally {
        if (!controller.signal.aborted) {
          setIsCreating(false)
        }
      }
    },
    [workspaceRoot, onOpenChange, onEpicCreated]
  )

  // Standard epic creation
  const handleStandardCreate = React.useCallback(
    async (data: StandardEpicFormData) => {
      // Cancel any previous request
      abortControllerRef.current?.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller

      setIsCreating(true)
      setError(null)

      try {
        // Step 1: Create epic with title
        const createResult = await window.electronAPI.flowEpicCreate(workspaceRoot, data.title)

        if (controller.signal.aborted) return
        if (!createResult.ok) {
          throw new Error(getFlowBridgeErrorMessage(createResult.error))
        }

        const epicId = createResult.data.id

        // Step 2: Set full spec with all form data
        const specContent = generateStandardEpicSpec(data, epicId)
        const planResult = await window.electronAPI.flowEpicSetPlan(workspaceRoot, epicId, specContent)

        if (controller.signal.aborted) return
        if (!planResult.ok) {
          // Epic was created but spec update failed - log but don't block
          console.error('[EpicCreation] Failed to set plan:', planResult.error)
        }

        toast.success('Epic created!', {
          description: 'Run /plan in the chat to generate tasks.',
        })

        onOpenChange(false)
        onEpicCreated(epicId)
      } catch (err) {
        // Don't show error for intentional aborts
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(getErrorMessage(err))
      } finally {
        if (!controller.signal.aborted) {
          setIsCreating(false)
        }
      }
    },
    [workspaceRoot, onOpenChange, onEpicCreated]
  )

  // Complex epic creation
  const handleComplexCreate = React.useCallback(
    async (data: ComplexEpicFormData) => {
      // Cancel any previous request
      abortControllerRef.current?.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller

      setIsCreating(true)
      setError(null)

      try {
        // Create epic shell
        const createResult = await window.electronAPI.flowEpicCreate(workspaceRoot, data.title)

        if (controller.signal.aborted) return
        if (!createResult.ok) {
          throw new Error(getFlowBridgeErrorMessage(createResult.error))
        }

        const epicId = createResult.data.id

        // If description provided, set initial spec
        if (data.description?.trim()) {
          const specContent = generateComplexEpicSpec(data, epicId)
          const planResult = await window.electronAPI.flowEpicSetPlan(workspaceRoot, epicId, specContent)

          if (controller.signal.aborted) return
          if (!planResult.ok) {
            console.error('[EpicCreation] Failed to set plan:', planResult.error)
          }
        }

        toast.success('Epic created!', {
          description: onOpenChat
            ? 'Opening chat to help plan tasks...'
            : 'Run /plan in the chat to generate tasks.',
        })

        onOpenChange(false)
        onEpicCreated(epicId)

        // Open split-view chat for complex epic planning
        onOpenChat?.(epicId)
      } catch (err) {
        // Don't show error for intentional aborts
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(getErrorMessage(err))
      } finally {
        if (!controller.signal.aborted) {
          setIsCreating(false)
        }
      }
    },
    [workspaceRoot, onOpenChange, onEpicCreated, onOpenChat]
  )

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[560px] p-0 max-h-[85vh] flex flex-col"
        showCloseButton={!isCreating}
        aria-labelledby="epic-wizard-title"
        aria-describedby="epic-wizard-description"
        data-testid="epic-creation-wizard"
      >
        {/* Visually hidden description for accessibility */}
        <DialogDescription id="epic-wizard-description" className="sr-only">
          Wizard to create a new epic. Choose a template and fill out the form.
        </DialogDescription>
        <div className="p-6 overflow-y-auto flex-1 flex flex-col items-center">
          <AnimatePresence mode="wait" onExitComplete={handleCloseAnimationComplete}>
            {step === 'template' && (
              <motion.div
                key="template"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={springTransition}
                role="region"
                aria-label="Template selection"
              >
                <TemplatePickerStep
                  selectedTemplate={selectedTemplate}
                  onSelectTemplate={handleSelectTemplate}
                  onContinue={handleContinue}
                />
              </motion.div>
            )}

            {step === 'form' && selectedTemplate === 'quick' && (
              <motion.div
                key="quick"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={springTransition}
                role="region"
                aria-label="Quick epic form"
              >
                <QuickEpicStep
                  onBack={handleBack}
                  onCreate={handleQuickCreate}
                  isCreating={isCreating}
                  error={error}
                  onClearError={handleClearError}
                />
              </motion.div>
            )}

            {step === 'form' && selectedTemplate === 'standard' && (
              <motion.div
                key="standard"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={springTransition}
                role="region"
                aria-label="Standard epic form"
              >
                <StandardInterviewStep
                  epics={epics}
                  onBack={handleBack}
                  onCreate={handleStandardCreate}
                  isCreating={isCreating}
                  error={error}
                  onClearError={handleClearError}
                />
              </motion.div>
            )}

            {step === 'form' && selectedTemplate === 'complex' && (
              <motion.div
                key="complex"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={springTransition}
                role="region"
                aria-label="Complex epic form"
              >
                <ComplexEpicStep
                  onBack={handleBack}
                  onCreate={handleComplexCreate}
                  isCreating={isCreating}
                  error={error}
                  onClearError={handleClearError}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Template Picker Step ────────────────────────────────────────────────────

interface TemplatePickerStepProps {
  selectedTemplate: EpicTemplate | null
  onSelectTemplate: (template: EpicTemplate) => void
  onContinue: () => void
}

function TemplatePickerStep({
  selectedTemplate,
  onSelectTemplate,
  onContinue,
}: TemplatePickerStepProps) {
  // Handle keyboard navigation within template options
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent, currentIndex: number) => {
      const templates = TEMPLATE_OPTIONS
      let nextIndex: number | null = null

      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowRight':
          e.preventDefault()
          nextIndex = (currentIndex + 1) % templates.length
          break
        case 'ArrowUp':
        case 'ArrowLeft':
          e.preventDefault()
          nextIndex = (currentIndex - 1 + templates.length) % templates.length
          break
        case 'Enter':
        case ' ':
          e.preventDefault()
          onSelectTemplate(templates[currentIndex].id)
          break
      }

      if (nextIndex !== null) {
        onSelectTemplate(templates[nextIndex].id)
        // Focus the next button
        const nextButton = document.querySelector(
          `[data-testid="template-option-${templates[nextIndex].id}"]`
        ) as HTMLButtonElement | null
        nextButton?.focus()
      }
    },
    [onSelectTemplate]
  )

  return (
    <div className="flex flex-col items-center" data-testid="template-picker-step">
      {/* Header */}
      <DialogHeader className="text-center mb-6">
        <DialogTitle id="epic-wizard-title" className="text-lg font-semibold">
          Create New Epic
        </DialogTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Choose how you'd like to define your epic.
        </p>
      </DialogHeader>

      {/* Template Cards */}
      <div
        className="w-full space-y-3"
        role="radiogroup"
        aria-label="Epic template options"
      >
        {TEMPLATE_OPTIONS.map((option, index) => {
          const isSelected = option.id === selectedTemplate

          return (
            <button
              key={option.id}
              onClick={() => onSelectTemplate(option.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              role="radio"
              aria-checked={isSelected}
              aria-describedby={`template-desc-${option.id}`}
              data-testid={`template-option-${option.id}`}
              className={cn(
                'flex w-full items-start gap-4 rounded-xl p-4 text-left transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'hover:bg-foreground/[0.02] shadow-minimal',
                isSelected ? 'bg-background' : 'bg-foreground-2'
              )}
            >
              {/* Icon */}
              <div
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-lg',
                  option.iconBgClass
                )}
                aria-hidden="true"
              >
                {option.icon}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{option.name}</span>
                  {option.recommended && (
                    <span className="rounded-[4px] bg-background shadow-minimal px-2 py-0.5 text-[11px] font-medium text-foreground/70">
                      Recommended
                    </span>
                  )}
                </div>
                <p id={`template-desc-${option.id}`} className="mt-1 text-xs text-muted-foreground">
                  {option.description}
                </p>
              </div>

              {/* Check */}
              <div
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                  isSelected
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-muted-foreground/20'
                )}
                aria-hidden="true"
              >
                {isSelected && <Check className="size-3" strokeWidth={3} />}
              </div>
            </button>
          )
        })}
      </div>

      {/* Continue Button */}
      <button
        onClick={onContinue}
        disabled={!selectedTemplate}
        data-testid="template-continue-button"
        aria-disabled={!selectedTemplate}
        className={cn(
          'mt-6 w-full py-2.5 px-4 rounded-lg font-medium text-sm transition-all',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          selectedTemplate
            ? 'bg-foreground text-background hover:bg-foreground/90'
            : 'bg-foreground/10 text-muted-foreground cursor-not-allowed'
        )}
      >
        Continue
      </button>
    </div>
  )
}
