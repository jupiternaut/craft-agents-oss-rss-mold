import { describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SkillMomentRunJobManager } from './jobs'

function makeWorkspace(): string {
  const root = join(tmpdir(), `craft-skill-moments-jobs-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(root, { recursive: true })
  return root
}

describe('SkillMomentRunJobManager', () => {
  it('starts a run asynchronously and records status events', async () => {
    const root = makeWorkspace()
    const events: string[] = []
    try {
      const manager = new SkillMomentRunJobManager()
      const started = manager.startRun({
        rootPath: root,
        input: { workspaceId: 'workspace-1', roomId: 'debate' },
        emitStatus: (event) => events.push(event.phase),
        executor: async (input, emitStatus) => {
          emitStatus({
            workspaceId: input.workspaceId,
            roomId: input.roomId || 'debate',
            runId: input.runId,
            phase: 'writing',
            message: 'writing',
            createdAt: new Date().toISOString(),
          })
          return {
            success: true,
            runId: input.runId!,
            moments: [],
            sourceDigests: [],
            path: root,
          }
        },
      })

      expect(started.state).toBe('started')
      expect(started.moments).toEqual([])

      const job = await manager.waitForRun(started.runId)
      expect(job.state).toBe('succeeded')
      expect(job.result?.state).toBe('completed')
      expect(job.events.some((event) => event.phase === 'writing')).toBe(true)
      expect(job.events.some((event) => event.phase === 'complete')).toBe(true)
      expect(events).toContain('planning')
      expect(events).toContain('writing')
      expect(events).toContain('complete')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects concurrent runs for the same workspace room', async () => {
    const root = makeWorkspace()
    try {
      const manager = new SkillMomentRunJobManager()
      const started = manager.startRun({
        rootPath: root,
        input: { workspaceId: 'workspace-1', roomId: 'debate' },
        executor: async (input) => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return {
            success: true,
            runId: input.runId!,
            moments: [],
            sourceDigests: [],
            path: root,
          }
        },
      })

      expect(() => manager.startRun({
        rootPath: root,
        input: { workspaceId: 'workspace-1', roomId: 'debate' },
        executor: async (input) => ({
          success: true,
          runId: input.runId!,
          moments: [],
          sourceDigests: [],
          path: root,
        }),
      })).toThrow('already running')

      await manager.waitForRun(started.runId)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
