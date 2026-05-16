/**
 * ErrorRecoveryPanel
 *
 * Guided error recovery UI for FlowBridge failures.
 * Provides contextual recovery options based on error type.
 *
 * Error Types:
 * - flowctl_not_found: Install guidance + path explanation
 * - invalid_output: Corrupt data + view raw JSON + revert option
 * - invalid_json: Similar to invalid_output, shows raw stdout
 * - command_failed: Error message + retry + report issue
 * - timeout: Timeout message + retry + check process
 *
 * Features:
 * - Replaces normal content in error area (not a modal)
 * - Circuit breaker: stops auto-retry after 3 consecutive failures per command type
 * - Reset circuit breaker on first success
 */

import * as React from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  AlertCircle,
  RefreshCw,
  ExternalLink,
  FileWarning,
  Clock,
  Terminal,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Bug,
} from 'lucide-react'
import type { FlowBridgeError } from '../../../shared/flow-schemas'

// ─── Circuit Breaker ───────────────────────────────────────────────────────────
// Circuit breaker state is persisted to localStorage to survive app restarts.
// State is keyed by command type (e.g., "epic-list", "task-update-status").

/** Max consecutive failures before circuit opens */
const MAX_FAILURES = 3

/** localStorage key prefix for circuit breaker state */
const CIRCUIT_BREAKER_KEY_PREFIX = 'craft-flow-circuit-breaker-'

/**
 * Get failure count from localStorage.
 */
function getStoredFailureCount(commandType: string): number {
  try {
    const stored = localStorage.getItem(`${CIRCUIT_BREAKER_KEY_PREFIX}${commandType}`)
    if (stored) {
      const count = parseInt(stored, 10)
      return isNaN(count) ? 0 : count
    }
  } catch {
    // localStorage not available
  }
  return 0
}

/**
 * Set failure count in localStorage.
 */
function setStoredFailureCount(commandType: string, count: number): void {
  try {
    if (count === 0) {
      localStorage.removeItem(`${CIRCUIT_BREAKER_KEY_PREFIX}${commandType}`)
    } else {
      localStorage.setItem(`${CIRCUIT_BREAKER_KEY_PREFIX}${commandType}`, String(count))
    }
  } catch {
    // localStorage not available
  }
}

/**
 * Circuit breaker state for a command type.
 * Returns true if circuit is open (should not retry).
 */
export function isCircuitOpen(commandType: string): boolean {
  return getStoredFailureCount(commandType) >= MAX_FAILURES
}

/**
 * Record a failure for a command type.
 * Increments failure count and returns whether circuit is now open.
 */
export function recordFailure(commandType: string): boolean {
  const count = getStoredFailureCount(commandType) + 1
  setStoredFailureCount(commandType, count)
  console.log(`[CircuitBreaker] ${commandType}: ${count}/${MAX_FAILURES} failures`)
  return count >= MAX_FAILURES
}

/**
 * Reset circuit breaker for a command type (on success).
 */
export function resetCircuit(commandType: string): void {
  const count = getStoredFailureCount(commandType)
  if (count > 0) {
    console.log(`[CircuitBreaker] ${commandType}: reset on success`)
    setStoredFailureCount(commandType, 0)
  }
}

/**
 * Reset all circuit breakers (e.g., on workspace change).
 */
export function resetAllCircuits(): void {
  try {
    // Find and remove all circuit breaker keys
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(CIRCUIT_BREAKER_KEY_PREFIX)) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key))
  } catch {
    // localStorage not available
  }
}

/**
 * Get failure count for a command type (public API).
 */
export function getFailureCount(commandType: string): number {
  return getStoredFailureCount(commandType)
}

// ─── Component Props ───────────────────────────────────────────────────────────

export interface ErrorRecoveryPanelProps {
  /** The error to display */
  error: FlowBridgeError
  /** Command type that caused the error (for circuit breaker) */
  commandType: string
  /** Called when user clicks Retry */
  onRetry: () => void
  /** Called when user clicks Install (for flowctl_not_found) */
  onInstall?: () => void
  /** Called when user clicks Report Issue */
  onReportIssue?: () => void
  /** Raw JSON data (for invalid_output/invalid_json errors) */
  rawData?: string
  /** Whether retry is disabled (circuit open) */
  retryDisabled?: boolean
  /** Optional className */
  className?: string
}

