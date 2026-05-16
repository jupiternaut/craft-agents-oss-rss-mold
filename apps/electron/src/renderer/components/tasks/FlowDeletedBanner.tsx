/**
 * FlowDeletedBanner
 *
 * Banner shown in the Tasks view when .flow/ directory is detected as removed
 * (flowStatus reverts to 'needs-setup' on a previously initialized project).
 * Offers a "Re-initialize" action to restore .flow/ via flowctl init or
 * launch the onboarding wizard.
 */

import * as React from 'react'
import { AlertTriangle, RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export interface FlowDeletedBannerProps {
  /** Called when user clicks Re-initialize */
  onReinitialize: () => void
  /** Called when user dismisses the banner */
  onDismiss: () => void
  /** Whether re-initialization is in progress */
  isReinitializing?: boolean
  /** Optional className */
  className?: string
}

export function FlowDeletedBanner({
  onReinitialize,
  onDismiss,
  isReinitializing = false,
  className,
}: FlowDeletedBannerProps) {
  return (
    <div
      className={cn(
        'relative flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3',
        className,
      )}
      role="alert"
      aria-label=".flow/ directory was removed"
    >
      {/* Warning icon */}
      <div className="flex items-center justify-center rounded-md bg-amber-500/10 p-1.5 mt-0.5 shrink-0">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          .flow/ was removed
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          The flow-next directory was deleted or moved. Re-initialize to restore task tracking.
        </p>
        <div className="mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onReinitialize}
            disabled={isReinitializing}
            className="gap-1.5 h-7 text-xs"
          >
            <RotateCcw className="h-3 w-3" />
            {isReinitializing ? 'Re-initializing...' : 'Re-initialize'}
          </Button>
        </div>
      </div>

      {/* Dismiss button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={onDismiss}
        aria-label="Dismiss .flow/ removed banner"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
