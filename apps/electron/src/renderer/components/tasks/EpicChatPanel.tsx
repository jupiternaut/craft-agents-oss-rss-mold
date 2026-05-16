/**
 * EpicChatPanel
 *
 * Split-view chat panel scoped to an epic.
 * Features:
 * - Persistent chat history (IndexedDB)
 * - Slash commands (/plan, /interview, /review)
 * - Action buttons for quick command insertion
 * - Write-with-confirmation for task mutations
 * - Auto-save draft on blur/tab switch
 * - Animated slide-in/out panel (320px fixed width)
 * - Real streaming LLM via IPC for /interview, /review, free-form chat
 * - Stop button for aborting in-flight streams
 * - Auto-scroll with "scroll to bottom" indicator
 */

import * as React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { atomFamily } from 'jotai-family'
import {
  MessageCircle,
  Send,
  Trash2,
  Bot,
  User,
  X,
  CheckCircle2,
  RotateCcw,
  Loader2,
  Square,
  ChevronDown,
  AlertCircle,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { StreamingMarkdown, Markdown } from '@/components/markdown'
import {
  useEpicChatHistory,
  type EpicChatMessage,
} from './EpicChatHistory'
import {
  ChatActionButtons,
  parseSlashCommand,
} from './ChatActionButtons'
import {
  WriteConfirmation,
  parseMutationFromResponse,
  type TaskMutation,
} from './WriteConfirmation'
import { epicsAtom, tasksAtomFamily, loadTasksAtom, registeredFlowProjectsAtom } from '@/atoms/tasks-state'
import type { ChatCommandType } from '../../../main/lib/epic-chat-agent'
import type { FlowEpicChatStatusEvent } from '../../../shared/types'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Max messages to send over IPC to stay within token budget */
const MAX_HISTORY_MESSAGES = 20

/** Scroll threshold in px — auto-scroll only when within this distance of bottom */
const AUTO_SCROLL_THRESHOLD = 100

// ─── Atoms ────────────────────────────────────────────────────────────────────

/**
 * Draft text per epic - persisted to localStorage
 */
const chatDraftAtomFamily = atomFamily(
  (epicId: string) => atomWithStorage<string>(`epic-chat-draft-${epicId}`, ''),
  (a, b) => a === b
)

/**
 * Whether the chat panel is open - global state
 */
export const epicChatOpenAtom = atomWithStorage<boolean>('epic-chat-open', false)

// ─── Spring transition ────────────────────────────────────────────────────────

const springTransition = {
  type: 'spring' as const,
  stiffness: 600,
  damping: 49,
}

// ─── Starter Prompts ─────────────────────────────────────────────────────────

interface StarterPrompt {
  label: string
  /** If set, use handleInsertCommand to populate input (slash command). Otherwise send immediately. */
  command?: string
  /** Free-form message to send immediately on click (used when command is not set) */
  message?: string
}

/**
 * Generate dynamic starter prompts based on epic state.
 * Pure rule-based — no LLM calls.
 */
function getStarterPrompts(
  tasks: Array<{ status: string; title: string }>,
): StarterPrompt[] {
  const totalTasks = tasks.length
  const doneTasks = tasks.filter((t) => t.status === 'done').length
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress')
  const blockedTasks = tasks.filter((t) => t.status === 'blocked')
  const stuckTasks = [...inProgressTasks, ...blockedTasks]

  // No tasks — suggest planning & interview
  if (totalTasks === 0) {
    return [
      { label: 'Break down this epic into tasks', command: '/plan' },
      { label: 'What questions should I answer first?', command: '/interview' },
    ]
  }

  // All tasks done — suggest retrospective
  if (totalTasks > 0 && doneTasks === totalTasks) {
    return [
      { label: 'What could we improve?', message: 'What could we improve about this epic?' },
      { label: 'Generate a retrospective', message: 'Generate a retrospective for this epic' },
    ]
  }

  // Has stuck/blocked tasks — suggest help
  if (stuckTasks.length > 0) {
    const stuckTask = stuckTasks[0]
    return [
      {
        label: `Help me get unstuck on "${stuckTask.title.length > 30 ? stuckTask.title.slice(0, 30) + '...' : stuckTask.title}"`,
        message: `Help me get unstuck on the task "${stuckTask.title}"`,
      },
      { label: "What's blocking progress?", message: "What's blocking progress on this epic?" },
    ]
  }

  // Has tasks but none done — suggest review & guidance
  if (doneTasks === 0) {
    return [
      { label: 'Review the task breakdown', command: '/review' },
      { label: 'What should I tackle first?', message: 'What task should I tackle first and why?' },
    ]
  }

  // Partial progress — suggest review & next steps
  return [
    { label: 'Review current progress', command: '/review' },
    { label: 'What should I work on next?', message: 'Based on the current task status, what should I work on next?' },
  ]
}

// ─── Smart Empty State ───────────────────────────────────────────────────────

interface SmartEmptyStateProps {
  epicTitle: string
  tasks: Array<{ status: string; title: string }>
  onInsertCommand: (command: string) => void
  onSendMessage: (message: string) => void
}

function SmartEmptyState({ epicTitle, tasks, onInsertCommand, onSendMessage }: SmartEmptyStateProps) {
  const starters = getStarterPrompts(tasks)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center py-8 px-2"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <Sparkles className="h-8 w-8 mx-auto mb-3 text-blue-500/60" />
      </motion.div>
      <p className="text-sm text-foreground/80 text-center mb-1">
        What would you like to know about
      </p>
      <p className="text-sm font-medium text-foreground text-center mb-4 px-2 leading-snug">
        {epicTitle}?
      </p>
      <div className="flex flex-wrap justify-center gap-1.5 px-1">
        {starters.map((starter, index) => (
          <motion.button
            key={starter.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: index * 0.05 }}
            onClick={() => {
              if (starter.command) {
                onInsertCommand(starter.command)
              } else if (starter.message) {
                onSendMessage(starter.message)
              }
            }}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs',
              'bg-foreground/5 hover:bg-foreground/10',
              'text-foreground/70 hover:text-foreground',
              'border border-border/40 hover:border-border/60',
              'transition-colors duration-150 cursor-pointer',
              'max-w-[250px] text-center leading-snug'
            )}
          >
            {starter.label}
          </motion.button>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground/50 mt-4">
        or type a question below
      </p>
    </motion.div>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EpicChatPanelProps {
  /** The epic ID for this chat */
  epicId: string | null
  /** Workspace root for IPC calls */
  workspaceRoot: string
  /** Whether the chat panel is visible */
  isOpen: boolean
  /** Callback to toggle chat visibility */
  onToggle: () => void
  /** Children to render in the main content area */
  children: React.ReactNode
  /** Optional className */
  className?: string
}

// ─── Error Message Bubble ────────────────────────────────────────────────────

interface ErrorMessageBubbleProps {
  message: EpicChatMessage
  onRetry: () => void
}

function ErrorMessageBubble({ message, onRetry }: ErrorMessageBubbleProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex gap-2 items-start"
    >
      <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-destructive/10 text-destructive">
        <AlertCircle className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm bg-destructive/5 text-foreground mr-8 border border-destructive/20">
        <p className="text-xs text-destructive">{message.content}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRetry}
          className="h-6 px-2 mt-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          Retry
        </Button>
        <p className="text-[10px] text-muted-foreground mt-1">
          {new Date(message.timestamp).toLocaleTimeString()}
        </p>
      </div>
    </motion.div>
  )
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: EpicChatMessage
  isStreaming?: boolean
}

