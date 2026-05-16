/**
 * PlanningAgent — PRD-002: /plan Command Execution
 *
 * Takes an epic (title + spec) and workspace context, then produces
 * a structured task breakdown via LLM. Streams progress events back
 * to the renderer via IPC.
 *
 * Architecture:
 *   EpicChatPanel → IPC(FLOW_EPIC_PLAN) → PlanningAgent → FlowBridge.addTasksFromPlan()
 *                 ← IPC(FLOW_EPIC_PLAN_STATUS) ← streaming progress events
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative, extname } from 'path'
import type { BrowserWindow } from 'electron'
import type { FlowBridge } from './flow-bridge'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlanTask {
  title: string
  description: string
  complexity: 'S' | 'M' | 'L'
  fileTargets: string[]
  dependsOn: string[]  // references by index: "1", "2", etc.
}

export interface PlanResult {
  epicId: string
  tasks: PlanTask[]
  reasoning: string
  estimatedTotal: string
}

export interface PlanProgressEvent {
  type: 'progress' | 'tasks' | 'error' | 'complete'
  message?: string
  tasks?: PlanTask[]
  reasoning?: string
  estimatedTotal?: string
  error?: string
}

// ─── Codebase Context Gatherer ────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '.flow',
  '__pycache__', '.venv', 'venv', 'coverage', '.turbo', '.cache',
])

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go',
  '.md', '.json', '.yaml', '.yml', '.toml',
])

/**
 * Build a file tree string for the workspace (max depth 3).
 * Lightweight context for the LLM to understand project structure.
 */
function buildFileTree(root: string, maxDepth = 3): string {
  const lines: string[] = []

  function walk(dir: string, prefix: string, depth: number) {
    if (depth > maxDepth) return

    let entries: string[]
    try {
      entries = readdirSync(dir).sort()
    } catch {
      return
    }

    // Filter ignored dirs and hidden files
    entries = entries.filter(e => !IGNORE_DIRS.has(e) && !e.startsWith('.'))

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const fullPath = join(dir, entry)
      const isLast = i === entries.length - 1
      const connector = isLast ? '└── ' : '├── '
      const childPrefix = isLast ? '    ' : '│   '

      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          lines.push(`${prefix}${connector}${entry}/`)
          walk(fullPath, prefix + childPrefix, depth + 1)
        } else if (CODE_EXTENSIONS.has(extname(entry))) {
          lines.push(`${prefix}${connector}${entry}`)
        }
      } catch {
        // Skip unreadable entries
      }
    }
  }

  walk(root, '', 0)
  return lines.join('\n')
}

/**
 * Read the epic spec file content.
 */
