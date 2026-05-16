/**
 * useFlowNotifications
 *
 * Renderer-side hook for flow notification events.
 * Handles navigation when user clicks OS notifications.
 *
 * Features:
 * - Subscribes to flow:notification-navigate IPC events
 * - Provides callbacks for task/epic navigation
 * - Tracks window focus state for notification decisions
 */

import { useEffect, useCallback, useRef } from 'react'
import { useAtomValue } from 'jotai'
import { epicsAtom, tasksAtomFamily } from '@/atoms/tasks-state'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type FlowNotificationType =
  | 'task_completed'
  | 'epic_review_ready'
  | 'flowctl_error'

export interface FlowNotificationNavigateEvent {
  type: FlowNotificationType
  epicId?: string
  taskId?: string
}

export interface UseFlowNotificationsOptions {
  /** Callback when user should navigate to an epic */
  onNavigateToEpic?: (epicId: string) => void
  /** Callback when user should navigate to a task */
  onNavigateToTask?: (epicId: string, taskId: string) => void
  /** Whether notifications are enabled */
  enabled?: boolean
}

export interface UseFlowNotificationsResult {
  /** Request a notification from main process */
  requestNotification: (params: RequestNotificationParams) => void
}

export interface RequestNotificationParams {
  type: FlowNotificationType
  title: string
  body: string
  workspaceId: string
  epicId?: string
  taskId?: string
  priority?: 'high' | 'low'
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useFlowNotifications({
  onNavigateToEpic,
  onNavigateToTask,
  enabled = true,
}: UseFlowNotificationsOptions = {}): UseFlowNotificationsResult {
  // Keep refs to avoid stale closures
  const onNavigateToEpicRef = useRef(onNavigateToEpic)
  const onNavigateToTaskRef = useRef(onNavigateToTask)

  useEffect(() => {
    onNavigateToEpicRef.current = onNavigateToEpic
    onNavigateToTaskRef.current = onNavigateToTask
  }, [onNavigateToEpic, onNavigateToTask])

  // Subscribe to flow notification navigation events
  useEffect(() => {
    if (!enabled) return

    const handleNavigate = (event: FlowNotificationNavigateEvent) => {
      console.log('[useFlowNotifications] Navigate event:', event)

      if (event.taskId && event.epicId) {
        onNavigateToTaskRef.current?.(event.epicId, event.taskId)
      } else if (event.epicId) {
        onNavigateToEpicRef.current?.(event.epicId)
      }
    }

    // Subscribe to IPC event from main process
    const cleanup = window.electronAPI.onFlowNotificationNavigate?.(handleNavigate)

    return () => {
      cleanup?.()
    }
  }, [enabled])

  // Request a notification from main process
  const requestNotification = useCallback((params: RequestNotificationParams) => {
    if (!enabled) return

    // Use IPC to request notification from main process
    window.electronAPI.showFlowNotification?.(params)
  }, [enabled])

  return { requestNotification }
}

// ─── Task Completion Detection Hook ────────────────────────────────────────────

/**
 * Hook to detect when tasks are completed and trigger notifications.
 * Watches task status changes and notifies when a task transitions to 'done'.
 */
export function useTaskCompletionNotifications(
  workspaceId: string | null,
  epicId: string | null,
  onTaskCompleted?: (taskId: string, taskTitle: string) => void
): void {
  const tasks = useAtomValue(epicId ? tasksAtomFamily(epicId) : tasksAtomFamily(''))
  const previousTasksRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    if (!epicId || !workspaceId) {
      previousTasksRef.current.clear()
      return
    }

    const previousStatuses = previousTasksRef.current
    const currentStatuses = new Map(tasks.map(t => [t.id, t.status]))

    // Check for tasks that transitioned to 'done'
    for (const task of tasks) {
      const previousStatus = previousStatuses.get(task.id)
      if (previousStatus && previousStatus !== 'done' && task.status === 'done') {
        onTaskCompleted?.(task.id, task.title)
      }
    }

    // Update previous statuses
    previousTasksRef.current = currentStatuses
  }, [tasks, epicId, workspaceId, onTaskCompleted])
}

// ─── Epic Review Ready Detection Hook ──────────────────────────────────────────

/**
 * Hook to detect when all tasks in an epic are done.
 * Triggers notification when epic becomes ready for review.
 */
export function useEpicReviewReadyNotifications(
  workspaceId: string | null,
  epicId: string | null,
  onEpicReviewReady?: (epicId: string, epicTitle: string) => void
): void {
  const epics = useAtomValue(epicsAtom)
  const tasks = useAtomValue(epicId ? tasksAtomFamily(epicId) : tasksAtomFamily(''))
  const wasAllDoneRef = useRef(false)

  useEffect(() => {
    if (!epicId || !workspaceId) {
      wasAllDoneRef.current = false
      return
    }

    const epic = epics.find(e => e.id === epicId)
    if (!epic) return

    const totalTasks = tasks.length
    const doneTasks = tasks.filter(t => t.status === 'done').length
    const isAllDone = totalTasks > 0 && doneTasks === totalTasks

    // Check if we just transitioned to all done
    if (isAllDone && !wasAllDoneRef.current) {
      onEpicReviewReady?.(epicId, epic.title)
    }

    wasAllDoneRef.current = isAllDone
  }, [tasks, epics, epicId, workspaceId, onEpicReviewReady])
}
