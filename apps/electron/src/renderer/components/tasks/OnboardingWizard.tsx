/**
 * OnboardingWizard
 *
 * 5-step modal onboarding wizard for new flow-next projects.
 * Steps 1-2 (Welcome + Interactive Demo) are required (not skippable).
 * Steps 3-5 (Configure, Initialize, Create Epic) are individually skippable.
 *
 * Follows EpicCreationWizard.tsx pattern:
 * - Radix Dialog modal
 * - Motion AnimatePresence mode="wait"
 * - Spring config { type: 'spring', stiffness: 600, damping: 49 }
 */

import * as React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import confetti from 'canvas-confetti'
import {
  Rocket,
  ArrowRight,
  ArrowLeft,
  BookOpen,
  MousePointerClick,
  Settings,
  Terminal,
  PartyPopper,
  ListChecks,
  GitBranch,
  MessageSquare,
  CheckCircle2,
  Circle,
  LayoutList,
  Columns3,
  Loader2,
  AlertCircle,
  RefreshCw,
  X,
  Sparkles,
  Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
} from '@/components/ui/dialog'
import { EpicCreationWizard } from './EpicCreationWizard'
import type { FlowProjectContext } from '../../../shared/types'
import type { EpicSummary, FlowBridgeError } from '../../../shared/flow-schemas'

// ─── Types ──────────────────────────────────────────────────────────────────────

export type OnboardingStep = 1 | 2 | 3 | 4 | 5

export interface OnboardingWizardProps {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void
  /** Project path for IPC calls */
  projectPath: string
  /** Callback when onboarding completes (all steps or skipped forward) */
  onComplete: () => void
  /** Available epics for the EpicCreationWizard dependency selection */
  epics?: EpicSummary[]
  /** Callback when an epic is created in step 5 */
  onEpicCreated?: (epicId: string) => void
  /** Callback to open chat for complex epics */
  onOpenChat?: (epicId: string) => void
  /** Callback to set view mode preference from step 3 */
  onSetViewMode?: (mode: 'list' | 'kanban') => void
  /** Callback to refresh project status after init */
  onRefreshProject?: () => void
}

// ─── Step Metadata ──────────────────────────────────────────────────────────────

interface StepMeta {
  step: OnboardingStep
  label: string
  icon: React.ReactNode
  skippable: boolean
}

const STEPS: StepMeta[] = [
  { step: 1, label: 'Welcome', icon: <BookOpen className="size-4" />, skippable: false },
  { step: 2, label: 'Demo', icon: <MousePointerClick className="size-4" />, skippable: false },
  { step: 3, label: 'Configure', icon: <Settings className="size-4" />, skippable: true },
  { step: 4, label: 'Initialize', icon: <Terminal className="size-4" />, skippable: true },
  { step: 5, label: 'Create', icon: <PartyPopper className="size-4" />, skippable: true },
]

// ─── Constants ──────────────────────────────────────────────────────────────────

/** Delay before auto-advancing from Step 4 success to Step 5 (visual feedback) */
const STEP_4_SUCCESS_DELAY_MS = 800

// ─── Spring Animation Config ────────────────────────────────────────────────────

