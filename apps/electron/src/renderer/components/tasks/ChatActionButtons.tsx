/**
 * ChatActionButtons
 *
 * Action buttons for epic chat that insert slash commands.
 * Provides quick access to /plan, /interview, /review operations.
 */

import * as React from 'react'
import { Lightbulb, MessageCircle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'

export interface ChatActionButtonsProps {
  /** Callback when a slash command is selected */
  onInsertCommand: (command: string) => void
  /** Whether the chat is currently processing */
  disabled?: boolean
  /** Optional className */
  className?: string
}

interface ActionButton {
  id: string
  command: string
  label: string
  description: string
  icon: React.ElementType
}

const actionButtons: ActionButton[] = [
  {
    id: 'plan',
    command: '/plan',
    label: 'Plan',
    description: 'Generate a detailed plan for this epic',
    icon: Lightbulb,
  },
  {
    id: 'interview',
    command: '/interview',
    label: 'Interview',
    description: 'Ask clarifying questions about requirements',
    icon: MessageCircle,
  },
  {
    id: 'review',
    command: '/review',
    label: 'Review',
    description: 'Review the epic plan or completed work',
    icon: CheckCircle2,
  },
]

export function ChatActionButtons({
  onInsertCommand,
  disabled = false,
  className,
}: ChatActionButtonsProps) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {actionButtons.map((action) => {
        const Icon = action.icon
        return (
          <Tooltip key={action.id}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onInsertCommand(action.command)}
                className="h-7 px-2 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{action.label}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              <p className="text-xs">{action.description}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Type <code className="px-1 py-0.5 bg-foreground/10 rounded text-[10px]">{action.command}</code>
              </p>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

// ─── Slash Command Parser ─────────────────────────────────────────────────────

export type SlashCommand = 'plan' | 'interview' | 'review' | null

/**
 * Parse input text for slash commands.
 * Returns the command type if found at the start of the input.
 */
export function parseSlashCommand(input: string): {
  command: SlashCommand
  args: string
} {
  const trimmed = input.trim()

  if (trimmed.startsWith('/plan')) {
    return { command: 'plan', args: trimmed.slice(5).trim() }
  }
  if (trimmed.startsWith('/interview')) {
    return { command: 'interview', args: trimmed.slice(10).trim() }
  }
  if (trimmed.startsWith('/review')) {
    return { command: 'review', args: trimmed.slice(7).trim() }
  }

  return { command: null, args: trimmed }
}
