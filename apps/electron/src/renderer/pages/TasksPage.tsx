/**
 * TasksPage - Main content panel for Tasks navigator
 *
 * Displays tab-based multi-epic navigation with adaptive view selection.
 * Features:
 * - Tab bar for multiple open epics
 * - Auto-selects best view (list/kanban/graph) based on epic state
 * - User can override view with segmented control
 * - Persists tab and view state across sessions
 * - Epic creation wizard (Quick/Standard/Complex templates)
 * - Onboarding wizard for new projects (when flowStatus === 'needs-setup')
 * - Brief welcome banner for cloned repos (has .flow/, no ui-state.json yet)
 * - Polished empty state when no projects are registered
 * - .flow/ deletion detection with re-init prompt
 * - OS notifications for task events
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useNavigationState } from '@/contexts/NavigationContext'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { TasksMainContent } from '@/components/tasks/TasksMainContent'
import { EpicCreationWizard } from '@/components/tasks/EpicCreationWizard'
import { OnboardingWizard } from '@/components/tasks/OnboardingWizard'
import { WelcomeBanner } from '@/components/tasks/WelcomeBanner'
import { NoProjectsEmptyState } from '@/components/tasks/NoProjectsEmptyState'
import { FlowDeletedBanner } from '@/components/tasks/FlowDeletedBanner'
import {
  useFlowNotifications,
  useTaskCompletionNotifications,
  useEpicReviewReadyNotifications,
} from '@/hooks/useFlowNotifications'
import {
  epicsAtom,
  activeTabAtom,
  openEpicTabAtom,
  epicWizardOpenAtom,
  activeFlowProjectAtom,
  registeredFlowProjectsAtom,
  setViewModeAtom,
  setActiveFlowProjectAtom,
  initFlowAtom,
  welcomeDismissedAtom,
  dismissWelcomeBannerAtom,
} from '@/atoms/tasks-state'
import { navigate, routes } from '@/lib/navigate'

export function TasksPage() {
  const navState = useNavigationState()
  const workspace = useActiveWorkspace()
  const epics = useAtomValue(epicsAtom)
  const activeEpicId = useAtomValue(activeTabAtom)
  const openEpicTab = useSetAtom(openEpicTabAtom)
  const registeredProjects = useAtomValue(registeredFlowProjectsAtom)

  // Project path for flow-next (where .flow/ lives) — derived from activeFlowProjectAtom.
  // Falls back to workspace.rootPath if no active flow project is set.
  const activeFlowProject = useAtomValue(activeFlowProjectAtom)
  const projectPath = activeFlowProject.path ?? workspace?.rootPath ?? null

  const workspaceRoot = projectPath
  const workspaceId = workspace?.id ?? null

  // Wizard dialog state - using atom so it can be triggered from AppShell header too
  const [wizardOpen, setWizardOpen] = useAtom(epicWizardOpenAtom)

  // Action atoms for onboarding wizard callbacks
  const setViewMode = useSetAtom(setViewModeAtom)
  const setActiveProject = useSetAtom(setActiveFlowProjectAtom)
  const initFlow = useSetAtom(initFlowAtom)

  // Welcome banner state
  const welcomeDismissed = useAtomValue(welcomeDismissedAtom)
  const dismissWelcomeBanner = useSetAtom(dismissWelcomeBannerAtom)

  // Onboarding wizard state — show when project needs setup
  const showOnboardingWizard = activeFlowProject.flowStatus === 'needs-setup' && !!projectPath
  const [onboardingDismissed, setOnboardingDismissed] = React.useState(false)

  // .flow/ deletion detection: track previous flowStatus to detect transitions
  // from 'initialized' → 'needs-setup' (indicating .flow/ was removed).
  const prevFlowStatusRef = React.useRef(activeFlowProject.flowStatus)
  const [flowDeleted, setFlowDeleted] = React.useState(false)
  const [isReinitializing, setIsReinitializing] = React.useState(false)

  React.useEffect(() => {
    const prevStatus = prevFlowStatusRef.current
    const currentStatus = activeFlowProject.flowStatus

    // Detect .flow/ deletion: was initialized, now needs-setup
    if (prevStatus === 'initialized' && currentStatus === 'needs-setup') {
      setFlowDeleted(true)
    }

    // Reset when project becomes initialized again (after re-init)
    if (currentStatus === 'initialized') {
      setFlowDeleted(false)
      setIsReinitializing(false)
    }

    prevFlowStatusRef.current = currentStatus
  }, [activeFlowProject.flowStatus])

  // Reset .flow/ deleted state when switching projects
  React.useEffect(() => {
    setFlowDeleted(false)
    setIsReinitializing(false)
    prevFlowStatusRef.current = activeFlowProject.flowStatus
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on path change only; flowStatus read is intentional for ref sync
  }, [activeFlowProject.path])

  // Project name for welcome banner — derived from registered project or basename
  const projectName = React.useMemo(() => {
    if (!projectPath) return 'Project'
    const registered = registeredProjects.find(p => p.path === projectPath)
    if (registered?.name) return registered.name
    // Fallback: directory basename
    const segments = projectPath.replace(/\\/g, '/').split('/')
    return segments[segments.length - 1] || 'Project'
  }, [projectPath, registeredProjects])

  // Show welcome banner: project is initialized, not yet dismissed, and has epics
  const showWelcomeBanner =
    activeFlowProject.flowStatus === 'initialized' &&
    !welcomeDismissed &&
    epics.length > 0

  // Flow notifications setup
  const { requestNotification } = useFlowNotifications({
    onNavigateToEpic: React.useCallback((epicId: string) => {
      openEpicTab(epicId)
    }, [openEpicTab]),
    onNavigateToTask: React.useCallback((epicId: string, taskId: string) => {
      openEpicTab(epicId)
      // Task detail navigation handled by TasksMainContent
    }, [openEpicTab]),
    enabled: !!workspaceId,
  })

  // Task completion notifications - watch active epic for task completions
  useTaskCompletionNotifications(
    workspaceId,
    activeEpicId,
    React.useCallback((taskId: string, taskTitle: string) => {
      if (!workspaceId || !activeEpicId) return
      requestNotification({
        type: 'task_completed',
        title: 'Task Completed',
        body: taskTitle,
        workspaceId,
        epicId: activeEpicId,
        taskId,
        priority: 'low',
      })
    }, [workspaceId, activeEpicId, requestNotification])
  )

  // Epic review ready notifications - watch for all tasks done
  useEpicReviewReadyNotifications(
    workspaceId,
    activeEpicId,
    React.useCallback((epicId: string, epicTitle: string) => {
      if (!workspaceId) return
      requestNotification({
        type: 'epic_review_ready',
        title: 'Epic Ready for Review',
        body: `All tasks complete: ${epicTitle}`,
        workspaceId,
        epicId,
        priority: 'low',
      })
    }, [workspaceId, requestNotification])
  )

  // Handle task click - could open detail panel (task 7)
  const handleTaskClick = React.useCallback((epicId: string, taskId: string) => {
    console.log('[TasksPage] Task clicked:', { epicId, taskId })
    // Task detail panel is implemented in task 7
  }, [])

  // Handle add tab click - opens epic creation wizard
  const handleAddTab = React.useCallback(() => {
    setWizardOpen(true)
  }, [])

  // Handle epic created - navigate to the new epic
  const handleEpicCreated = React.useCallback((epicId: string) => {
    // Open the new epic in a tab and navigate to it
    openEpicTab(epicId)
    navigate(routes.view.epicDetail(epicId))
  }, [openEpicTab])

  // Handle opening split-view chat (for complex epics - task 10)
  const handleOpenChat = React.useCallback((epicId: string) => {
    console.log('[TasksPage] Opening chat for epic:', epicId)
    // Split-view chat will be implemented in task 10
  }, [])

  // Handle onboarding wizard completion
  const handleOnboardingComplete = React.useCallback(() => {
    setOnboardingDismissed(true)
  }, [])

  // Stores the user's view mode preference from onboarding step 3.
  // Applied to the newly created epic in handleOnboardingEpicCreated.
  const onboardingViewModeRef = React.useRef<'list' | 'kanban'>('kanban')

  // Handle view mode selection from onboarding step 3
  const handleOnboardingSetViewMode = React.useCallback((mode: 'list' | 'kanban') => {
    // Store the preference for application when an epic is created in step 5.
    // During onboarding there is no active epic yet, so we defer the setViewMode call.
    onboardingViewModeRef.current = mode
  }, [])

  // Handle project refresh after flow-next init (onboarding step 4)
  const handleRefreshProject = React.useCallback(() => {
    if (projectPath) {
      setActiveProject(projectPath)
    }
  }, [projectPath, setActiveProject])

  // Handle epic created from onboarding step 5 — navigate to selected view
  const handleOnboardingEpicCreated = React.useCallback((epicId: string) => {
    openEpicTab(epicId)
    // Apply the view mode preference from onboarding step 3 (default: kanban)
    setViewMode(epicId, onboardingViewModeRef.current)
    navigate(routes.view.epicDetail(epicId))
  }, [openEpicTab, setViewMode])

  // Handle .flow/ re-initialization from deleted banner
  const handleReinitialize = React.useCallback(async () => {
    if (!workspaceRoot) return
    setIsReinitializing(true)
    try {
      await initFlow(workspaceRoot)
      // Refresh project status to pick up the re-created .flow/
      setActiveProject(workspaceRoot)
    } catch {
      setIsReinitializing(false)
    }
  }, [workspaceRoot, initFlow, setActiveProject])

  // No projects registered — show polished empty state
  if (registeredProjects.length === 0 && !workspaceRoot) {
    return <NoProjectsEmptyState className="h-full" />
  }

  if (!workspaceRoot) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">No workspace selected</p>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col h-full">
        {/* .flow/ deleted banner */}
        {flowDeleted && (
          <div className="px-4 pt-3">
            <FlowDeletedBanner
              onReinitialize={handleReinitialize}
              onDismiss={() => setFlowDeleted(false)}
              isReinitializing={isReinitializing}
            />
          </div>
        )}

        {/* Welcome banner for first-time cloned repo opens */}
        {showWelcomeBanner && !flowDeleted && (
          <div className="px-4 pt-3">
            <WelcomeBanner
              projectName={projectName}
              epics={epics}
              onDismiss={dismissWelcomeBanner}
            />
          </div>
        )}

        {/* Main content area */}
        <TasksMainContent
          workspaceRoot={workspaceRoot}
          onTaskClick={handleTaskClick}
          onAddTab={handleAddTab}
          className="flex-1 min-h-0"
        />
      </div>

      {/* Epic Creation Wizard */}
      <EpicCreationWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        workspaceRoot={workspaceRoot}
        epics={epics}
        onEpicCreated={handleEpicCreated}
        onOpenChat={handleOpenChat}
      />

      {/* Onboarding Wizard — shown when project needs setup */}
      <OnboardingWizard
        open={showOnboardingWizard && !onboardingDismissed}
        onOpenChange={(open) => {
          if (!open) setOnboardingDismissed(true)
        }}
        projectPath={workspaceRoot}
        onComplete={handleOnboardingComplete}
        epics={epics}
        onEpicCreated={handleOnboardingEpicCreated}
        onOpenChat={handleOpenChat}
        onSetViewMode={handleOnboardingSetViewMode}
        onRefreshProject={handleRefreshProject}
      />
    </>
  )
}
