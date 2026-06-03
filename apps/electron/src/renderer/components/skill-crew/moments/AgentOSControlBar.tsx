import * as React from 'react'
import { Loader2, RefreshCw, Radio, Settings2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type AgentOSControlBarProps = {
  roomLabel: string
  mode: 'moments' | 'agentos'
  running: boolean
  loading: boolean
  momentCount: number
  criticCount: number
  lastRunPath?: string
  onRefresh: () => void
}

export function AgentOSControlBar({
  roomLabel,
  mode,
  running,
  loading,
  momentCount,
  criticCount,
  lastRunPath,
  onRefresh,
}: AgentOSControlBarProps) {
  return (
    <div className="border-b border-border/60 bg-background px-6 py-4">
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-3">
        <div className="grid size-9 place-items-center rounded-[8px] bg-foreground text-background">
          {mode === 'agentos' ? <Settings2 className="size-4" /> : <Radio className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold text-foreground">
              {mode === 'agentos' ? 'AgentOS' : 'Skill Moments'}
            </h2>
            <span className="rounded-[5px] bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] text-muted-foreground">
              #{roomLabel}
            </span>
            <span className={cn(
              'rounded-[5px] px-1.5 py-0.5 text-[11px]',
              running ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-foreground/[0.06] text-muted-foreground',
            )}>
              {running ? 'running' : 'manual'}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{momentCount} moments</span>
            <span>{criticCount} critiques</span>
            {lastRunPath ? <span className="truncate">stored: {lastRunPath}</span> : null}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={onRefresh}
          disabled={running || loading}
          className="h-8 rounded-[7px]"
        >
          {running ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 size-3.5" />}
          刷新朋友圈
        </Button>
      </div>
    </div>
  )
}
