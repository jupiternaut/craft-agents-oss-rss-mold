/**
 * DependencyGraph
 *
 * Read-only dependency graph visualization using @xyflow/react and @dagrejs/dagre.
 * Shows tasks as nodes with dependency edges. Click nodes to open slide-over detail.
 *
 * Features:
 * - Dagre auto-layout (top-to-bottom)
 * - Custom TaskNode component
 * - Read-only (no drag nodes, no connect edges)
 * - Pan and zoom enabled
 * - Viewport state persisted per epic
 * - fitView on initial layout only
 * - Memoized dagre computation (only re-runs on structural changes)
 */

import * as React from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useNodesInitialized,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  type Viewport,
  MarkerType,
} from '@xyflow/react'
import { graphlib } from 'dagre-d3-es'
import { layout as dagreLayout } from 'dagre-d3-es/src/dagre/index.js'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { cn } from '@/lib/utils'
import { TaskNodeComponent, type TaskNodeData } from './TaskNode'
import type { TaskSummary } from '../../../shared/flow-schemas'
import {
  tasksAtomFamily,
  tasksLoadingAtomFamily,
  loadTasksAtom,
  graphViewportPerEpicAtomFamily,
  graphInitializedPerEpicAtomFamily,
  graphLayoutAppliedPerEpicAtomFamily,
} from '@/atoms/tasks-state'

// Import React Flow styles
import '@xyflow/react/dist/style.css'

export interface DependencyGraphProps {
  /** Epic ID to display tasks for */
  epicId: string
  /** Workspace root for IPC calls */
  workspaceRoot: string
  /** Callback when a task node is clicked */
  onTaskClick?: (taskId: string) => void
  /** Optional className */
  className?: string
}

// Register custom node types
const nodeTypes: NodeTypes = {
  task: TaskNodeComponent,
}

// Dagre layout configuration
const DAGRE_CONFIG = {
  rankdir: 'TB' as const, // top-to-bottom
  acyclicer: 'greedy', // Handle cyclic dependencies gracefully
  nodesep: 50,
  ranksep: 50,
  marginx: 20,
  marginy: 20,
}

// Default node dimensions (used for initial layout before measurement)
const DEFAULT_NODE_WIDTH = 200
const DEFAULT_NODE_HEIGHT = 60

/**
 * Convert dagre center coordinates to top-left
 */
function centerToTopLeft(cx: number, cy: number, width: number, height: number) {
  return { x: cx - width / 2, y: cy - height / 2 }
}

/**
 * Compute a structural key for tasks - only changes when task IDs or dependencies change
 * Status updates don't affect this key, preventing unnecessary re-layouts
 */
function computeTaskStructureKey(tasks: TaskSummary[]): string {
  return tasks.map((t) => `${t.id}:${t.depends_on.sort().join(',')}`).join('|')
}

/**
 * Build React Flow nodes from tasks
 */
function buildNodes(tasks: TaskSummary[]): Node[] {
  // Build a set of task IDs that have dependents (other tasks depend on them)
  const tasksWithDependents = new Set<string>()
  for (const task of tasks) {
    for (const depId of task.depends_on) {
      tasksWithDependents.add(depId)
    }
  }

  return tasks.map((task): Node => ({
    id: task.id,
    type: 'task',
    position: { x: 0, y: 0 }, // Will be set by dagre
    data: {
      id: task.id,
      title: task.title,
      status: task.status,
      isBlocked: task.status === 'blocked' || (task.depends_on.length > 0 && task.status === 'todo'),
      hasDependencies: task.depends_on.length > 0,
      hasDependents: tasksWithDependents.has(task.id),
    } satisfies TaskNodeData,
  }))
}

/**
 * Build React Flow edges from task dependencies
 * Uses 'step' edge type for orthogonal routing
 */
function buildEdges(tasks: TaskSummary[]): Edge[] {
  const edges: Edge[] = []
  const taskIds = new Set(tasks.map((t) => t.id))

  for (const task of tasks) {
    for (const depId of task.depends_on) {
      // Only create edge if dependency exists in the current task list
      if (taskIds.has(depId)) {
        edges.push({
          id: `${depId}->${task.id}`,
          source: depId,
          target: task.id,
          type: 'step', // Orthogonal edges with 90-degree bends
          animated: task.status === 'in_progress',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
          },
          style: {
            strokeWidth: 1.5,
          },
        })
      }
    }
  }

  return edges
}

/**
 * Apply dagre layout to nodes
 */
function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes

  const g = new graphlib.Graph()
  g.setGraph(DAGRE_CONFIG)
  g.setDefaultEdgeLabel(() => ({}))

  // Add nodes with dimensions
  for (const node of nodes) {
    const width = node.measured?.width ?? DEFAULT_NODE_WIDTH
    const height = node.measured?.height ?? DEFAULT_NODE_HEIGHT
    g.setNode(node.id, { width, height })
  }

  // Add edges
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  // Run dagre layout
  dagreLayout(g, {})

  // Apply positions to nodes
  return nodes.map((node): Node => {
    const dagreNode = g.node(node.id)
    if (!dagreNode) return node

    const width = node.measured?.width ?? DEFAULT_NODE_WIDTH
    const height = node.measured?.height ?? DEFAULT_NODE_HEIGHT
    const { x, y } = centerToTopLeft(dagreNode.x, dagreNode.y, width, height)

    return {
      ...node,
      position: { x, y },
    }
  })
}

/**
 * Inner component that has access to React Flow context
 */
