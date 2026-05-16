/**
 * KanbanDragOverlay
 *
 * Drag overlay component that shows a floating preview of the task card
 * being dragged. Portaled to document.body for proper z-index layering.
 */

import * as React from 'react'
import { DragOverlay, type DropAnimation } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { TaskCard, type TaskCardData } from './TaskCard'

export interface KanbanDragOverlayProps {
  /** The task currently being dragged, or null if no drag in progress */
  activeTask: TaskCardData | null
}

const DROP_DURATION = 200

/**
 * Drop animation: crossfade to final position
 */
const dropAnimationConfig: DropAnimation = {
  keyframes({ transform }) {
    return [
      { opacity: 1, transform: CSS.Transform.toString(transform.initial) },
      { opacity: 0, transform: CSS.Transform.toString(transform.final) },
    ]
  },
  duration: DROP_DURATION,
  easing: 'ease',
  sideEffects({ active }) {
    // Ghost fades in at new position simultaneously
    active.node.animate([{ opacity: 0.5 }, { opacity: 1 }], {
      duration: DROP_DURATION,
      easing: 'ease',
    })
  },
}

export function KanbanDragOverlay({ activeTask }: KanbanDragOverlayProps) {
  return (
    <DragOverlay
      dropAnimation={dropAnimationConfig}
      zIndex={400}
    >
      {activeTask ? (
        <div className="w-[280px] shadow-strong">
          <TaskCard task={activeTask} isOverlay />
        </div>
      ) : null}
    </DragOverlay>
  )
}