const springTransition = {
  type: 'spring' as const,
  stiffness: 600,
  damping: 49,
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function OnboardingWizard({
  open,
  onOpenChange,
  projectPath,
  onComplete,
  epics = [],
  onEpicCreated,
  onOpenChat,
  onSetViewMode,
  onRefreshProject,
}: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = React.useState<OnboardingStep>(1)
  const [completedSteps, setCompletedSteps] = React.useState<Set<OnboardingStep>>(new Set())
  const [projectContext, setProjectContext] = React.useState<FlowProjectContext | null>(null)
  const [contextLoading, setContextLoading] = React.useState(true)
  const [shouldReset, setShouldReset] = React.useState(false)

  // Direction for slide animation (1 = forward, -1 = backward)
  const [direction, setDirection] = React.useState(1)

  // Step 3 state: selected view mode (default: kanban as recommended)
  const [selectedViewMode, setSelectedViewMode] = React.useState<'list' | 'kanban'>('kanban')

  // Step 4 state: init progress
  const [initStatus, setInitStatus] = React.useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [initError, setInitError] = React.useState<string | null>(null)

  // Step 5 state: epic creation
  const [epicWizardOpen, setEpicWizardOpen] = React.useState<boolean>(false)
  const [createdEpic, setCreatedEpic] = React.useState<{ id: string; title: string; taskCount: number } | null>(null)

  // Ref for Step 4 auto-advance timeout cleanup
  const initTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup timeout on unmount
  React.useEffect(() => {
    return () => {
      if (initTimeoutRef.current) clearTimeout(initTimeoutRef.current)
    }
  }, [])

  // Fetch project context on mount / projectPath change
  React.useEffect(() => {
    if (!open || !projectPath) return

    let cancelled = false
    setContextLoading(true)

    window.electronAPI
      .flowReadProjectContext(projectPath)
      .then((ctx) => {
        if (!cancelled) {
          setProjectContext(ctx)
          setContextLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjectContext(null)
          setContextLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, projectPath])

  // Mark for reset when dialog closes
  React.useEffect(() => {
    if (!open) {
      setShouldReset(true)
    }
  }, [open])

  // Reset state after close animation
  const handleCloseAnimationComplete = React.useCallback(() => {
    if (shouldReset) {
      setCurrentStep(1)
      setCompletedSteps(new Set())
      setProjectContext(null)
      setContextLoading(true)
      setDirection(1)
      setSelectedViewMode('kanban')
      setInitStatus('idle')
      setInitError(null)
      setEpicWizardOpen(false)
      setCreatedEpic(null)
      setShouldReset(false)
    }
  }, [shouldReset])

  const projectName = projectContext?.name ?? 'your project'

  // Navigation
  const handleNext = React.useCallback(() => {
    setCompletedSteps((prev) => new Set([...prev, currentStep]))
    setDirection(1)

    // Apply view mode preference from step 3
    if (currentStep === 3 && onSetViewMode) {
      onSetViewMode(selectedViewMode)
    }

    if (currentStep < 5) {
      setCurrentStep((currentStep + 1) as OnboardingStep)
    } else {
      // Final step — close wizard
      setCurrentStep(1)
      setCompletedSteps(new Set())
      setDirection(1)
      onComplete()
      onOpenChange(false)
    }
  }, [currentStep, onComplete, onOpenChange, selectedViewMode, onSetViewMode])

  const handlePrev = React.useCallback(() => {
    setDirection(-1)
    // Reset step 4 init state when navigating away so re-entry can re-trigger init
    if (currentStep === 4) {
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current)
        initTimeoutRef.current = null
      }
      setInitStatus('idle')
      setInitError(null)
    }
    if (currentStep > 1) {
      setCurrentStep((currentStep - 1) as OnboardingStep)
    }
  }, [currentStep])

  const handleSkip = React.useCallback(() => {
    // Steps 1-2 are not skippable, but steps 3-5 can be skipped
    const meta = STEPS[currentStep - 1]
    if (!meta.skippable) return

    if (currentStep === 5) {
      // Skipping step 5 closes wizard without creating an epic
      setCurrentStep(1)
      setCompletedSteps(new Set())
      setDirection(1)
      onComplete()
      onOpenChange(false)
      return
    }

    handleNext()
  }, [currentStep, handleNext, onComplete, onOpenChange])

  // Step 4: Initialize flow-next
  const handleInit = React.useCallback(async () => {
    // Clear any pending timeout from a prior init attempt
    if (initTimeoutRef.current) {
      clearTimeout(initTimeoutRef.current)
      initTimeoutRef.current = null
    }

    setInitStatus('loading')
    setInitError(null)

    try {
      const result = await window.electronAPI.flowInit(projectPath)

      if (result.ok) {
        setInitStatus('success')
        // Refresh project status to update activeFlowProjectAtom
        onRefreshProject?.()
        // Auto-advance to step 5 after a brief delay for visual feedback
        initTimeoutRef.current = setTimeout(() => {
          initTimeoutRef.current = null
          setCompletedSteps((prev) => new Set([...prev, 4 as OnboardingStep]))
          setDirection(1)
          setCurrentStep(5)
        }, STEP_4_SUCCESS_DELAY_MS)
      } else {
        const error = result.error
        const errorMsg = getFlowBridgeErrorMessage(error)
        setInitStatus('error')
        setInitError(errorMsg)
      }
    } catch (err) {
      setInitStatus('error')
      setInitError(err instanceof Error ? err.message : 'An unexpected error occurred')
    }
  }, [projectPath, onRefreshProject])

  // Step 5: Handle epic created in embedded wizard
  const handleEpicCreatedInStep5 = React.useCallback((epicId: string) => {
    setEpicWizardOpen(false)

    // Fetch epic details for summary card
    window.electronAPI.flowEpicsList(projectPath)
      .then((result) => {
        if (result.ok) {
          const epic = result.data.epics.find((e: EpicSummary) => e.id === epicId)
          setCreatedEpic({
            id: epicId,
            title: epic?.title ?? epicId,
            taskCount: epic?.tasks ?? 0,
          })
        } else {
          setCreatedEpic({ id: epicId, title: epicId, taskCount: 0 })
        }
      })
      .catch(() => {
        setCreatedEpic({ id: epicId, title: epicId, taskCount: 0 })
      })

    // Fire confetti — respects prefers-reduced-motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!prefersReducedMotion) {
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.7 },
        colors: ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'],
        disableForReducedMotion: true,
      })
    }

    // Notify parent of epic creation
    onEpicCreated?.(epicId)
  }, [projectPath, onEpicCreated])

  // Step 5: "Get Started" button — close wizard and navigate to epic
  const handleGetStarted = React.useCallback(() => {
    setCurrentStep(1)
    setCompletedSteps(new Set())
    setDirection(1)
    onComplete()
    onOpenChange(false)
  }, [onComplete, onOpenChange])

  // Can navigate backward only if not on step 1
  const canGoBack = currentStep > 1

  // Steps 1-2 cannot be skipped
  const canSkip = STEPS[currentStep - 1]?.skippable ?? false

  // Determine footer button text and behavior based on step state
  const isStep4Busy = currentStep === 4 && initStatus === 'loading'
  const isStep5ShowingSummary = currentStep === 5 && createdEpic !== null

  // Hide the default Continue button when step 4 is initializing, or step 5 has its own flow
  const showDefaultContinue = currentStep !== 4 && !(currentStep === 5 && (epicWizardOpen || createdEpic))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[640px] p-0 max-h-[85vh] flex flex-col overflow-hidden"
        showCloseButton={false}
        aria-labelledby="onboarding-wizard-title"
        aria-describedby="onboarding-wizard-description"
        data-testid="onboarding-wizard"
      >
        <DialogDescription id="onboarding-wizard-description" className="sr-only">
          Onboarding wizard to set up flow-next for your project.
        </DialogDescription>

        {/* Progress Bar */}
        <div
          className="h-1 bg-foreground/5 shrink-0"
          role="progressbar"
          aria-valuenow={currentStep}
          aria-valuemin={1}
          aria-valuemax={5}
          aria-valuetext={`Step ${currentStep} of 5: ${STEPS[currentStep - 1].label}`}
          aria-label="Onboarding progress"
        >
          <motion.div
            className="h-full bg-foreground/80 rounded-r-full"
            initial={{ width: '0%' }}
            animate={{ width: `${(currentStep / STEPS.length) * 100}%` }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />
        </div>

        {/* Step Content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <AnimatePresence mode="wait" onExitComplete={handleCloseAnimationComplete}>
            {currentStep === 1 && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, x: direction * 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -30 }}
                transition={springTransition}
                role="region"
                aria-label="Welcome step"
              >
                <WelcomeStep
                  projectName={projectName}
                  projectDescription={projectContext?.description}
                  loading={contextLoading}
                />
              </motion.div>
            )}

            {currentStep === 2 && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0, x: direction * 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -30 }}
                transition={springTransition}
                role="region"
                aria-label="Interactive demo step"
              >
                <InteractiveDemoStep projectName={projectName} />
              </motion.div>
            )}

            {currentStep === 3 && (
              <motion.div
                key="step-3"
                initial={{ opacity: 0, x: direction * 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -30 }}
                transition={springTransition}
                role="region"
                aria-label="Configure step"
              >
                <ConfigureStep
                  selectedViewMode={selectedViewMode}
                  onViewModeChange={setSelectedViewMode}
                />
              </motion.div>
            )}

            {currentStep === 4 && (
              <motion.div
                key="step-4"
                initial={{ opacity: 0, x: direction * 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -30 }}
                transition={springTransition}
                role="region"
                aria-label="Initialize step"
              >
                <InitializeStep
                  projectPath={projectPath}
                  status={initStatus}
                  error={initError}
                  onInit={handleInit}
                  onRetry={handleInit}
                  onCancel={() => {
                    // Cancel skips past step 4 entirely (init deferred to later)
                    setInitStatus('idle')
                    setInitError(null)
                    setCompletedSteps((prev) => new Set([...prev, 4 as OnboardingStep]))
                    setDirection(1)
                    setCurrentStep(5)
                  }}
                />
              </motion.div>
            )}

            {currentStep === 5 && (
              <motion.div
                key="step-5"
                initial={{ opacity: 0, x: direction * 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -30 }}
                transition={springTransition}
                role="region"
                aria-label="Create epic step"
              >
                <CreateEpicStep
                  createdEpic={createdEpic}
                  onOpenEpicWizard={() => setEpicWizardOpen(true)}
                  onGetStarted={handleGetStarted}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer: Step Indicator + Navigation */}
        <div className="shrink-0 border-t border-border/50 px-8 py-4 flex items-center justify-between bg-foreground/[0.02]">
          {/* Step Indicator Dots */}
          <div className="flex items-center gap-2">
            {STEPS.map((meta) => {
              const isActive = meta.step === currentStep
              const isCompleted = completedSteps.has(meta.step)
              return (
                <div
                  key={meta.step}
                  className={cn(
                    'flex items-center gap-1.5 text-xs transition-colors',
                    isActive
                      ? 'text-foreground font-medium'
                      : isCompleted
                        ? 'text-foreground/50'
                        : 'text-foreground/25'
                  )}
                  aria-current={isActive ? 'step' : undefined}
                >
                  <div
                    className={cn(
                      'size-2 rounded-full transition-all',
                      isActive
                        ? 'bg-foreground scale-125'
                        : isCompleted
                          ? 'bg-foreground/50'
                          : 'bg-foreground/20'
                    )}
                  />
                  <span className="hidden sm:inline">{meta.label}</span>
                </div>
              )
            })}
          </div>

          {/* Navigation Buttons */}
          <div className="flex items-center gap-2">
            {canSkip && !isStep4Busy && !isStep5ShowingSummary && (
              <button
                onClick={handleSkip}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
                data-testid="onboarding-skip-button"
              >
                Skip
              </button>
            )}
            {canGoBack && !isStep4Busy && !isStep5ShowingSummary && (
              <button
                onClick={handlePrev}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  'text-foreground/70 hover:text-foreground hover:bg-foreground/5',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                )}
                data-testid="onboarding-prev-button"
              >
                <ArrowLeft className="size-3.5" />
                Back
              </button>
            )}
            {showDefaultContinue && (
              <button
                onClick={handleNext}
                className={cn(
                  'flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium transition-all',
                  'bg-foreground text-background hover:bg-foreground/90',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                )}
                data-testid="onboarding-next-button"
              >
                {currentStep === 5 ? 'Finish' : 'Continue'}
                {currentStep < 5 && <ArrowRight className="size-3.5" />}
              </button>
            )}
          </div>
        </div>

        {/* Embedded Epic Creation Wizard (Step 5) */}
        <EpicCreationWizard
          open={epicWizardOpen}
          onOpenChange={setEpicWizardOpen}
          workspaceRoot={projectPath}
          epics={epics}
          onEpicCreated={handleEpicCreatedInStep5}
          onOpenChat={onOpenChat}
        />
      </DialogContent>
    </Dialog>
  )
}

