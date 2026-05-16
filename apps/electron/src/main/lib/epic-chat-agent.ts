/**
 * EpicChatAgent — Real AI chat for epic context
 *
 * Handles all epic chat LLM calls (free-form, /interview, /review) with
 * streaming responses. Streams text deltas to the renderer via IPC.
 *
 * Architecture:
 *   EpicChatPanel -> IPC(FLOW_EPIC_CHAT_SEND) -> EpicChatAgent
 *                 <- IPC(FLOW_EPIC_CHAT_STATUS) <- streaming text events
 */

import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, basename } from 'path'
import type { BrowserWindow } from 'electron'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChatCommandType = 'interview' | 'review' | 'chat'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface RegisteredProject {
  path: string
  name: string
}

export interface EpicChatParams {
  epicId: string
  commandType: ChatCommandType
  message: string
  history: ChatMessage[]
  workspaceRoot: string
  window: BrowserWindow
  registeredProjects?: RegisteredProject[]
}

export type EpicChatEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'text_complete' }
  | { type: 'error'; errorType: 'rate_limit' | 'auth' | 'network' | 'invalid_response'; message: string }

// ─── Active Stream Tracking ──────────────────────────────────────────────────

const activeStreams = new Map<string, AbortController>()

function getStreamKey(workspaceRoot: string, epicId: string): string {
  return `${workspaceRoot}:${epicId}`
}

/**
 * Abort an active stream for a given workspace+epic combination.
 * Returns true if an active stream was found and aborted.
 */
export function abortChat(workspaceRoot: string, epicId: string): boolean {
  const key = getStreamKey(workspaceRoot, epicId)
  const controller = activeStreams.get(key)
  if (controller) {
    controller.abort()
    activeStreams.delete(key)
    return true
  }
  return false
}

// ─── Context Gathering ───────────────────────────────────────────────────────

function readEpicSpec(workspaceRoot: string, epicId: string): string | null {
  const specPath = join(workspaceRoot, '.flow', 'specs', `${epicId}.md`)
  try {
    return readFileSync(specPath, 'utf-8')
  } catch {
    return null
  }
}

function readTaskList(workspaceRoot: string, epicId: string): string {
  const tasksDir = join(workspaceRoot, '.flow', 'tasks')
  try {
    if (!existsSync(tasksDir)) return 'No tasks found.'

    const files = require('fs').readdirSync(tasksDir) as string[]
    const taskFiles = files.filter(
      (f: string) => f.startsWith(epicId + '.') && f.endsWith('.json'),
    )

    if (taskFiles.length === 0) return 'No tasks found for this epic.'

    const tasks: string[] = []
    for (const file of taskFiles) {
      try {
        const content = readFileSync(join(tasksDir, file), 'utf-8')
        const task = JSON.parse(content) as {
          id?: string
          title?: string
          status?: string
        }
        tasks.push(`- [${task.status || 'unknown'}] ${task.id || file}: ${task.title || 'Untitled'}`)
      } catch {
        // Skip unreadable task files
      }
    }

    return tasks.length > 0 ? tasks.join('\n') : 'No tasks found for this epic.'
  } catch {
    return 'Unable to read tasks.'
  }
}

function readProjectName(workspaceRoot: string): string {
  const pkgPath = join(workspaceRoot, 'package.json')
  try {
    if (existsSync(pkgPath)) {
      const content = readFileSync(pkgPath, 'utf-8')
      const pkg = JSON.parse(content) as { name?: string }
      if (pkg.name && typeof pkg.name === 'string') return pkg.name
    }
  } catch {
    // Fall through to basename
  }
  return basename(workspaceRoot)
}

function readProjectLearnings(workspaceRoot: string): string | null {
  try {
    const learningsPath = join(workspaceRoot, 'learnings.md')
    if (!existsSync(learningsPath)) return null
    const learnings = readFileSync(learningsPath, 'utf-8')
    return learnings && learnings.trim() ? learnings : null
  } catch {
    return null
  }
}

// ─── Flow Memory Reader ─────────────────────────────────────────────────────

/**
 * Read all `.flow/memory/*.md` files from a project root.
 * Returns concatenated content or null if no memory files exist.
 */
