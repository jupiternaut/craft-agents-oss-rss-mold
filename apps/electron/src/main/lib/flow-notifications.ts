/**
 * Flow Notifications
 *
 * OS notification integration for flow-next task events.
 * Extends the existing notification system with flow-specific events.
 *
 * Events:
 * - Task completed (by agent)
 * - Epic review ready (all tasks done)
 * - flowctl error requiring attention
 *
 * Features:
 * - Only notify when window is not focused
 * - silent: true for low-priority (task updates)
 * - Sound for errors
 * - Click navigates to relevant task/epic
 */

import { Notification, BrowserWindow } from 'electron'
import { mainLog } from '../logger'
import type { WindowManager } from '../window-manager'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type FlowNotificationType =
  | 'task_completed'
  | 'epic_review_ready'
  | 'flowctl_error'

export interface FlowNotificationPayload {
  type: FlowNotificationType
  title: string
  body: string
  /** Workspace ID for navigation */
  workspaceId: string
  /** Epic ID for navigation */
  epicId?: string
  /** Task ID for navigation */
  taskId?: string
  /** Priority: high = sound, low = silent */
  priority?: 'high' | 'low'
}

// ─── State ─────────────────────────────────────────────────────────────────────

let windowManager: WindowManager | null = null

/**
 * Initialize flow notifications with window manager reference.
 * Call this during app startup after initNotificationService.
 */
export function initFlowNotifications(wm: WindowManager): void {
  windowManager = wm
  mainLog.info('[FlowNotifications] Initialized')
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Check if the window for a workspace is currently focused.
 * Returns true if focused (should not show notification).
 */
function isWindowFocused(workspaceId: string): boolean {
  if (!windowManager) return false

  const window = windowManager.getWindowByWorkspace(workspaceId)
  if (!window || window.isDestroyed()) return false

  return window.isFocused()
}

/**
 * Get or create a window for a workspace.
 */
function getOrCreateWindow(workspaceId: string): BrowserWindow | null {
  if (!windowManager) return null

  let window = windowManager.getWindowByWorkspace(workspaceId)
  if (!window || window.isDestroyed()) {
    windowManager.createWindow({ workspaceId })
    window = windowManager.getWindowByWorkspace(workspaceId)
  }

  return window && !window.isDestroyed() ? window : null
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Show a flow notification if the window is not focused.
 *
 * @param payload - Notification payload with type, title, body, and navigation info
 * @returns true if notification was shown, false if skipped (window focused)
 */
export function showFlowNotification(payload: FlowNotificationPayload): boolean {
  // Skip if notifications not supported
  if (!Notification.isSupported()) {
    mainLog.info('[FlowNotifications] Notifications not supported')
    return false
  }

  // Skip if window is focused
  if (isWindowFocused(payload.workspaceId)) {
    mainLog.info('[FlowNotifications] Skipping - window is focused')
    return false
  }

  // Determine if silent based on priority (default: low-priority = silent)
  const isSilent = payload.priority !== 'high'

  const notification = new Notification({
    title: payload.title,
    body: payload.body,
    silent: isSilent,
    // Use default app icon
    icon: undefined,
  })

  notification.on('click', () => {
    mainLog.info('[FlowNotifications] Click:', {
      type: payload.type,
      epicId: payload.epicId,
      taskId: payload.taskId,
    })

    handleFlowNotificationClick(payload)
  })

  notification.show()
  mainLog.info('[FlowNotifications] Shown:', {
    type: payload.type,
    title: payload.title,
    silent: isSilent,
  })

  return true
}

/**
 * Handle notification click - focus window and navigate to task/epic.
 */
function handleFlowNotificationClick(payload: FlowNotificationPayload): void {
  const window = getOrCreateWindow(payload.workspaceId)
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    mainLog.error('[FlowNotifications] Could not get window for navigation')
    return
  }

  // Focus the window
  if (window.isMinimized()) {
    window.restore()
  }
  window.focus()

  // Send navigation event to renderer
  window.webContents.send('flow:notification-navigate', {
    type: payload.type,
    epicId: payload.epicId,
    taskId: payload.taskId,
  })
}

// ─── Convenience Functions ─────────────────────────────────────────────────────

/**
 * Notify that a task was completed (e.g., by an agent).
 */
export function notifyTaskCompleted(
  workspaceId: string,
  epicId: string,
  taskId: string,
  taskTitle: string
): boolean {
  return showFlowNotification({
    type: 'task_completed',
    title: 'Task Completed',
    body: taskTitle,
    workspaceId,
    epicId,
    taskId,
    priority: 'low', // Silent
  })
}

/**
 * Notify that an epic is ready for review (all tasks done).
 */
export function notifyEpicReviewReady(
  workspaceId: string,
  epicId: string,
  epicTitle: string
): boolean {
  return showFlowNotification({
    type: 'epic_review_ready',
    title: 'Epic Ready for Review',
    body: `All tasks complete: ${epicTitle}`,
    workspaceId,
    epicId,
    priority: 'low', // Silent
  })
}

/**
 * Notify about a flowctl error that requires attention.
 */
export function notifyFlowctlError(
  workspaceId: string,
  errorMessage: string,
  epicId?: string,
  taskId?: string
): boolean {
  return showFlowNotification({
    type: 'flowctl_error',
    title: 'Flow Error',
    body: errorMessage,
    workspaceId,
    epicId,
    taskId,
    priority: 'high', // With sound
  })
}