// ─── Step 1: Welcome ────────────────────────────────────────────────────────────

interface WelcomeStepProps {
  projectName: string
  projectDescription?: string
  loading: boolean
}

function WelcomeStep({ projectName, projectDescription, loading }: WelcomeStepProps) {
  const methodologySteps = [
    {
      icon: <ListChecks className="size-5 text-blue-500" />,
      title: 'Plan',
      description: 'Create epics and break them into tasks with AI-assisted planning.',
      bgClass: 'bg-blue-500/10',
    },
    {
      icon: <GitBranch className="size-5 text-emerald-500" />,
      title: 'Work',
      description: 'Implement tasks one at a time with focused, trackable progress.',
      bgClass: 'bg-emerald-500/10',
    },
    {
      icon: <MessageSquare className="size-5 text-violet-500" />,
      title: 'Review',
      description: 'AI-assisted code review ensures quality before completion.',
      bgClass: 'bg-violet-500/10',
    },
  ]

  return (
    <div className="flex flex-col items-center" data-testid="onboarding-step-welcome">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2.5 rounded-xl bg-foreground/5">
          <Rocket className="size-6 text-foreground/80" />
        </div>
      </div>

      <h2
        id="onboarding-wizard-title"
        className="text-xl font-semibold text-center"
      >
        {loading ? (
          <span className="text-muted-foreground">Loading...</span>
        ) : (
          <>Set up flow-next for <span className="text-foreground">{projectName}</span></>
        )}
      </h2>

      {projectDescription && !loading && (
        <p className="text-sm text-muted-foreground text-center mt-1.5 max-w-md line-clamp-2">
          {projectDescription}
        </p>
      )}

      <p className="text-sm text-muted-foreground text-center mt-3 max-w-md">
        Flow-next brings structured, AI-assisted task management directly into your development workflow.
      </p>

      {/* Methodology Cards */}
      <div className="w-full mt-6 space-y-3">
        {methodologySteps.map((step) => (
          <div
            key={step.title}
            className="flex items-start gap-4 rounded-xl p-4 bg-foreground/[0.02] shadow-minimal"
          >
            <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', step.bgClass)}>
              {step.icon}
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-medium text-sm">{step.title}</span>
              <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Step 2: Interactive Demo ───────────────────────────────────────────────────

interface InteractiveDemoStepProps {
  projectName: string
}

// Demo workflow phases
type DemoPhase = 'plan' | 'work' | 'review' | 'done'

const DEMO_PHASES: { id: DemoPhase; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'plan', label: 'Plan', icon: <ListChecks className="size-4" />, color: 'text-blue-500' },
  { id: 'work', label: 'Work', icon: <GitBranch className="size-4" />, color: 'text-emerald-500' },
  { id: 'review', label: 'Review', icon: <MessageSquare className="size-4" />, color: 'text-violet-500' },
  { id: 'done', label: 'Done', icon: <CheckCircle2 className="size-4" />, color: 'text-amber-500' },
]

function InteractiveDemoStep({ projectName }: InteractiveDemoStepProps) {
  const [activePhase, setActivePhase] = React.useState<DemoPhase>('plan')

  // Sample data for the demo — adjust wording if using fallback project name
  const sampleEpic = projectName === 'your project'
    ? 'Add user authentication'
    : `Add authentication to ${projectName}`
  const sampleTasks = [
    { id: 1, title: 'Set up auth provider', status: 'done' as const },
    { id: 2, title: 'Create login page', status: 'in-progress' as const },
    { id: 3, title: 'Add session management', status: 'todo' as const },
    { id: 4, title: 'Write integration tests', status: 'todo' as const },
  ]

  const phaseContent: Record<DemoPhase, { title: string; description: string; highlight: string }> = {
    plan: {
      title: 'Create an Epic',
      description: `Start by describing what you want to build. AI breaks "${sampleEpic}" into actionable tasks.`,
      highlight: 'epic',
    },
    work: {
      title: 'Work Through Tasks',
      description: 'Pick up tasks one at a time. Each task has clear scope and acceptance criteria.',
      highlight: 'tasks',
    },
    review: {
      title: 'AI-Assisted Review',
      description: 'When a task is complete, AI reviews the implementation for quality and correctness.',
      highlight: 'review',
    },
    done: {
      title: 'Ship with Confidence',
      description: 'Every task is reviewed, every epic is tracked. Ship features with a clear audit trail.',
      highlight: 'done',
    },
  }

  const content = phaseContent[activePhase]

  return (
    <div className="flex flex-col" data-testid="onboarding-step-demo">
      {/* Header */}
      <div className="text-center mb-5">
        <h2 className="text-lg font-semibold">See How It Works</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Click each phase to explore the workflow
        </p>
      </div>

      {/* Phase Selector */}
      <div className="flex items-center justify-center gap-1 mb-5">
        {DEMO_PHASES.map((phase, idx) => {
          const isActive = phase.id === activePhase
          return (
            <React.Fragment key={phase.id}>
              {idx > 0 && (
                <div className="w-6 h-px bg-foreground/10 mx-0.5" />
              )}
              <button
                onClick={() => setActivePhase(phase.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'bg-foreground/10 text-foreground shadow-minimal'
                    : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
                )}
                data-testid={`demo-phase-${phase.id}`}
              >
                <span className={cn(isActive ? phase.color : '')}>{phase.icon}</span>
                {phase.label}
              </button>
            </React.Fragment>
          )
        })}
      </div>

      {/* Phase Description */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activePhase}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="text-center mb-5"
        >
          <h3 className="text-sm font-semibold">{content.title}</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{content.description}</p>
        </motion.div>
      </AnimatePresence>

      {/* Mock Board Visualization */}
      <div className="rounded-xl border border-border/50 bg-foreground/[0.01] overflow-hidden">
        {/* Mock header */}
        <div className="px-4 py-2.5 border-b border-border/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-blue-500" />
            <span className="text-xs font-medium truncate max-w-[200px]">{sampleEpic}</span>
          </div>
          <span className="text-[10px] text-muted-foreground">4 tasks</span>
        </div>

        {/* Mock task list */}
        <div className="p-3 space-y-2">
          {sampleTasks.map((task) => {
            const isHighlighted =
              (content.highlight === 'epic') ||
              (content.highlight === 'tasks' && task.status === 'in-progress') ||
              (content.highlight === 'review' && task.status === 'done') ||
              (content.highlight === 'done' && task.status === 'done')

            return (
              <motion.div
                key={task.id}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-all',
                  isHighlighted
                    ? 'bg-foreground/5 ring-1 ring-foreground/10'
                    : 'bg-transparent'
                )}
                animate={{
                  scale: isHighlighted ? 1.01 : 1,
                  opacity: isHighlighted ? 1 : 0.5,
                }}
                transition={{ duration: 0.2 }}
              >
                {/* Status Indicator */}
                {task.status === 'done' ? (
                  <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                ) : task.status === 'in-progress' ? (
                  <motion.div
                    className="size-3.5 rounded-full border-2 border-blue-500 border-t-transparent shrink-0"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                  />
                ) : (
                  <Circle className="size-3.5 text-foreground/20 shrink-0" />
                )}

                <span className={cn(
                  'flex-1',
                  task.status === 'done' ? 'line-through text-muted-foreground' : 'text-foreground'
                )}>
                  {task.title}
                </span>

                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded',
                  task.status === 'done'
                    ? 'bg-emerald-500/10 text-emerald-600'
                    : task.status === 'in-progress'
                      ? 'bg-blue-500/10 text-blue-600'
                      : 'bg-foreground/5 text-muted-foreground'
                )}>
                  {task.status === 'in-progress' ? 'in progress' : task.status}
                </span>
              </motion.div>
            )
          })}
        </div>

        {/* Review indicator for 'review' phase */}
        {activePhase === 'review' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 py-2.5 border-t border-border/50 bg-violet-500/5"
          >
            <div className="flex items-center gap-2 text-xs text-violet-600">
              <MessageSquare className="size-3.5" />
              <span>AI reviewing &ldquo;Set up auth provider&rdquo;...</span>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}

// ─── Step 3: Configure ──────────────────────────────────────────────────────────

interface ConfigureStepProps {
  selectedViewMode: 'list' | 'kanban'
  onViewModeChange: (mode: 'list' | 'kanban') => void
}

function ConfigureStep({ selectedViewMode, onViewModeChange }: ConfigureStepProps) {
  const viewModeOptions = [
    {
      id: 'kanban' as const,
      label: 'Kanban Board',
      description: 'Visual columns for each task status. Great for tracking progress at a glance.',
      icon: <Columns3 className="size-5" />,
      recommended: true,
    },
    {
      id: 'list' as const,
      label: 'List View',
      description: 'Compact table layout with sortable columns. Best for detailed task management.',
      icon: <LayoutList className="size-5" />,
      recommended: false,
    },
  ]

  return (
    <div className="flex flex-col items-center" data-testid="onboarding-step-configure">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2.5 rounded-xl bg-foreground/5">
          <Settings className="size-6 text-foreground/80" />
        </div>
      </div>

      <h2 className="text-lg font-semibold text-center">Configure Preferences</h2>
      <p className="text-sm text-muted-foreground text-center mt-1.5 max-w-md">
        Choose your default view mode for epic task boards. You can always change this later.
      </p>

      {/* View Mode Selection */}
      <div className="w-full mt-6 space-y-3" role="radiogroup" aria-label="Default view mode">
        {viewModeOptions.map((option) => {
          const isSelected = option.id === selectedViewMode
          return (
            <button
              key={option.id}
              onClick={() => onViewModeChange(option.id)}
              role="radio"
              aria-checked={isSelected}
              data-testid={`view-mode-option-${option.id}`}
              className={cn(
                'flex w-full items-start gap-4 rounded-xl p-4 text-left transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'hover:bg-foreground/[0.02] shadow-minimal',
                isSelected ? 'bg-background ring-1 ring-foreground/10' : 'bg-foreground/[0.01]'
              )}
            >
              {/* Icon */}
              <div className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-lg',
                isSelected ? 'bg-foreground/10 text-foreground' : 'bg-foreground/5 text-foreground/50'
              )}>
                {option.icon}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{option.label}</span>
                  {option.recommended && (
                    <span className="rounded-[4px] bg-background shadow-minimal px-2 py-0.5 text-[11px] font-medium text-foreground/70">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
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
    </div>
  )
}

// ─── Step 4: Initialize ─────────────────────────────────────────────────────────

interface InitializeStepProps {
  projectPath: string
  status: 'idle' | 'loading' | 'success' | 'error'
  error: string | null
  onInit: () => void
  onRetry: () => void
  onCancel: () => void
}

function InitializeStep({ projectPath, status, error, onInit, onRetry, onCancel }: InitializeStepProps) {
  // Auto-start init on mount if idle
  React.useEffect(() => {
    if (status === 'idle') {
      onInit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dirName = projectPath.split('/').pop() ?? projectPath

  return (
    <div className="flex flex-col items-center" data-testid="onboarding-step-initialize">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2.5 rounded-xl bg-foreground/5">
          <Terminal className="size-6 text-foreground/80" />
        </div>
      </div>

      <h2 className="text-lg font-semibold text-center">Initialize Flow-Next</h2>
      <p className="text-sm text-muted-foreground text-center mt-1.5 max-w-md">
        Setting up the <code className="text-xs bg-foreground/5 px-1 py-0.5 rounded">.flow/</code> directory in{' '}
        <span className="font-medium text-foreground">{dirName}</span>
      </p>

      {/* Status Display */}
      <div className="w-full mt-8">
        {status === 'loading' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-4 py-8"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            >
              <Loader2 className="size-8 text-foreground/60" />
            </motion.div>
            <div className="text-center">
              <p className="text-sm font-medium">Initializing...</p>
              <p className="text-xs text-muted-foreground mt-1">
                Running <code className="bg-foreground/5 px-1 py-0.5 rounded">flowctl init</code>
              </p>
            </div>
          </motion.div>
        )}

        {status === 'success' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-4 py-8"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 15 }}
              className="flex size-12 items-center justify-center rounded-full bg-emerald-500/10"
            >
              <CheckCircle2 className="size-6 text-emerald-500" />
            </motion.div>
            <div className="text-center">
              <p className="text-sm font-medium">Flow-next initialized</p>
              <p className="text-xs text-muted-foreground mt-1">
                The <code className="bg-foreground/5 px-1 py-0.5 rounded">.flow/</code> directory has been created.
              </p>
            </div>
          </motion.div>
        )}

        {status === 'error' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-4"
          >
            <div className="flex size-12 items-center justify-center rounded-full bg-red-500/10">
              <AlertCircle className="size-6 text-red-500" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-red-600">Initialization failed</p>
            </div>

            {/* Error details */}
            {error && (
              <div className="w-full rounded-lg border border-red-200/50 bg-red-500/5 p-4">
                <p className="text-xs text-red-600 font-mono whitespace-pre-wrap break-all">{error}</p>
              </div>
            )}

            {/* Troubleshooting */}
            <div className="w-full rounded-lg border border-border/50 bg-foreground/[0.01] p-4">
              <p className="text-xs font-medium mb-2">Troubleshooting</p>
              <ul className="text-xs text-muted-foreground space-y-1.5">
                <li className="flex items-start gap-2">
                  <span className="text-foreground/40 mt-0.5">1.</span>
                  Ensure you have write permissions to the project directory.
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-foreground/40 mt-0.5">2.</span>
                  Check that no other process is locking the directory.
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-foreground/40 mt-0.5">3.</span>
                  Verify that <code className="bg-foreground/5 px-1 py-0.5 rounded">flowctl</code> is available in <code className="bg-foreground/5 px-1 py-0.5 rounded">.flow/bin/</code>.
                </li>
              </ul>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3">
              <button
                onClick={onCancel}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  'text-foreground/70 hover:text-foreground hover:bg-foreground/5',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                )}
                data-testid="init-cancel-button"
              >
                <X className="size-3.5" />
                Cancel
              </button>
              <button
                onClick={onRetry}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  'bg-foreground text-background hover:bg-foreground/90',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                )}
                data-testid="init-retry-button"
              >
                <RefreshCw className="size-3.5" />
                Retry
              </button>
            </div>
          </motion.div>
        )}

        {status === 'idle' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-sm text-muted-foreground">Ready to initialize.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Step 5: Create Epic + Celebrate ────────────────────────────────────────────

interface CreateEpicStepProps {
  createdEpic: { id: string; title: string; taskCount: number } | null
  onOpenEpicWizard: () => void
  onGetStarted: () => void
}

function CreateEpicStep({ createdEpic, onOpenEpicWizard, onGetStarted }: CreateEpicStepProps) {
  if (createdEpic) {
    // Success state: show summary card + Get Started button
    return (
      <div className="flex flex-col items-center" data-testid="onboarding-step-celebrate">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.1 }}
          className="p-3 rounded-xl bg-emerald-500/10 mb-4"
        >
          <Sparkles className="size-6 text-emerald-500" />
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-lg font-semibold text-center"
        >
          You&apos;re all set!
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-sm text-muted-foreground text-center mt-1.5 max-w-md"
        >
          Your first epic has been created. Start working through tasks to ship your feature.
        </motion.p>

        {/* Summary Card */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="w-full mt-6 rounded-xl border border-border/50 bg-foreground/[0.02] p-5 shadow-minimal"
        >
          <div className="flex items-start gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
              <ListChecks className="size-5 text-blue-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{createdEpic.title}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {createdEpic.taskCount > 0
                  ? `${createdEpic.taskCount} task${createdEpic.taskCount === 1 ? '' : 's'} created`
                  : 'Run /plan in the chat to generate tasks'}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Get Started Button */}
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          onClick={onGetStarted}
          className={cn(
            'mt-6 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium text-sm transition-all',
            'bg-foreground text-background hover:bg-foreground/90',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
          data-testid="onboarding-get-started-button"
        >
          Get Started
          <ArrowRight className="size-4" />
        </motion.button>
      </div>
    )
  }

  // Default state: prompt to create an epic
  return (
    <div className="flex flex-col items-center" data-testid="onboarding-step-create-epic">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2.5 rounded-xl bg-foreground/5">
          <PartyPopper className="size-6 text-foreground/80" />
        </div>
      </div>

      <h2 className="text-lg font-semibold text-center">Create Your First Epic</h2>
      <p className="text-sm text-muted-foreground text-center mt-1.5 max-w-md">
        An epic is a feature or project broken into tasks. Create one now to see flow-next in action.
      </p>

      {/* Create Epic Button */}
      <button
        onClick={onOpenEpicWizard}
        className={cn(
          'mt-8 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-sm transition-all',
          'bg-foreground text-background hover:bg-foreground/90',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        )}
        data-testid="onboarding-create-epic-button"
      >
        <Sparkles className="size-4" />
        Create Epic
      </button>

      <p className="text-xs text-muted-foreground text-center mt-3">
        Choose from Quick, Standard, or Complex templates.
      </p>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

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