function readEpicSpec(workspaceRoot: string, epicId: string): string | null {
  const specPath = join(workspaceRoot, '.flow', 'specs', `${epicId}.md`)
  try {
    return readFileSync(specPath, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Read key config files for additional context.
 */
function readKeyFiles(workspaceRoot: string): string {
  const candidates = [
    'package.json',
    'tsconfig.json',
    'README.md',
    'AGENTS.md',
    'CLAUDE.md',
  ]

  const parts: string[] = []
  for (const file of candidates) {
    const fullPath = join(workspaceRoot, file)
    try {
      if (existsSync(fullPath)) {
        const content = readFileSync(fullPath, 'utf-8')
        // Truncate large files
        const truncated = content.length > 2000
          ? content.slice(0, 2000) + '\n... (truncated)'
          : content
        parts.push(`--- ${file} ---\n${truncated}`)
      }
    } catch {
      // Skip unreadable files
    }
  }

  return parts.join('\n\n')
}

// ─── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(epicId: string, epicSpec: string, fileTree: string, keyFiles: string): string {
  return `You are a senior software architect planning the implementation of an epic.

## Epic: ${epicId}

### Epic Specification
${epicSpec || 'No specification provided. Plan based on the epic title and codebase context.'}

### Project Structure
\`\`\`
${fileTree}
\`\`\`

### Key Files
${keyFiles}

## Your Task

Analyze the epic specification and codebase structure. Produce a **detailed, actionable task breakdown** that a developer can execute sequentially.

## Output Format

You MUST output a single JSON code block with this exact structure:

\`\`\`json
{
  "tasks": [
    {
      "title": "Short imperative title (e.g., 'Add WebSocket endpoint for P&L streaming')",
      "description": "What to implement and why. Include acceptance criteria. 2-4 sentences.",
      "complexity": "S|M|L",
      "fileTargets": ["src/path/to/file.ts", "src/other/file.ts"],
      "dependsOn": []
    },
    {
      "title": "Second task",
      "description": "Description...",
      "complexity": "M",
      "fileTargets": ["src/file.ts"],
      "dependsOn": ["1"]
    }
  ],
  "reasoning": "Brief explanation of your planning approach and key architectural decisions.",
  "estimatedTotal": "~8-12 hours"
}
\`\`\`

## Rules

1. Tasks should be **ordered by dependency** — a task's dependsOn references are 1-indexed task numbers
2. Each task should be completable in a **single focused session** (1-4 hours)
3. **fileTargets** should reference actual files from the project structure when possible
4. Complexity: S = <1h, M = 1-3h, L = 3-6h
5. Include a testing task for any non-trivial feature
6. Front-load infrastructure/setup tasks, back-load polish/testing
7. Be specific — "Add X to Y" not "Implement the feature"
8. Output ONLY the JSON block, no other text before or after it`
}

// ─── Plan Executor ────────────────────────────────────────────────────────────

/**
 * Execute the planning agent for an epic.
 *
 * Sends progress events to the renderer window via IPC.
 * Returns the final PlanResult or throws on error.
 */
export async function executePlan(
  workspaceRoot: string,
  epicId: string,
  window: BrowserWindow,
  flowBridge: FlowBridge,
): Promise<PlanResult> {
  const sendProgress = (event: PlanProgressEvent) => {
    if (!window.isDestroyed()) {
      window.webContents.send('flow:epic-plan-status', { epicId, ...event })
    }
  }

  try {
    // Phase 1: Gather context
    sendProgress({ type: 'progress', message: 'Reading epic specification...' })
    const epicSpec = readEpicSpec(workspaceRoot, epicId)

    sendProgress({ type: 'progress', message: 'Analyzing project structure...' })
    const fileTree = buildFileTree(workspaceRoot)
    const keyFiles = readKeyFiles(workspaceRoot)

    // Phase 2: Build prompt and call LLM
    sendProgress({ type: 'progress', message: 'Planning task breakdown...' })
    const systemPrompt = buildSystemPrompt(epicId, epicSpec || '', fileTree, keyFiles)

    // Use Anthropic API directly for the planning call
    // This avoids coupling to the session/agent infrastructure
    const { Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic()

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        { role: 'user', content: systemPrompt },
      ],
    })

    // Phase 3: Parse response
    sendProgress({ type: 'progress', message: 'Parsing task breakdown...' })

    const responseText = response.content
      .filter((block) => block.type === 'text')
      .map(block => 'text' in block ? block.text : '')
      .join('\n')

    // Extract JSON from code block
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/)
    if (!jsonMatch) {
      throw new Error('Planning agent did not produce a valid JSON task breakdown')
    }

    const planData = JSON.parse(jsonMatch[1]) as {
      tasks: PlanTask[]
      reasoning: string
      estimatedTotal: string
    }

    if (!planData.tasks || !Array.isArray(planData.tasks) || planData.tasks.length === 0) {
      throw new Error('Planning agent produced empty task list')
    }

    const result: PlanResult = {
      epicId,
      tasks: planData.tasks,
      reasoning: planData.reasoning || '',
      estimatedTotal: planData.estimatedTotal || 'Unknown',
    }

    // Send tasks to renderer for review
    sendProgress({
      type: 'tasks',
      tasks: result.tasks,
      reasoning: result.reasoning,
      estimatedTotal: result.estimatedTotal,
    })

    return result

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown planning error'
    sendProgress({ type: 'error', error: errorMessage })
    throw error
  }
}

/**
 * Apply an approved plan — create tasks via flowctl.
 *
 * Called after user reviews and approves the generated plan.
 */
export async function applyPlan(
  workspaceRoot: string,
  epicId: string,
  tasks: PlanTask[],
  flowBridge: FlowBridge,
  window: BrowserWindow,
): Promise<void> {
  const sendProgress = (event: PlanProgressEvent) => {
    if (!window.isDestroyed()) {
      window.webContents.send('flow:epic-plan-status', { epicId, ...event })
    }
  }

  // Build the spec content with task breakdown for flowctl set-plan
  const specLines: string[] = []
  specLines.push(`# Implementation Plan\n`)

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]
    const deps = task.dependsOn.length > 0
      ? ` (depends on: ${task.dependsOn.map(d => `Task ${d}`).join(', ')})`
      : ''
    specLines.push(`## Task ${i + 1}: ${task.title} [${task.complexity}]${deps}`)
    specLines.push(``)
    specLines.push(task.description)
    if (task.fileTargets.length > 0) {
      specLines.push(`\nFiles: ${task.fileTargets.join(', ')}`)
    }
    specLines.push(``)
  }

  const specContent = specLines.join('\n')

  sendProgress({ type: 'progress', message: `Creating ${tasks.length} tasks...` })

  // Use set-plan to update the epic spec with the task breakdown
  // flowctl will parse the ## Task headers and create tasks
  const result = await flowBridge.setEpicPlan(epicId, specContent)

  if (!result.ok) {
    const errorMsg = result.error.type === 'command_failed'
      ? result.error.stderr
      : `Failed to apply plan: ${result.error.type}`
    sendProgress({ type: 'error', error: errorMsg })
    throw new Error(errorMsg)
  }

  sendProgress({
    type: 'complete',
    message: `Created ${tasks.length} tasks for ${epicId}`,
  })
}