function readFlowMemory(projectRoot: string): string | null {
  const memoryDir = join(projectRoot, '.flow', 'memory')
  try {
    if (!existsSync(memoryDir)) return null

    const files = readdirSync(memoryDir).filter((f: string) => f.endsWith('.md'))
    if (files.length === 0) return null

    const entries: string[] = []
    for (const file of files) {
      try {
        const content = readFileSync(join(memoryDir, file), 'utf-8').trim()
        if (content) {
          const topic = file.replace(/\.md$/, '')
          entries.push(`### ${topic}\n${content}`)
        }
      } catch {
        // Skip unreadable files
      }
    }

    return entries.length > 0 ? entries.join('\n\n') : null
  } catch {
    return null
  }
}

// ─── Cross-Project Context Cache ────────────────────────────────────────────

/** Cache entry for cross-project context */
interface ContextCacheEntry {
  context: string
  timestamp: number
}

/** 30-minute TTL for cross-project context cache */
const CROSS_PROJECT_CACHE_TTL_MS = 30 * 60 * 1000

/** Cache keyed by workspace root */
const crossProjectCache = new Map<string, ContextCacheEntry>()

/** Max total chars for cross-project context (~6000 chars = ~2000 tokens) */
const MAX_CROSS_PROJECT_CHARS = 6000

/** Max chars per individual project entry */
const MAX_PER_PROJECT_CHARS = 2000

/**
 * Gather cross-project knowledge context from registered flow projects.
 *
 * Reads `learnings.md` and `.flow/memory/*.md` from each registered project
 * (excluding the current workspace). Results are cached with 30-minute TTL.
 *
 * Returns a formatted context block or null if no cross-project knowledge exists.
 */
export function gatherCrossProjectContext(
  currentWorkspaceRoot: string,
  registeredProjects: RegisteredProject[],
): string | null {
  // Check cache
  const cached = crossProjectCache.get(currentWorkspaceRoot)
  if (cached && Date.now() - cached.timestamp < CROSS_PROJECT_CACHE_TTL_MS) {
    return cached.context || null
  }

  // Filter out current project
  const otherProjects = registeredProjects.filter(
    (p) => p.path !== currentWorkspaceRoot,
  )

  if (otherProjects.length === 0) {
    crossProjectCache.set(currentWorkspaceRoot, { context: '', timestamp: Date.now() })
    return null
  }

  // Collect learnings per project with size info for prioritization
  const projectEntries: Array<{ name: string; content: string; size: number }> = []

  for (const project of otherProjects) {
    const parts: string[] = []

    // Read learnings.md
    try {
      const learningsPath = join(project.path, 'learnings.md')
      if (existsSync(learningsPath)) {
        const learnings = readFileSync(learningsPath, 'utf-8').trim()
        if (learnings) {
          parts.push(learnings)
        }
      }
    } catch {
      // Skip unreadable learnings
    }

    // Read .flow/memory/*.md
    const memory = readFlowMemory(project.path)
    if (memory) {
      parts.push(memory)
    }

    if (parts.length > 0) {
      let content = parts.join('\n\n')
      // Truncate individual entry if too large
      if (content.length > MAX_PER_PROJECT_CHARS) {
        content = content.slice(0, MAX_PER_PROJECT_CHARS) + '\n...(truncated)'
      }
      const name = project.name || basename(project.path)
      projectEntries.push({ name, content, size: content.length })
    }
  }

  if (projectEntries.length === 0) {
    crossProjectCache.set(currentWorkspaceRoot, { context: '', timestamp: Date.now() })
    return null
  }

  // Prioritize projects with more learnings (sort descending by size)
  projectEntries.sort((a, b) => b.size - a.size)

  // Build aggregated context within budget
  const sections: string[] = []
  let totalChars = 0

  for (const entry of projectEntries) {
    const section = `### ${entry.name}\n${entry.content}`
    if (totalChars + section.length > MAX_CROSS_PROJECT_CHARS) {
      // Try to fit a truncated version
      const remaining = MAX_CROSS_PROJECT_CHARS - totalChars
      if (remaining > 200) {
        sections.push(`### ${entry.name}\n${entry.content.slice(0, remaining - 50)}\n...(truncated)`)
      }
      break
    }
    sections.push(section)
    totalChars += section.length
  }

  const context = sections.join('\n\n')
  crossProjectCache.set(currentWorkspaceRoot, { context, timestamp: Date.now() })
  return context || null
}