function MessageBubble({ message, isStreaming = false }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'flex gap-2 items-start',
        isUser && 'flex-row-reverse'
      )}
    >
      <div
        className={cn(
          'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center',
          isUser ? 'bg-blue-500/10 text-blue-600' : 'bg-foreground/10 text-foreground/70'
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div
        className={cn(
          'flex-1 min-w-0 px-3 py-2 rounded-lg text-sm',
          isUser
            ? 'bg-blue-500/10 text-foreground ml-8'
            : 'bg-foreground/5 text-foreground mr-8'
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : isStreaming ? (
          <StreamingMarkdown content={message.content} isStreaming={true} />
        ) : (
          <Markdown>{message.content}</Markdown>
        )}
        <p className="text-[10px] text-muted-foreground mt-1">
          {new Date(message.timestamp).toLocaleTimeString()}
        </p>
      </div>
    </motion.div>
  )
}

// ─── Chat Content ─────────────────────────────────────────────────────────────

interface ChatContentProps {
  epicId: string
  workspaceRoot: string
  onClose: () => void
}

function ChatContent({ epicId, workspaceRoot, onClose }: ChatContentProps) {
  const epics = useAtomValue(epicsAtom)
  const epic = epics.find((e) => e.id === epicId)
  const tasks = useAtomValue(tasksAtomFamily(epicId))
  const loadTasks = useSetAtom(loadTasksAtom)
  const registeredProjects = useAtomValue(registeredFlowProjectsAtom)

  const {
    messages,
    setMessages,
    isLoading,
    addMessage,
    updateLastMessage,
    saveMessages,
    clearHistory,
  } = useEpicChatHistory(epicId)

  const [draft, setDraft] = useAtom(chatDraftAtomFamily(epicId))
  const [isProcessing, setIsProcessing] = React.useState(false)
  const [isStreaming, setIsStreaming] = React.useState(false)
  const [pendingMutation, setPendingMutation] = React.useState<TaskMutation | null>(null)
  const [isApplyingMutation, setIsApplyingMutation] = React.useState(false)
  const [showScrollButton, setShowScrollButton] = React.useState(false)

  // PRD-002: Plan approval state
  const [hasPendingPlan, setHasPendingPlan] = React.useState(false)
  const [isApprovingPlan, setIsApprovingPlan] = React.useState(false)
  const [planProgress, setPlanProgress] = React.useState<string | null>(null)

  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // Refs for streaming state — avoid stale closures
  const streamContentRef = React.useRef('')
  const messagesRef = React.useRef(messages)
  const isProcessingRef = React.useRef(false)
  const lastSendParamsRef = React.useRef<{
    message: string
    commandType: ChatCommandType
    history: Array<{ role: string; content: string }>
  } | null>(null)

  // Keep messagesRef in sync
  React.useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // Keep isProcessingRef in sync
  React.useEffect(() => {
    isProcessingRef.current = isProcessing
  }, [isProcessing])

  // ─── Auto-scroll logic ──────────────────────────────────────────────────

  const isNearBottom = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < AUTO_SCROLL_THRESHOLD
  }, [])

  const scrollToBottom = React.useCallback(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
    setShowScrollButton(false)
  }, [])

  // Track scroll position for "scroll to bottom" button
  const handleScroll = React.useCallback(() => {
    if (isNearBottom()) {
      setShowScrollButton(false)
    }
  }, [isNearBottom])

  // Auto-scroll when messages change (only if near bottom)
  React.useEffect(() => {
    if (isNearBottom()) {
      scrollToBottom()
    } else if (messages.length > 0) {
      setShowScrollButton(true)
    }
  }, [messages, isNearBottom, scrollToBottom])

  // Attach scroll listener
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  // ─── Streaming listener ──────────────────────────────────────────────────

  React.useEffect(() => {
    const unsubscribe = window.electronAPI.onFlowEpicChatStatus((event: FlowEpicChatStatusEvent) => {
      if (event.epicId !== epicId) return

      switch (event.type) {
        case 'text_delta':
          streamContentRef.current += event.text
          updateLastMessage(streamContentRef.current)
          // Auto-scroll during streaming if near bottom
          if (isNearBottom()) {
            requestAnimationFrame(() => scrollToBottom())
          }
          break

        case 'text_complete':
          setIsStreaming(false)
          setIsProcessing(false)
          // Save with the final messages — use setTimeout to let state flush
          setTimeout(() => {
            const currentMessages = messagesRef.current
            saveMessages(currentMessages)
          }, 0)
          break

        case 'error': {
          setIsStreaming(false)
          setIsProcessing(false)
          streamContentRef.current = ''

          // Format error message based on type
          const errorMessage = event.message

          // If the last message is an empty assistant placeholder, replace it with error
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1]
            if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content === '') {
              // Replace the empty placeholder with an error message
              const updated = [...prev]
              updated[updated.length - 1] = {
                ...lastMsg,
                content: errorMessage,
                // Mark as error by prefixing content (used in rendering)
                id: `error-${lastMsg.id}`,
              }
              return updated
            }
            // Otherwise add a new error message
            return [...prev, {
              id: `error-${crypto.randomUUID()}`,
              role: 'assistant' as const,
              content: errorMessage,
              timestamp: Date.now(),
            }]
          })
          break
        }
      }
    })

    return unsubscribe
  }, [epicId, updateLastMessage, saveMessages, setMessages, isNearBottom, scrollToBottom])

  // ─── Epic switch abort ──────────────────────────────────────────────────

  React.useEffect(() => {
    return () => {
      if (isProcessingRef.current) {
        window.electronAPI.flowEpicChatAbort(workspaceRoot, epicId)
      }
    }
  }, [epicId, workspaceRoot])

  // PRD-002: Listen for plan progress events
  React.useEffect(() => {
    const unsubscribe = window.electronAPI.onFlowEpicPlanStatus((event) => {
      if (event.epicId !== epicId) return

      switch (event.type) {
        case 'progress':
          setPlanProgress(event.message || 'Planning...')
          break
        case 'tasks':
          setPlanProgress(null)
          setHasPendingPlan(true)
          break
        case 'error':
          setPlanProgress(null)
          break
        case 'complete':
          setPlanProgress(null)
          setHasPendingPlan(false)
          // Reload tasks to show newly created tasks
          loadTasks(workspaceRoot, epicId)
          break
      }
    })
    return unsubscribe
  }, [epicId, workspaceRoot, loadTasks])

  // PRD-002: Handle plan approval
  const handleApprovePlan = React.useCallback(async () => {
    setIsApprovingPlan(true)
    try {
      const result = await window.electronAPI.flowEpicPlanApprove(workspaceRoot, epicId)
      if (result.ok) {
        setHasPendingPlan(false)
        await addMessage({
          role: 'assistant',
          content: 'Plan approved! Tasks have been created. Check the task board.',
        })
        await saveMessages()
        // Reload tasks to show newly created tasks
        await loadTasks(workspaceRoot, epicId)
      } else {
        await addMessage({
          role: 'assistant',
          content: `Failed to approve plan: ${result.error}`,
        })
        await saveMessages()
      }
    } catch (error) {
      console.error('[EpicChatPanel] Error approving plan:', error)
      await addMessage({
        role: 'assistant',
        content: 'Failed to approve plan. Please try again.',
      })
    } finally {
      setIsApprovingPlan(false)
    }
  }, [workspaceRoot, epicId, addMessage, saveMessages, loadTasks])

  // PRD-002: Handle re-plan
  const handleReplan = React.useCallback(() => {
    setHasPendingPlan(false)
    setDraft('/plan ')
    textareaRef.current?.focus()
  }, [setDraft])

  // Handle command insertion from action buttons
  const handleInsertCommand = React.useCallback((command: string) => {
    setDraft((prev) => {
      const trimmed = prev.trim()
      if (trimmed.length === 0) {
        return command + ' '
      }
      return trimmed + '\n' + command + ' '
    })
    textareaRef.current?.focus()
  }, [setDraft])

  // Handle stop button
  const handleStop = React.useCallback(() => {
    window.electronAPI.flowEpicChatAbort(workspaceRoot, epicId)
    setIsStreaming(false)
    setIsProcessing(false)
    // Save whatever partial content we have
    setTimeout(() => {
      const currentMessages = messagesRef.current
      saveMessages(currentMessages)
    }, 0)
  }, [workspaceRoot, epicId, saveMessages])

  // Handle retry — re-send the last user message
  const handleRetry = React.useCallback(() => {
    const params = lastSendParamsRef.current
    if (!params) return

    // Remove the error message from history
    setMessages((prev) => {
      const lastMsg = prev[prev.length - 1]
      if (lastMsg && lastMsg.id.startsWith('error-')) {
        return prev.slice(0, -1)
      }
      return prev
    })

    // Re-send the message
    setIsProcessing(true)
    setIsStreaming(true)
    streamContentRef.current = ''

    // Add empty assistant placeholder for streaming
    const placeholderMessage: EpicChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, placeholderMessage])

    // Truncate history to last MAX_HISTORY_MESSAGES
    const currentMessages = messagesRef.current
    const historySlice = currentMessages
      .filter((m) => !m.id.startsWith('error-'))
      .slice(-MAX_HISTORY_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content }))

    window.electronAPI.flowEpicChatSend(
      workspaceRoot,
      epicId,
      params.commandType,
      params.message,
      historySlice,
      registeredProjects.map((p) => ({ path: p.path, name: p.name }))
    )
  }, [workspaceRoot, epicId, setMessages, registeredProjects])

  // Handle send message
  const handleSend = React.useCallback(async () => {
    const trimmed = draft.trim()
    if (!trimmed || isProcessing) return

    // Parse slash command
    const { command, args } = parseSlashCommand(trimmed)

    // Add user message
    await addMessage({ role: 'user', content: trimmed })
    setDraft('')

    // /plan uses the existing planning agent channel (unchanged)
    if (command === 'plan') {
      setIsProcessing(true)
      try {
        const response = await executePlanCommand(epicId, workspaceRoot)
        await addMessage({ role: 'assistant', content: response })

        if (!response.startsWith('Failed to generate plan')) {
          setHasPendingPlan(true)
        }

        const mutation = parseMutationFromResponse(response)
        if (mutation) {
          setPendingMutation(mutation)
        }

        await saveMessages()
      } catch (error) {
        console.error('[EpicChatPanel] Error executing plan:', error)
        await addMessage({
          role: 'assistant',
          content: 'Sorry, I encountered an error processing your request. Please try again.',
        })
      } finally {
        setIsProcessing(false)
      }
      return
    }

    // All other commands use real streaming agent
    setIsProcessing(true)
    setIsStreaming(true)
    streamContentRef.current = ''

    // Determine command type for IPC
    const commandType: ChatCommandType = command === 'interview'
      ? 'interview'
      : command === 'review'
        ? 'review'
        : 'chat'

    const userMessage = args || trimmed

    // Add empty assistant message placeholder for streaming
    const placeholderMessage: EpicChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, placeholderMessage])

    // Truncate history to last MAX_HISTORY_MESSAGES (exclude the placeholder)
    const currentMessages = messagesRef.current
    const historySlice = currentMessages
      .filter((m) => m.content !== '' && !m.id.startsWith('error-'))
      .slice(-MAX_HISTORY_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content }))

    // Store send params for retry
    lastSendParamsRef.current = { message: userMessage, commandType, history: historySlice }

    // Fire-and-forget IPC call — streaming events come back via onFlowEpicChatStatus
    window.electronAPI.flowEpicChatSend(
      workspaceRoot,
      epicId,
      commandType,
      userMessage,
      historySlice,
      registeredProjects.map((p) => ({ path: p.path, name: p.name }))
    )
  }, [draft, isProcessing, addMessage, setDraft, epicId, workspaceRoot, saveMessages, setMessages, registeredProjects])

  // Handle mutation apply
  const handleApplyMutation = React.useCallback(async (mutation: TaskMutation) => {
    setIsApplyingMutation(true)

    try {
      if (mutation.type === 'status_change') {
        // Execute status change via IPC
        await window.electronAPI.flowTaskUpdateStatus(
          workspaceRoot,
          mutation.taskId,
          mutation.toStatus as 'todo' | 'in_progress' | 'blocked' | 'done'
        )

        // Reload tasks to update kanban
        await loadTasks(workspaceRoot, epicId)

        await addMessage({
          role: 'assistant',
          content: `Task "${mutation.taskTitle}" status changed from ${mutation.fromStatus} to ${mutation.toStatus}.`,
        })
      } else if (mutation.type === 'create_task') {
        // Task creation would go here
        await addMessage({
          role: 'assistant',
          content: `Task creation is not yet implemented. Proposed: "${mutation.title}"`,
        })
      }

      setPendingMutation(null)
    } catch (error) {
      console.error('[EpicChatPanel] Error applying mutation:', error)
      await addMessage({
        role: 'assistant',
        content: 'Failed to apply the change. Please try again or make the change manually.',
      })
    } finally {
      setIsApplyingMutation(false)
    }
  }, [workspaceRoot, epicId, loadTasks, addMessage])

  // Handle mutation dismiss
  const handleDismissMutation = React.useCallback(() => {
    setPendingMutation(null)
  }, [])

  // Handle keyboard submit
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  // Handle clear history
  const handleClear = React.useCallback(() => {
    if (window.confirm('Clear all chat history for this epic?')) {
      clearHistory()
    }
  }, [clearHistory])

  // Handle send from starter prompt (free-form — set draft and immediately fire send)
  const handleSendMessage = React.useCallback((message: string) => {
    setDraft(message)
    // Use requestAnimationFrame so the draft state update is flushed before handleSend reads it
    requestAnimationFrame(() => {
      // We can't call handleSend because it reads `draft` from the closure.
      // Instead, directly add user message and fire IPC.
      const trimmed = message.trim()
      if (!trimmed || isProcessingRef.current) return

      const { command, args } = parseSlashCommand(trimmed)

      // Use the same logic as handleSend but with the explicit message
      addMessage({ role: 'user', content: trimmed }).then(() => {
        setDraft('')

        if (command === 'plan') {
          setIsProcessing(true)
          executePlanCommand(epicId, workspaceRoot)
            .then(async (response) => {
              await addMessage({ role: 'assistant', content: response })
              if (!response.startsWith('Failed to generate plan')) {
                setHasPendingPlan(true)
              }
              const mutation = parseMutationFromResponse(response)
              if (mutation) setPendingMutation(mutation)
              await saveMessages()
            })
            .catch(async () => {
              await addMessage({
                role: 'assistant',
                content: 'Sorry, I encountered an error processing your request. Please try again.',
              })
            })
            .finally(() => setIsProcessing(false))
          return
        }

        setIsProcessing(true)
        setIsStreaming(true)
        streamContentRef.current = ''

        const commandType: ChatCommandType = command === 'interview'
          ? 'interview'
          : command === 'review'
            ? 'review'
            : 'chat'

        const userMessage = args || trimmed

        const placeholderMessage: EpicChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
        }
        setMessages((prev) => [...prev, placeholderMessage])

        const currentMessages = messagesRef.current
        const historySlice = currentMessages
          .filter((m) => m.content !== '' && !m.id.startsWith('error-'))
          .slice(-MAX_HISTORY_MESSAGES)
          .map((m) => ({ role: m.role, content: m.content }))

        lastSendParamsRef.current = { message: userMessage, commandType, history: historySlice }

        window.electronAPI.flowEpicChatSend(
          workspaceRoot,
          epicId,
          commandType,
          userMessage,
          historySlice,
          registeredProjects.map((p) => ({ path: p.path, name: p.name }))
        )
      })
    })
  }, [epicId, workspaceRoot, addMessage, setDraft, saveMessages, setMessages, registeredProjects])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-muted-foreground text-sm">
          Loading chat history...
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-3 border-b border-border/50 titlebar-no-drag">
        <MessageCircle className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium flex-1">Epic Chat</span>
        {isProcessing && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 titlebar-no-drag text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleStop}
            title="Stop generating"
          >
            <Square className="h-3 w-3 fill-current" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 titlebar-no-drag"
          onClick={handleClear}
          disabled={messages.length === 0}
          title="Clear chat history"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 titlebar-no-drag"
          onClick={onClose}
          title="Close chat panel"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <div className="relative flex-1 overflow-hidden">
        <ScrollArea className="h-full" viewportRef={scrollRef as React.RefObject<HTMLDivElement>}>
          <div className="p-3 space-y-3">
            <AnimatePresence mode="wait">
            {messages.length === 0 ? (
              <SmartEmptyState
                key="empty-state"
                epicTitle={epic?.title || epicId}
                tasks={tasks}
                onInsertCommand={handleInsertCommand}
                onSendMessage={handleSendMessage}
              />
            ) : (
              messages.map((message, index) => {
                const isLastMessage = index === messages.length - 1
                const isErrorMessage = message.id.startsWith('error-')

                if (isErrorMessage) {
                  return (
                    <ErrorMessageBubble
                      key={message.id}
                      message={message}
                      onRetry={handleRetry}
                    />
                  )
                }

                return (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isStreaming={isLastMessage && isStreaming && message.role === 'assistant'}
                  />
                )
              })
            )}
            </AnimatePresence>

            {/* Processing indicator (shown when waiting for first token) */}
            {isProcessing && !isStreaming && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2 text-muted-foreground text-sm"
              >
                <div className="flex gap-1">
                  <motion.div
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
                    className="w-1.5 h-1.5 rounded-full bg-current"
                  />
                  <motion.div
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: 0.1 }}
                    className="w-1.5 h-1.5 rounded-full bg-current"
                  />
                  <motion.div
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }}
                    className="w-1.5 h-1.5 rounded-full bg-current"
                  />
                </div>
                <span>Thinking...</span>
              </motion.div>
            )}
          </div>
        </ScrollArea>

        {/* Scroll to bottom button */}
        <AnimatePresence>
          {showScrollButton && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="absolute bottom-2 right-4"
            >
              <Button
                variant="secondary"
                size="icon"
                className="h-7 w-7 rounded-full shadow-minimal"
                onClick={scrollToBottom}
                title="Scroll to bottom"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Pending mutation */}
      <AnimatePresence>
        {pendingMutation && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-3 pb-2"
          >
            <WriteConfirmation
              mutation={pendingMutation}
              isApplying={isApplyingMutation}
              onApply={handleApplyMutation}
              onDismiss={handleDismissMutation}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* PRD-002: Plan approval bar */}
      <AnimatePresence>
        {hasPendingPlan && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-3 pb-2"
          >
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-success/5 border border-success/20">
              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
              <span className="text-xs text-foreground flex-1">
                Plan ready for approval
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleReplan}
                disabled={isApprovingPlan}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Re-plan
              </Button>
              <Button
                size="sm"
                className="h-7 px-3 text-xs bg-success/10 text-success hover:bg-success/20 border border-success/30"
                onClick={handleApprovePlan}
                disabled={isApprovingPlan}
              >
                {isApprovingPlan ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Creating tasks...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Approve Plan
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PRD-002: Plan progress indicator */}
      <AnimatePresence>
        {planProgress && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-3 pb-2"
          >
            <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-500/5 border border-blue-500/20">
              <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin shrink-0" />
              <span className="text-xs text-muted-foreground">{planProgress}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input area — no attachment buttons for epic chat */}
      <div className="p-3 border-t border-border/50 space-y-2">
        {/* Dynamic starter suggestions — shown even when messages exist */}
        {messages.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {getStarterPrompts(tasks).map((starter) => (
              <button
                key={starter.label}
                onClick={() => {
                  if (starter.command) {
                    handleInsertCommand(starter.command)
                  } else if (starter.message) {
                    handleSendMessage(starter.message)
                  }
                }}
                disabled={isProcessing}
                className={cn(
                  'px-2 py-1 rounded-full text-[11px]',
                  'bg-foreground/5 hover:bg-foreground/10',
                  'text-foreground/60 hover:text-foreground',
                  'border border-border/30 hover:border-border/50',
                  'transition-colors duration-150 cursor-pointer',
                  'max-w-[200px] truncate',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {starter.label}
              </button>
            ))}
          </div>
        )}
        <ChatActionButtons
          onInsertCommand={handleInsertCommand}
          disabled={isProcessing}
        />
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this epic..."
            disabled={isProcessing}
            className="min-h-[60px] max-h-[120px] resize-none"
          />
          {isProcessing ? (
            <Button
              variant="destructive"
              size="icon"
              onClick={handleStop}
              className="h-[60px] w-10 shrink-0"
              title="Stop generating"
            >
              <Square className="h-4 w-4 fill-current" />
            </Button>
          ) : (
            <Button
              variant="default"
              size="icon"
              onClick={handleSend}
              disabled={!draft.trim() || isProcessing}
              className="h-[60px] w-10 shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Plan Command ────────────────────────────────────────────────────────────

/**
 * Execute the /plan command via IPC to the planning agent.
 * Returns a formatted markdown response with the task breakdown.
 */
async function executePlanCommand(
  epicId: string,
  workspaceRoot: string,
): Promise<string> {
  const result = await window.electronAPI.flowEpicPlan(workspaceRoot, epicId)

  if (!result.ok) {
    return `Failed to generate plan: ${result.error || 'Unknown error'}\n\nPlease try again.`
  }

  const { tasks, reasoning, estimatedTotal } = result.data

  // Format tasks as readable markdown
  const taskLines = tasks.map((task, i) => {
    const deps = task.dependsOn.length > 0
      ? ` _(depends on: ${task.dependsOn.map(d => `Task ${d}`).join(', ')})_`
      : ''
    const files = task.fileTargets.length > 0
      ? `\n   Files: \`${task.fileTargets.join('`, `')}\``
      : ''
    return `${i + 1}. **${task.title}** [${task.complexity}]${deps}\n   ${task.description}${files}`
  }).join('\n\n')

  return `## Plan for ${epicId}

${reasoning}

**Estimated total: ${estimatedTotal}**

### Tasks

${taskLines}

---
**${tasks.length} tasks generated.** Click **Approve Plan** to create these as flowctl tasks, or edit the plan and re-run \`/plan\`.`
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function EpicChatPanel({
  epicId,
  workspaceRoot,
  isOpen,
  onToggle,
  children,
  className,
}: EpicChatPanelProps) {
  // Save draft on blur/unmount
  const draftAtom = epicId ? chatDraftAtomFamily(epicId) : null
  const [draft, setDraft] = useAtom(draftAtom ?? atomWithStorage('__unused__', ''))

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      // Draft is auto-saved via atomWithStorage
    }
  }, [])

  return (
    <div className={cn('flex h-full overflow-hidden', className)}>
      {/* Main content */}
      <div className="flex-1 min-w-0 h-full relative z-panel">{children}</div>

      {/* Chat panel - matches AISuggestionSidebar pattern */}
      <AnimatePresence initial={false}>
        {isOpen && epicId && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={springTransition}
            className="h-full border-l border-border/50 bg-background flex flex-col overflow-hidden relative z-panel"
          >
            <ChatContent epicId={epicId} workspaceRoot={workspaceRoot} onClose={onToggle} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Chat Toggle Button ───────────────────────────────────────────────────────

export interface ChatToggleButtonProps {
  isOpen: boolean
  onClick: () => void
  className?: string
}

export function ChatToggleButton({ isOpen, onClick, className }: ChatToggleButtonProps) {
  return (
    <Button
      variant={isOpen ? 'secondary' : 'ghost'}
      size="sm"
      onClick={onClick}
      className={cn('gap-1.5', className)}
    >
      <MessageCircle className="h-4 w-4" />
      <span>Chat</span>
    </Button>
  )
}
