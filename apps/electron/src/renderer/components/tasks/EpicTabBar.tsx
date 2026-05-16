/**
 * EpicTabBar
 *
 * Tab bar for multi-epic navigation with closeable tabs.
 * Features:
 * - One tab per open epic
 * - Close button on each tab (X + middle-click)
 * - Horizontal scroll with arrow buttons when >8 tabs
 * - Spring animations using collapsible springTransition
 */

import * as React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  openTabsAtom,
  activeTabAtom,
  epicsAtom,
  closeEpicTabAtom,
  setActiveTabAtom,
  loadEpicsAtom,
} from '@/atoms/tasks-state'

// Spring transition config - snappy, no bounce (matches collapsible)
const springTransition = {
  type: 'spring' as const,
  stiffness: 600,
  damping: 49,
}

export interface EpicTabBarProps {
  /** Workspace root for IPC calls */
  workspaceRoot: string
  /** Optional callback when "add" button is clicked */
  onAddTab?: () => void
  /** Optional className */
  className?: string
}

export function EpicTabBar({ workspaceRoot, onAddTab, className }: EpicTabBarProps) {
  const openTabs = useAtomValue(openTabsAtom)
  const activeTab = useAtomValue(activeTabAtom)
  const epics = useAtomValue(epicsAtom)
  const closeTab = useSetAtom(closeEpicTabAtom)
  const setActiveTab = useSetAtom(setActiveTabAtom)
  const loadEpics = useSetAtom(loadEpicsAtom)

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [epicToDelete, setEpicToDelete] = React.useState<{ id: string; title: string } | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)

  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [showLeftArrow, setShowLeftArrow] = React.useState(false)
  const [showRightArrow, setShowRightArrow] = React.useState(false)

  // Check scroll state to show/hide arrows
  const updateArrows = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setShowLeftArrow(el.scrollLeft > 0)
    setShowRightArrow(el.scrollLeft < el.scrollWidth - el.clientWidth - 1)
  }, [])

  // Update arrows on scroll and resize
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    updateArrows()
    el.addEventListener('scroll', updateArrows)
    const resizeObserver = new ResizeObserver(updateArrows)
    resizeObserver.observe(el)

    return () => {
      el.removeEventListener('scroll', updateArrows)
      resizeObserver.disconnect()
    }
  }, [updateArrows, openTabs.length])

  // Scroll handlers
  const scrollLeft = React.useCallback(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollBy({ left: -200, behavior: 'smooth' })
    }
  }, [])

  const scrollRight = React.useCallback(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollBy({ left: 200, behavior: 'smooth' })
    }
  }, [])

  // Handle tab click
  const handleTabClick = React.useCallback(
    (epicId: string) => {
      setActiveTab(epicId)
    },
    [setActiveTab]
  )

  // Handle tab close
  const handleCloseTab = React.useCallback(
    (epicId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      closeTab(epicId)
    },
    [closeTab]
  )

  // Handle middle-click to close
  const handleMiddleClick = React.useCallback(
    (epicId: string, e: React.MouseEvent) => {
      if (e.button === 1) {
        // Middle click
        e.preventDefault()
        closeTab(epicId)
      }
    },
    [closeTab]
  )

  // Get epic title by ID
  const getEpicTitle = React.useCallback(
    (epicId: string) => {
      const epic = epics.find((e) => e.id === epicId)
      return epic?.title ?? epicId
    },
    [epics]
  )

  // Handle delete click from context menu
  const handleDeleteClick = React.useCallback(
    (epicId: string) => {
      const title = getEpicTitle(epicId)
      setEpicToDelete({ id: epicId, title })
      setDeleteDialogOpen(true)
    },
    [getEpicTitle]
  )

  // Confirm delete epic
  const handleConfirmDelete = React.useCallback(async () => {
    if (!epicToDelete) return

    setIsDeleting(true)
    try {
      const result = await window.electronAPI.flowEpicDelete(workspaceRoot, epicToDelete.id)
      if (result.ok) {
        toast.success('Epic deleted', {
          description: `Deleted "${epicToDelete.title}"`,
        })
        // Close the tab for the deleted epic
        closeTab(epicToDelete.id)
        // Reload epics list
        loadEpics(workspaceRoot)
      } else {
        toast.error('Failed to delete epic', {
          description: result.error.type === 'command_failed' ? result.error.stderr : 'Unknown error',
        })
      }
    } catch (err) {
      toast.error('Failed to delete epic', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setIsDeleting(false)
      setDeleteDialogOpen(false)
      setEpicToDelete(null)
    }
  }, [epicToDelete, workspaceRoot, closeTab, loadEpics])

  if (openTabs.length === 0) {
    return null
  }

  return (
    <div className={cn('flex items-center border-b border-border/50 titlebar-no-drag', className)}>
      {/* Left scroll arrow */}
      <AnimatePresence>
        {showLeftArrow && (
          <motion.div
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={springTransition}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={scrollLeft}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tab scroll area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto scrollbar-hide"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <div className="flex items-center gap-0.5 px-1 py-1">
          <AnimatePresence initial={false}>
            {openTabs.map((epicId) => {
              const isActive = epicId === activeTab
              const title = getEpicTitle(epicId)

              return (
                <ContextMenu key={epicId}>
                  <ContextMenuTrigger asChild>
                    <motion.div
                      layout
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={springTransition}
                      className="group relative"
                      onMouseDown={(e) => handleMiddleClick(epicId, e)}
                    >
                      <button
                        type="button"
                        onClick={() => handleTabClick(epicId)}
                        className={cn(
                          'relative flex items-center gap-1.5 pl-3 pr-7 py-1.5 text-sm rounded-md transition-colors',
                          'max-w-[180px] min-w-[80px]',
                          isActive
                            ? 'bg-foreground/10 text-foreground'
                            : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
                        )}
                        aria-selected={isActive}
                        role="tab"
                      >
                        <span className="truncate flex-1 text-left">{title}</span>
                        {/* Active indicator */}
                        {isActive && (
                          <motion.div
                            layoutId="activeTabIndicator"
                            className="absolute bottom-0 left-2 right-2 h-0.5 bg-foreground/50 rounded-full"
                            transition={springTransition}
                          />
                        )}
                      </button>
                      {/* Close button - separate from tab button for accessibility */}
                      <button
                        type="button"
                        onClick={(e) => handleCloseTab(epicId, e)}
                        aria-label={`Close ${title} tab`}
                        className={cn(
                          'absolute right-1.5 top-1/2 -translate-y-1/2 shrink-0 rounded-sm p-0.5 transition-colors',
                          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                          'hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring',
                          isActive && 'opacity-60'
                        )}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </motion.div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onClick={() => handleDeleteClick(epicId)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Epic
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* Right scroll arrow */}
      <AnimatePresence>
        {showRightArrow && (
          <motion.div
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={springTransition}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={scrollRight}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add tab button */}
      {onAddTab && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 ml-1"
          onClick={onAddTab}
          data-tutorial="create-epic-button"
        >
          <Plus className="h-4 w-4" style={{ color: 'var(--foreground)' }} />
        </Button>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Epic</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{epicToDelete?.title}"? This will also delete all tasks in this epic. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