// ─── Sub-components ────────────────────────────────────────────────────────────

interface ErrorHeaderProps {
  icon: React.ReactNode
  title: string
  description: string
}

function ErrorHeader({ icon, title, description }: ErrorHeaderProps) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="p-2 rounded-lg bg-destructive/10 text-destructive">
        {icon}
      </div>
      <div>
        <h3 className="font-semibold text-base">{title}</h3>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  )
}

interface RawDataViewerProps {
  data: string
  label?: string
}

function RawDataViewer({ data, label = 'Raw Output' }: RawDataViewerProps) {
  const [isExpanded, setIsExpanded] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(data)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [data])

  return (
    <div className="mt-4 border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center justify-between bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
      >
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Terminal className="h-3.5 w-3.5" />
          {label}
        </span>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="relative">
            <pre className="p-3 text-xs font-mono text-muted-foreground bg-foreground/[0.02] overflow-x-auto max-h-48 overflow-y-auto">
              {data}
            </pre>
            <button
              onClick={handleCopy}
              className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 hover:bg-background border border-border/50 transition-colors"
              title="Copy to clipboard"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          </div>
        </motion.div>
      )}
    </div>
  )
}

interface CircuitBreakerWarningProps {
  commandType: string
  failureCount: number
}

function CircuitBreakerWarning({ commandType, failureCount }: CircuitBreakerWarningProps) {
  return (
    <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-700 dark:text-amber-500">
            Auto-retry disabled
          </p>
          <p className="text-xs text-amber-600/80 dark:text-amber-500/80 mt-0.5">
            {failureCount} consecutive failures for "{commandType}". Manual retry still available.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Error-specific Panels ─────────────────────────────────────────────────────

function FlowctlNotFoundPanel({
  onRetry,
  onInstall,
  className,
}: Pick<ErrorRecoveryPanelProps, 'onRetry' | 'onInstall' | 'className'>) {
  return (
    <div className={cn('p-4', className)}>
      <ErrorHeader
        icon={<Terminal className="h-5 w-5" />}
        title="flowctl not found"
        description="The Flow-Next CLI tool is not installed or not in your PATH."
      />

      <div className="space-y-3">
        <div className="p-3 rounded-lg bg-foreground/[0.02] border border-border/50">
          <h4 className="text-sm font-medium mb-2">Installation Options</h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="font-mono text-xs bg-foreground/5 px-1.5 py-0.5 rounded">1</span>
              <span>Add flowctl to your project's <code className="text-xs bg-foreground/5 px-1 rounded">.flow/bin/</code> directory</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono text-xs bg-foreground/5 px-1.5 py-0.5 rounded">2</span>
              <span>Or install globally: <code className="text-xs bg-foreground/5 px-1 rounded">npm i -g @flow-next/cli</code></span>
            </li>
          </ul>
        </div>

        <div className="flex items-center gap-2">
          {onInstall && (
            <Button variant="default" size="sm" onClick={onInstall} className="gap-1.5">
              <ExternalLink className="h-3.5 w-3.5" />
              Installation Guide
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      </div>
    </div>
  )
}

function InvalidOutputPanel({
  error,
  rawData,
  onRetry,
  onReportIssue,
  commandType,
  retryDisabled,
  className,
}: ErrorRecoveryPanelProps & { error: { type: 'invalid_output' | 'invalid_json' } }) {
  const failureCount = getFailureCount(commandType)

  return (
    <div className={cn('p-4', className)}>
      <ErrorHeader
        icon={<FileWarning className="h-5 w-5" />}
        title="Corrupt Data Detected"
        description={
          error.type === 'invalid_json'
            ? 'flowctl returned invalid JSON that could not be parsed.'
            : 'flowctl output did not match expected schema.'
        }
      />

      {retryDisabled && (
        <CircuitBreakerWarning commandType={commandType} failureCount={failureCount} />
      )}

      <div className="flex items-center gap-2 mt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
        {onReportIssue && (
          <Button variant="ghost" size="sm" onClick={onReportIssue} className="gap-1.5">
            <Bug className="h-3.5 w-3.5" />
            Report Issue
          </Button>
        )}
      </div>

      {rawData && <RawDataViewer data={rawData} label="View Raw JSON" />}

      {error.type === 'invalid_output' && 'zodError' in error && (
        <RawDataViewer
          data={JSON.stringify(error.zodError.issues, null, 2)}
          label="Validation Errors"
        />
      )}
    </div>
  )
}

function CommandFailedPanel({
  error,
  onRetry,
  onReportIssue,
  commandType,
  retryDisabled,
  className,
}: ErrorRecoveryPanelProps & { error: { type: 'command_failed'; stderr: string; exitCode: number } }) {
  const failureCount = getFailureCount(commandType)

  return (
    <div className={cn('p-4', className)}>
      <ErrorHeader
        icon={<AlertCircle className="h-5 w-5" />}
        title="Command Failed"
        description={`flowctl exited with code ${error.exitCode}`}
      />

      {retryDisabled && (
        <CircuitBreakerWarning commandType={commandType} failureCount={failureCount} />
      )}

      <div className="mt-3 p-3 rounded-lg bg-destructive/5 border border-destructive/10">
        <pre className="text-xs font-mono text-destructive/80 whitespace-pre-wrap break-words">
          {error.stderr || 'No error message provided'}
        </pre>
      </div>

      <div className="flex items-center gap-2 mt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
        {onReportIssue && (
          <Button variant="ghost" size="sm" onClick={onReportIssue} className="gap-1.5">
            <Bug className="h-3.5 w-3.5" />
            Report Issue
          </Button>
        )}
      </div>
    </div>
  )
}

function TimeoutPanel({
  error,
  onRetry,
  commandType,
  retryDisabled,
  className,
}: ErrorRecoveryPanelProps & { error: { type: 'timeout'; command: string } }) {
  const failureCount = getFailureCount(commandType)

  return (
    <div className={cn('p-4', className)}>
      <ErrorHeader
        icon={<Clock className="h-5 w-5" />}
        title="Command Timed Out"
        description="flowctl did not respond within the expected time."
      />

      {retryDisabled && (
        <CircuitBreakerWarning commandType={commandType} failureCount={failureCount} />
      )}

      <div className="mt-3 p-3 rounded-lg bg-foreground/[0.02] border border-border/50">
        <p className="text-sm text-muted-foreground mb-2">
          <span className="font-medium">Command:</span>{' '}
          <code className="text-xs bg-foreground/5 px-1.5 py-0.5 rounded">{error.command}</code>
        </p>
        <p className="text-xs text-muted-foreground">
          This may indicate a stuck process or system resource issue.
        </p>
      </div>

      <div className="flex items-center gap-2 mt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.electronAPI?.openUrl('https://docs.flow-next.dev/troubleshooting')}
          className="gap-1.5"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Troubleshooting Guide
        </Button>
      </div>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function ErrorRecoveryPanel({
  error,
  commandType,
  onRetry,
  onInstall,
  onReportIssue,
  rawData,
  retryDisabled,
  className,
}: ErrorRecoveryPanelProps) {
  const commonProps = {
    onRetry,
    onInstall,
    onReportIssue,
    rawData,
    commandType,
    retryDisabled,
    className,
  }

  switch (error.type) {
    case 'flowctl_not_found':
      return <FlowctlNotFoundPanel {...commonProps} />

    case 'invalid_output':
    case 'invalid_json':
      return <InvalidOutputPanel {...commonProps} error={error as any} />

    case 'command_failed':
      return <CommandFailedPanel {...commonProps} error={error} />

    case 'timeout':
      return <TimeoutPanel {...commonProps} error={error} />

    default:
      // Fallback for unknown error types
      return (
        <div className={cn('p-4', className)}>
          <ErrorHeader
            icon={<AlertCircle className="h-5 w-5" />}
            title="Unknown Error"
            description="An unexpected error occurred."
          />
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="gap-1.5 mt-4"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      )
  }
}
