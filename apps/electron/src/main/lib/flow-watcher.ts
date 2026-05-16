/**
 * FlowWatcher: Monitors .flow/ directory for changes and emits IPC events.
 *
 * Follows the ConfigWatcher pattern (per-file-path debounce map, fs.watch recursive).
 * One FlowWatcher per workspace, shared across windows.
 *
 * Lifecycle: created when first window opens workspace, destroyed when last window closes.
 *
 * Notes:
 * - fs.watch with recursive: true works on macOS (FSEvents) and Windows.
 *   Linux requires chokidar — deferred.
 * - Watches parent directory when .flow/ doesn't exist, switches to .flow/ on creation.
 */

import { watch, existsSync } from 'fs'
import { join } from 'path'
import type { FSWatcher } from 'fs'
import type { BrowserWindow } from 'electron'

// ============================================================
// Constants
// ============================================================

const DEBOUNCE_MS = 100

// ============================================================
// Types
// ============================================================

export interface FlowChangedPayload {
  type: 'epic' | 'task' | 'config'
  id?: string
}

// ============================================================
// FlowWatcher Class
// ============================================================

export class FlowWatcher {
  private workspaceRoot: string
  private flowDir: string
  private watcher: FSWatcher | null = null
  private parentWatcher: FSWatcher | null = null
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map()
  private isRunning = false
  private getWindows: () => BrowserWindow[]

  constructor(workspaceRoot: string, getWindows: () => BrowserWindow[]) {
    this.workspaceRoot = workspaceRoot
    this.flowDir = join(workspaceRoot, '.flow')
    this.getWindows = getWindows
  }

  /**
   * Start watching .flow/ directory (or parent if .flow/ doesn't exist yet).
   */
  start(): void {
    if (this.isRunning) return
    this.isRunning = true

    if (existsSync(this.flowDir)) {
      this.watchFlowDir()
    } else {
      this.watchParentForCreation()
    }
  }

  /**
   * Stop watching and clean up all resources.
   */
  stop(): void {
    if (!this.isRunning) return
    this.isRunning = false

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()

    this.closeWatcher()
    this.closeParentWatcher()
  }

  // ============================================================
  // Private: Watcher Setup
  // ============================================================

  private watchFlowDir(): void {
    this.closeWatcher()

    try {
      this.watcher = watch(this.flowDir, { recursive: true }, (_eventType, filename) => {
        if (!filename) return
        const normalizedPath = filename.replace(/\\/g, '/')
        this.handleFlowFileChange(normalizedPath)
      })

      // Handle .flow/ being deleted while watching
      this.watcher.on('error', () => {
        this.closeWatcher()
        if (this.isRunning) {
          this.watchParentForCreation()
        }
      })
    } catch {
      // .flow/ may have been deleted between existsSync and watch
      if (this.isRunning) {
        this.watchParentForCreation()
      }
    }
  }

  /**
   * Watch workspace root for .flow/ directory creation.
   * Once detected, switch to watching .flow/ directly.
   */
  private watchParentForCreation(): void {
    this.closeParentWatcher()

    try {
      this.parentWatcher = watch(this.workspaceRoot, (eventType, filename) => {
        // Guard against null filename (can happen on macOS for directory-level events)
        if (filename && filename === '.flow' && existsSync(this.flowDir)) {
          this.closeParentWatcher()
          this.watchFlowDir()
          // Emit a config change to signal .flow/ was created
          this.emit({ type: 'config' })
        }
      })

      this.parentWatcher.on('error', (err) => {
        console.error('[FlowWatcher] Parent watcher error:', err)
        this.closeParentWatcher()
      })
    } catch {
      // Workspace root may not exist — nothing to do
    }
  }

  // ============================================================
  // Private: File Change Parsing
  // ============================================================

  private handleFlowFileChange(relativePath: string): void {
    const parts = relativePath.split('/')
    const payload = this.parsePayload(parts, relativePath)
    if (payload) {
      this.debounce(relativePath, () => this.emit(payload))
    }
  }

  /**
   * Parse a relative path within .flow/ into a typed payload.
   *
   * Examples:
   *   specs/fn-1.md           → { type: 'epic', id: 'fn-1' }
   *   tasks/fn-1.2.md         → { type: 'task', id: 'fn-1.2' }
   *   tasks/fn-1.2.json       → { type: 'task', id: 'fn-1.2' }
   *   epics/fn-1.json         → { type: 'epic', id: 'fn-1' }
   *   config.json             → { type: 'config' }
   *   state.json              → { type: 'config' }
   */
  private parsePayload(parts: string[], relativePath: string): FlowChangedPayload | null {
    const dir = parts[0]
    const file = parts[1]

    // Note: Task IDs contain dots (e.g., fn-1.2.md), so we only strip the final .json/.md extension
    if (dir === 'epics' && file) {
      const id = file.replace(/\.(json|md)$/, '')
      return { type: 'epic', id }
    }

    if (dir === 'tasks' && file) {
      const id = file.replace(/\.(json|md)$/, '')
      return { type: 'task', id }
    }

    if (dir === 'specs' && file) {
      const id = file.replace(/\.(json|md)$/, '')
      return { type: 'epic', id }
    }

    // Top-level config files or anything else
    if (parts.length === 1 || dir === 'bin') {
      // bin/ changes are not interesting to the renderer
      if (dir === 'bin') return null
      return { type: 'config' }
    }

    // Default: treat as config change
    return { type: 'config' }
  }

  // ============================================================
  // Private: Debounce & Emit
  // ============================================================

  private debounce(key: string, handler: () => void): void {
    const existing = this.debounceTimers.get(key)
    if (existing) {
      clearTimeout(existing)
    }
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key)
      handler()
    }, DEBOUNCE_MS)
    this.debounceTimers.set(key, timer)
  }

  private emit(payload: FlowChangedPayload): void {
    const windows = this.getWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('flow:changed', this.workspaceRoot, payload)
      }
    }
  }

  // ============================================================
  // Private: Cleanup Helpers
  // ============================================================

  private closeWatcher(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }

  private closeParentWatcher(): void {
    if (this.parentWatcher) {
      this.parentWatcher.close()
      this.parentWatcher = null
    }
  }
}