/**
 * Build the current project's memory context from `.flow/memory/` files.
 * Separate from learnings.md — this captures topic-specific memory files.
 */
function gatherCurrentProjectMemory(workspaceRoot: string): string | null {
  return readFlowMemory(workspaceRoot)
}

// ─── System Prompt Builder ───────────────────────────────────────────────────

interface BuildSystemPromptParams {
  commandType: ChatCommandType
  epicSpec: string | null
  taskContext: string
  projectMetadata: { name: string }
  extraContext?: string
}

/**
 * Build a system prompt for the epic chat agent.
 *
 * The `extraContext` parameter injects cross-project knowledge and
 * current project memory (`.flow/memory/` files) into the prompt.
 */
export function buildSystemPrompt(params: BuildSystemPromptParams): string {
  const { commandType, epicSpec, taskContext, projectMetadata, extraContext } = params

  const commandInstructions = getCommandInstructions(commandType)

  let prompt = `You are an AI assistant helping with software development for the project "${projectMetadata.name}".

${commandInstructions}

## Epic Specification
${epicSpec || 'No epic specification available.'}

## Current Tasks
${taskContext}
`

  // Cross-project knowledge + current project memory
  if (extraContext) {
    prompt += `\n## Cross-Project Context\n${extraContext}\n`
  }

  return prompt
}

function getCommandInstructions(commandType: ChatCommandType): string {
  switch (commandType) {
    case 'interview':
      return `## Role: Requirements Interviewer

You are conducting a requirements elicitation interview for this epic. Your goal is to:
- Ask targeted, specific questions about unclear requirements
- Help the user think through edge cases and constraints
- Identify missing acceptance criteria
- Suggest potential technical approaches and trade-offs
- Build understanding incrementally through conversation

Ask one or two focused questions at a time. Do not overwhelm the user with too many questions at once. Build on their answers to dig deeper.`

    case 'review':
      return `## Role: Epic Analyst

You are reviewing this epic's specification and current progress. Your goal is to:
- Analyze the epic spec for completeness, clarity, and feasibility
- Review the current task breakdown and identify gaps
- Flag potential risks, blockers, or architectural concerns
- Suggest improvements to the spec or task structure
- Assess overall progress and remaining effort

Provide a structured, actionable review. Be specific about what's good and what needs attention.`

    case 'chat':
      return `## Role: Development Assistant

You are a helpful development assistant with context about this epic and its tasks. Your goal is to:
- Answer questions about the epic, its tasks, and implementation approach
- Help with technical decisions and trade-offs
- Suggest solutions to implementation challenges
- Provide code guidance when asked
- Help prioritize and plan work

Be concise and practical. Reference the epic spec and task list when relevant.`
  }
}

// ─── Chat Executor ───────────────────────────────────────────────────────────

/**
 * Execute a chat interaction with the LLM.
 *
 * Streams text deltas to the renderer window via IPC. Handles
 * cancellation via AbortController. Returns when streaming is complete.
 */
