import { join } from 'path'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { RPC_CHANNELS, type SkillFile } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skills.GET,
  RPC_CHANNELS.skills.GET_FILES,
  RPC_CHANNELS.skills.READ_CONTENT,
  RPC_CHANNELS.skills.LIST_FOLDERS,
  RPC_CHANNELS.skills.CREATE_FOLDER,
  RPC_CHANNELS.skills.MOVE,
  RPC_CHANNELS.skills.SAVE_CONTENT,
  RPC_CHANNELS.skills.DELETE,
  RPC_CHANNELS.skills.OPEN_EDITOR,
  RPC_CHANNELS.skills.OPEN_FINDER,
] as const

export function registerSkillsHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Get all skills for a workspace (and optionally project-level skills from workingDirectory)
  server.handle(RPC_CHANNELS.skills.GET, async (_ctx, workspaceId: string, workingDirectory?: string) => {
    deps.platform.logger?.info(`SKILLS_GET: Loading skills for workspace: ${workspaceId}${workingDirectory ? `, workingDirectory: ${workingDirectory}` : ''}`)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    // Validate workingDirectory exists on this server — a thin client may pass
    // its local path which doesn't exist on the remote server's filesystem.
    const effectiveWorkingDir = workingDirectory && existsSync(workingDirectory)
      ? workingDirectory
      : undefined
    const { loadAllSkills } = await import('@craft-agent/shared/skills')
    const skills = loadAllSkills(workspace.rootPath, effectiveWorkingDir)
    deps.platform.logger?.info(`SKILLS_GET: Loaded ${skills.length} skills from ${workspace.rootPath}`)
    return skills
  })

  // Get files in a skill directory
  server.handle(RPC_CHANNELS.skills.GET_FILES, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET_FILES: Workspace not found: ${workspaceId}`)
      return []
    }

    const { loadSkill } = await import('@craft-agent/shared/skills')
    const skill = loadSkill(workspace.rootPath, skillSlug)
    if (!skill) return []

    const skillDir = skill.path

    function scanDirectory(dirPath: string): SkillFile[] {
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true })
        return entries
          .filter(entry => !entry.name.startsWith('.')) // Skip hidden files
          .map(entry => {
            const fullPath = join(dirPath, entry.name)
            if (entry.isDirectory()) {
              return {
                name: entry.name,
                type: 'directory' as const,
                children: scanDirectory(fullPath),
              }
            } else {
              const stats = statSync(fullPath)
              return {
                name: entry.name,
                type: 'file' as const,
                size: stats.size,
              }
            }
          })
          .sort((a, b) => {
            // Directories first, then files
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
            return a.name.localeCompare(b.name)
          })
      } catch (err) {
        deps.platform.logger?.error(`SKILLS_GET_FILES: Error scanning ${dirPath}:`, err)
        return []
      }
    }

    return scanDirectory(skillDir)
  })

  // Read the raw SKILL.md file for in-app inspection/editing.
  server.handle(RPC_CHANNELS.skills.READ_CONTENT, async (_ctx, workspaceId: string, skillSlug: string, workingDirectory?: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const effectiveWorkingDir = workingDirectory && existsSync(workingDirectory)
      ? workingDirectory
      : undefined
    const { loadSkillBySlug } = await import('@craft-agent/shared/skills')
    const skill = loadSkillBySlug(workspace.rootPath, skillSlug, effectiveWorkingDir)
    if (!skill) throw new Error(`Skill not found: ${skillSlug}`)

    const path = join(skill.path, 'SKILL.md')
    return { content: readFileSync(path, 'utf-8'), path }
  })

  // List workspace skill folders / Crew rooms under {workspace}/skills.
  server.handle(RPC_CHANNELS.skills.LIST_FOLDERS, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listSkillFolders } = await import('@craft-agent/shared/skills')
    return listSkillFolders(workspace.rootPath)
  })

  // Create a workspace skill folder / Crew room under {workspace}/skills.
  server.handle(RPC_CHANNELS.skills.CREATE_FOLDER, async (_ctx, workspaceId: string, folderPath: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { createSkillFolder } = await import('@craft-agent/shared/skills')
    const path = createSkillFolder(workspace.rootPath, folderPath)
    deps.platform.logger?.info(`Created skill folder: ${folderPath}`)
    return { path }
  })

  // Move a workspace skill folder into a Crew room.
  server.handle(RPC_CHANNELS.skills.MOVE, async (_ctx, workspaceId: string, skillSlug: string, targetFolderPath: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { moveWorkspaceSkill } = await import('@craft-agent/shared/skills')
    const moved = moveWorkspaceSkill(workspace.rootPath, skillSlug, targetFolderPath)
    if (!moved) throw new Error(`Skill not found: ${skillSlug}`)

    deps.platform.logger?.info(`Moved skill ${skillSlug} to ${targetFolderPath}`)
    return moved
  })

  // Save a skill SKILL.md file, including frontmatter and instructions.
  server.handle(RPC_CHANNELS.skills.SAVE_CONTENT, async (_ctx, workspaceId: string, skillSlug: string, content: string, workingDirectory?: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('Skill content cannot be empty')
    }

    const effectiveWorkingDir = workingDirectory && existsSync(workingDirectory)
      ? workingDirectory
      : undefined
    const { loadSkillBySlug, invalidateSkillsCache } = await import('@craft-agent/shared/skills')
    const skill = loadSkillBySlug(workspace.rootPath, skillSlug, effectiveWorkingDir)
    if (!skill) throw new Error(`Skill not found: ${skillSlug}`)

    const skillFile = join(skill.path, 'SKILL.md')
    writeFileSync(skillFile, content.endsWith('\n') ? content : `${content}\n`, 'utf-8')
    invalidateSkillsCache()

    const saved = loadSkillBySlug(workspace.rootPath, skillSlug, effectiveWorkingDir)
    if (!saved) throw new Error(`Saved skill could not be reloaded: ${skillSlug}`)
    deps.platform.logger?.info(`Saved skill content: ${skillSlug}`)
    return saved
  })

  // Delete a skill from a workspace
  server.handle(RPC_CHANNELS.skills.DELETE, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteSkill } = await import('@craft-agent/shared/skills')
    deleteSkill(workspace.rootPath, skillSlug)
    deps.platform.logger?.info(`Deleted skill: ${skillSlug}`)
  })

  // Open skill SKILL.md in editor
  server.handle(RPC_CHANNELS.skills.OPEN_EDITOR, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Open in editor is not available for remote workspaces')

    const { loadSkill } = await import('@craft-agent/shared/skills')
    const skill = loadSkill(workspace.rootPath, skillSlug)
    if (!skill) throw new Error(`Skill not found: ${skillSlug}`)

    const skillFile = join(skill.path, 'SKILL.md')
    await deps.platform.openPath?.(skillFile)
  })

  // Open skill folder in Finder/Explorer
  server.handle(RPC_CHANNELS.skills.OPEN_FINDER, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Show in Finder is not available for remote workspaces')

    const { loadSkill } = await import('@craft-agent/shared/skills')
    const skill = loadSkill(workspace.rootPath, skillSlug)
    if (!skill) throw new Error(`Skill not found: ${skillSlug}`)

    await deps.platform.showItemInFolder?.(skill.path)
  })
}