function DependencyGraphInner({
  epicId,
  tasks,
  onTaskClick,
}: {
  epicId: string
  tasks: TaskSummary[]
  onTaskClick?: (taskId: string) => void
}) {
  const { fitView, setViewport } = useReactFlow()
  const nodesInitialized = useNodesInitialized()

  // Viewport and initialization state per epic (fixes race condition on tab switch)
  const [savedViewport, setSavedViewport] = useAtom(graphViewportPerEpicAtomFamily(epicId))
  const [isInitialized, setIsInitialized] = useAtom(graphInitializedPerEpicAtomFamily(epicId))
  const [layoutApplied, setLayoutApplied] = useAtom(graphLayoutAppliedPerEpicAtomFamily(epicId))

  // Compute structural key - only changes when task IDs or dependencies change
  // Status updates don't trigger re-layout (performance optimization)
  const taskStructureKey = React.useMemo(() => computeTaskStructureKey(tasks), [tasks])

  // Build initial nodes and edges
  const initialNodes = React.useMemo(() => buildNodes(tasks), [tasks])
  const initialEdges = React.useMemo(() => buildEdges(tasks), [tasks])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Track previous structure key to detect structural changes
  const prevStructureKeyRef = React.useRef<string | null>(null)

  // Reset layout only when task structure changes (not on status updates)
  React.useEffect(() => {
    const newNodes = buildNodes(tasks)
    const newEdges = buildEdges(tasks)
    setNodes(newNodes)
    setEdges(newEdges)

    // Only reset layout if structure actually changed
    if (prevStructureKeyRef.current !== taskStructureKey) {
      setLayoutApplied(false)
      prevStructureKeyRef.current = taskStructureKey
    }
    // Don't reset isInitialized - we want to preserve viewport on task updates
  }, [tasks, taskStructureKey, setNodes, setEdges, setLayoutApplied])

  // Apply dagre layout after nodes are measured
  React.useEffect(() => {
    if (nodesInitialized && !layoutApplied && nodes.length > 0) {
      const layoutedNodes = applyDagreLayout(nodes, edges)
      setNodes(layoutedNodes)
      setLayoutApplied(true)
    }
  }, [nodesInitialized, layoutApplied, nodes, edges, setNodes, setLayoutApplied])

  // Restore saved viewport or fitView on initial layout
  // Simplified dependencies to prevent viewport jumps
  React.useEffect(() => {
    if (!layoutApplied || nodes.length === 0) return

    if (savedViewport && isInitialized) {
      // Restore saved viewport
      setViewport(savedViewport, { duration: 0 })
    } else if (!isInitialized) {
      // Initial fitView
      requestAnimationFrame(() => {
        fitView({ padding: 0.2, duration: 200 })
        setIsInitialized(true)
      })
    }
  }, [layoutApplied, isInitialized]) // Removed nodes.length and savedViewport to prevent jumps

  // Save viewport on move/zoom
  const handleMoveEnd = React.useCallback(
    (_event: unknown, viewport: Viewport) => {
      setSavedViewport(viewport)
    },
    [setSavedViewport]
  )

  // Handle node click
  const handleNodeClick = React.useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onTaskClick?.(node.id)
    },
    [onTaskClick]
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      onMoveEnd={handleMoveEnd}
      // Read-only settings
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={true}
      selectNodesOnDrag={false}
      // Navigation
      panOnDrag
      zoomOnScroll
      zoomOnPinch
      panOnScroll={false}
      // Styling
      fitView={false} // We handle fitView manually
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background
        gap={16}
        size={1}
        className="bg-background"
      />
      <Controls
        showInteractive={false}
        className="!bg-background !border-border !shadow-minimal"
      />
    </ReactFlow>
  )
}

/**
 * Empty state component
 */
function EmptyState({ hasTasks }: { hasTasks: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
      <p className="text-sm">
        {hasTasks
          ? 'No dependencies defined'
          : 'No tasks in this epic'}
      </p>
      <p className="text-xs opacity-70">
        {hasTasks
          ? 'Tasks with dependencies will appear here'
          : 'Create tasks to see the dependency graph'}
      </p>
    </div>
  )
}

export function DependencyGraph({
  epicId,
  workspaceRoot,
  onTaskClick,
  className,
}: DependencyGraphProps) {
  const tasks = useAtomValue(tasksAtomFamily(epicId))
  const loadingState = useAtomValue(tasksLoadingAtomFamily(epicId))
  const loadTasks = useSetAtom(loadTasksAtom)

  // Load tasks when epicId or workspaceRoot changes
  React.useEffect(() => {
    if (epicId && workspaceRoot) {
      loadTasks(workspaceRoot, epicId)
    }
  }, [epicId, workspaceRoot, loadTasks])

  // Subscribe to flow:changed events for live updates
  React.useEffect(() => {
    if (!workspaceRoot || !epicId) return

    const cleanup = window.electronAPI.onFlowChanged((changedWorkspaceRoot, payload) => {
      if (changedWorkspaceRoot === workspaceRoot && (payload.type === 'task' || payload.type === 'epic')) {
        loadTasks(workspaceRoot, epicId)
      }
    })

    return cleanup
  }, [workspaceRoot, epicId, loadTasks])

  // Loading state
  if (loadingState === 'loading' && tasks.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <span className="text-sm text-muted-foreground">Loading tasks...</span>
      </div>
    )
  }

  // Check if any tasks have dependencies
  const hasDependencies = tasks.some((t) => t.depends_on.length > 0)

  // Empty state: no tasks or no dependencies
  if (tasks.length === 0 || !hasDependencies) {
    return (
      <div className={cn('h-full', className)}>
        <EmptyState hasTasks={tasks.length > 0} />
      </div>
    )
  }

  return (
    <div className={cn('h-full', className)}>
      <ReactFlowProvider>
        <DependencyGraphInner
          epicId={epicId}
          tasks={tasks}
          onTaskClick={onTaskClick}
        />
      </ReactFlowProvider>
    </div>
  )
}