export async function executeChat(params: EpicChatParams): Promise<void> {
  const { epicId, commandType, message, history, workspaceRoot, window, registeredProjects } = params
  const streamKey = getStreamKey(workspaceRoot, epicId)

  // Abort any existing stream for this workspace+epic
  const existingController = activeStreams.get(streamKey)
  if (existingController) {
    existingController.abort()
    activeStreams.delete(streamKey)
  }

  const abortController = new AbortController()
  activeStreams.set(streamKey, abortController)

  const sendEvent = (event: EpicChatEvent) => {
    if (!window.isDestroyed()) {
      window.webContents.send('flow:epic-chat-status', { epicId, ...event })
    }
  }

  try {
    // Gather context
    const epicSpec = readEpicSpec(workspaceRoot, epicId)
    const taskContext = readTaskList(workspaceRoot, epicId)
    const projectName = readProjectName(workspaceRoot)
    const learnings = readProjectLearnings(workspaceRoot)

    // Gather cross-project context and current project memory
    const crossProjectContext = registeredProjects && registeredProjects.length > 0
      ? gatherCrossProjectContext(workspaceRoot, registeredProjects)
      : null
    const currentProjectMemory = gatherCurrentProjectMemory(workspaceRoot)

    // Build extra context block combining cross-project knowledge + current memory
    const extraParts: string[] = []

    if (currentProjectMemory) {
      extraParts.push(`### Current Project Memory\n${currentProjectMemory}`)
    }

    if (crossProjectContext) {
      extraParts.push(
        `### Patterns from other projects\nThese learnings come from other projects in this workspace. Suggest relevant improvements where applicable:\n\n${crossProjectContext}`,
      )
    }

    const extraContext = extraParts.length > 0 ? extraParts.join('\n\n') : undefined

    // Build system prompt
    let systemPrompt = buildSystemPrompt({
      commandType,
      epicSpec,
      taskContext,
      projectMetadata: { name: projectName },
      extraContext,
    })

    // Add project learnings if available
    if (learnings) {
      systemPrompt += `\n## Project Learnings\n${learnings}\n`
    }

    // Use the Claude Agent SDK query() — same subprocess + auth as the native chat.
    // This handles API key, OAuth, and custom base URLs identically.
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const { loadStoredConfig, DEFAULT_MODEL } = await import('@craft-agent/shared/config')

    const config = loadStoredConfig()
    const defaultConnection = config?.llmConnections?.find((connection) => connection.slug === config.defaultLlmConnection)
    const model = defaultConnection?.defaultModel || DEFAULT_MODEL

    // Build the full prompt with conversation history baked in
    let prompt = message
    if (history.length > 0) {
      const historyBlock = history
        .map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`)
        .join('\n\n')
      prompt = `Here is the conversation so far:\n\n${historyBlock}\n\nNow respond to the latest user message:\n\n${message}`
    }

    const q = query({
      prompt,
      options: {
        systemPrompt,
        model,
        tools: [],
        maxTurns: 1,
        persistSession: false,
        includePartialMessages: true,
        abortController,
      },
    })

    // Stream SDK messages, forwarding text deltas to the renderer
    for await (const sdkMessage of q) {
      if (abortController.signal.aborted) break

      if (sdkMessage.type === 'stream_event') {
        const event = sdkMessage.event
        // content_block_delta with text_delta carries the streaming text
        if (event.type === 'content_block_delta' && 'delta' in event) {
          const delta = event.delta as { type: string; text?: string }
          if (delta.type === 'text_delta' && delta.text) {
            sendEvent({ type: 'text_delta', text: delta.text })
          }
        }
      }
    }

    if (!abortController.signal.aborted) {
      sendEvent({ type: 'text_complete' })
    }
  } catch (error) {
    // Don't send error events if the stream was intentionally aborted
    if (abortController.signal.aborted) return

    const chatError = classifyError(error)
    sendEvent(chatError)
  } finally {
    activeStreams.delete(streamKey)
  }
}

// ─── Error Classification ────────────────────────────────────────────────────

function classifyError(error: unknown): EpicChatEvent {
  if (error instanceof Error) {
    const message = error.message

    // Check for Anthropic API error status codes
    const statusMatch = (error as { status?: number }).status
    if (statusMatch === 429) {
      return {
        type: 'error',
        errorType: 'rate_limit',
        message: 'Rate limit exceeded. Please wait a moment and try again.',
      }
    }
    if (statusMatch === 401) {
      return {
        type: 'error',
        errorType: 'auth',
        message: 'Authentication failed. Please check your API key in Settings.',
      }
    }

    // Network errors
    if (
      message.includes('ECONNREFUSED') ||
      message.includes('ENOTFOUND') ||
      message.includes('ETIMEDOUT') ||
      message.includes('fetch failed') ||
      message.includes('network')
    ) {
      return {
        type: 'error',
        errorType: 'network',
        message: 'Network error. Please check your internet connection and try again.',
      }
    }

    // Invalid response
    if (message.includes('invalid') || message.includes('parse')) {
      return {
        type: 'error',
        errorType: 'invalid_response',
        message: `Invalid response from API: ${message}`,
      }
    }

    // Default to network for unknown errors
    return {
      type: 'error',
      errorType: 'network',
      message: `An error occurred: ${message}`,
    }
  }

  return {
    type: 'error',
    errorType: 'network',
    message: 'An unexpected error occurred.',
  }
}
