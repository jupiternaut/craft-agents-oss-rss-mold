/**
 * TaskSpecTab
 *
 * Tab content that displays the task specification as rendered markdown.
 * Fetches spec content from the task's spec_path file.
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Markdown } from '@/components/markdown'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TaskSpecTabProps {
  /** Spec file path from task object */
  specPath: string
  /** Optional className */
  className?: string
}

type LoadingState = 'idle' | 'loading' | 'success' | 'error'

export function TaskSpecTab({ specPath, className }: TaskSpecTabProps) {
  const [content, setContent] = React.useState<string>('')
  const [loadingState, setLoadingState] = React.useState<LoadingState>('idle')
  const [error, setError] = React.useState<string | null>(null)

  // Fetch spec content when specPath changes
  React.useEffect(() => {
    if (!specPath) {
      setError('No spec path available')
      setLoadingState('error')
      return
    }

    setLoadingState('loading')
    setError(null)

    window.electronAPI
      .readFile(specPath)
      .then((fileContent: string) => {
        setContent(fileContent)
        setLoadingState('success')
      })
      .catch((err: Error) => {
        const errorMsg = err.message || 'Failed to load spec'
        setError(errorMsg)
        setLoadingState('error')
        toast.error('Failed to load task spec', {
          description: errorMsg,
        })
      })
  }, [specPath])

  // Loading state
  if (loadingState === 'loading') {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Error state
  if (loadingState === 'error') {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <p className="text-sm text-muted-foreground">{error || 'Failed to load spec'}</p>
      </div>
    )
  }

  // Empty content
  if (!content) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <p className="text-sm text-muted-foreground">No spec content available</p>
      </div>
    )
  }

  return (
    <ScrollArea className={cn('h-full', className)}>
      <div className="p-4">
        <Markdown mode="full">{content}</Markdown>
      </div>
    </ScrollArea>
  )
}
