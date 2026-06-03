import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  Bot,
  ChevronRight,
  Copy,
  Crown,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Info,
  Loader2,
  MoveRight,
  Pencil,
  Plus,
  Save,
  Search,
  Sparkles,
  UserPlus,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  DEFAULT_SKILL_CREW_ROOMS,
  inferSkillCrewRoomId,
  inferSkillPhysicalFolderId,
  skillCrewChannelAtom,
  skillCrewPlacementAtom,
} from '@/atoms/skill-crew'
import { skillsAtom } from '@/atoms/skills'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
  StyledContextMenuSeparator,
  StyledContextMenuSub,
  StyledContextMenuSubContent,
  StyledContextMenuSubTrigger,
} from '@/components/ui/styled-context-menu'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

import type { LoadedSkill, SkillFolder } from '../../../shared/types'

type CrewFolder = {
  id: string
  label: string
  description: string
  relativePath: string
  physicalPath: string
  parentId: string | null
  builtin?: boolean
}

const ROOM_DESCRIPTIONS: Record<string, string> = {
  debate: '董事长主持的多 skill 辩论',
  design: '产品、界面和角色设定',
  build: '实现路径、验证和交付',
  policy: '申报、规则和外部约束',
  screenplay: '剧本工件和连续性审阅',
}

const ROOM_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  debate: Crown,
  design: Sparkles,
  build: Folder,
  policy: FileText,
  screenplay: FileText,
}

const SOURCE_LABELS: Record<LoadedSkill['source'], string> = {
  global: 'global',
  workspace: 'workspace',
  project: 'project',
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index > 0 ? path.slice(0, index) : path
}

function skillFilePath(skill: LoadedSkill): string {
  return `${skill.path}/SKILL.md`
}

function sanitizeFolderName(value: string): string {
  return (
    value
      .trim()
      .replace(/^#+/, '')
      .replace(/[@\s]+/g, '-')
      .replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '')
      .replace(/^-+|-+$/g, '') || 'new-room'
  )
}

function buildBuiltinFolders(workspaceRootPath?: string): CrewFolder[] {
  const crewRoot = workspaceRootPath ? `${workspaceRootPath}/skills` : '~/.agents/skills'

  return DEFAULT_SKILL_CREW_ROOMS.map((room) => ({
    id: room,
    label: room,
    description: ROOM_DESCRIPTIONS[room] ?? 'Crew room',
    relativePath: room,
    physicalPath: `${crewRoot}/${room}`,
    parentId: null,
    builtin: true,
  }))
}

function folderFromSkillFolder(folder: SkillFolder): CrewFolder {
  return {
    id: folder.relativePath,
    label: folder.name,
    description: '物理 Crew 文件夹',
    relativePath: folder.relativePath,
    physicalPath: folder.path,
    parentId: folder.parentPath,
  }
}

function copyText(value: string, label: string): void {
  void navigator.clipboard.writeText(value)
  toast.success(`已复制${label}`)
}

function shortPath(path: string): string {
  if (path.startsWith('/Users/gengrf/')) {
    return `~/${path.slice('/Users/gengrf/'.length)}`
  }
  return path
}

export function SkillCrewNavigatorPanel() {
  const skills = useAtomValue(skillsAtom)
  const setSkills = useSetAtom(skillsAtom)
  const activeWorkspace = useActiveWorkspace()
  const { activeWorkspaceId, activeSessionWorkingDirectory } = useAppShellContext()
  const [activeChannel, setActiveChannel] = useAtom(skillCrewChannelAtom)
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(DEFAULT_SKILL_CREW_ROOMS))
  const [customFolders, setCustomFolders] = React.useState<CrewFolder[]>([])
  const [skillPlacement, setSkillPlacement] = useAtom(skillCrewPlacementAtom)
  const [draggingSkillSlug, setDraggingSkillSlug] = React.useState<string | null>(null)
  const [addSkillOpen, setAddSkillOpen] = React.useState(false)
  const [addSkillDefault, setAddSkillDefault] = React.useState('创建一个新的 Crew skill。')
  const [importSkillOpen, setImportSkillOpen] = React.useState(false)
  const [importTargetFolderId, setImportTargetFolderId] = React.useState<string | null>(null)
  const [importQuery, setImportQuery] = React.useState('')
  const [importingSkillSlug, setImportingSkillSlug] = React.useState<string | null>(null)
  const [inspectedSkillSlug, setInspectedSkillSlug] = React.useState<string | null>(null)
  const [skillFileDraft, setSkillFileDraft] = React.useState('')
  const [skillFilePathDraft, setSkillFilePathDraft] = React.useState('')
  const [skillFileLoading, setSkillFileLoading] = React.useState(false)
  const [skillFileSaving, setSkillFileSaving] = React.useState(false)

  const folders = React.useMemo(
    () => {
      const builtinFolders = buildBuiltinFolders(activeWorkspace?.rootPath)
      const builtinIds = new Set(builtinFolders.map((folder) => folder.id))
      return [...builtinFolders, ...customFolders.filter((folder) => !builtinIds.has(folder.id))]
    },
    [activeWorkspace?.rootPath, customFolders],
  )

  const folderById = React.useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])
  const folderIds = React.useMemo(() => folders.map((folder) => folder.id), [folders])
  const inspectedSkill = React.useMemo(
    () => skills.find((skill) => skill.slug === inspectedSkillSlug) ?? null,
    [inspectedSkillSlug, skills],
  )
  const importTargetFolder = React.useMemo(
    () => folderById.get(importTargetFolderId ?? activeChannel) ?? folderById.get('debate') ?? folders[0] ?? null,
    [activeChannel, folderById, folders, importTargetFolderId],
  )

  const skillsByFolder = React.useMemo(() => {
    const groups = new Map<string, LoadedSkill[]>()

    for (const folder of folders) {
      groups.set(folder.id, [])
    }

    for (const skill of skills) {
      const folderId = skillPlacement[skill.slug] ?? inferSkillPhysicalFolderId(skill, folderIds) ?? inferSkillCrewRoomId(skill)
      const target = groups.has(folderId) ? folderId : 'build'
      groups.get(target)?.push(skill)
    }

    for (const group of groups.values()) {
      group.sort((a, b) => a.slug.localeCompare(b.slug))
    }

    return groups
  }, [folderIds, folders, skillPlacement, skills])

  const getSkillFolderId = React.useCallback((skill: LoadedSkill) => (
    skillPlacement[skill.slug] ?? inferSkillPhysicalFolderId(skill, folderIds) ?? inferSkillCrewRoomId(skill)
  ), [folderIds, skillPlacement])

  const importSkillCandidates = React.useMemo(() => {
    const query = importQuery.trim().toLocaleLowerCase()
    return skills
      .filter((skill) => skill.slug !== 'chairman')
      .filter((skill) => {
        if (!query) {
          return true
        }

        const haystack = [
          skill.slug,
          skill.metadata.name,
          skill.metadata.description,
          skill.path,
          skill.source,
        ].filter(Boolean).join(' ').toLocaleLowerCase()
        return haystack.includes(query)
      })
      .sort((a, b) => {
        const sourceOrder = sourceRank(a.source) - sourceRank(b.source)
        return sourceOrder === 0 ? a.slug.localeCompare(b.slug) : sourceOrder
      })
      .slice(0, 80)
  }, [importQuery, skills])

  const childFoldersByParent = React.useMemo(() => {
    const groups = new Map<string | null, CrewFolder[]>()

    for (const folder of folders) {
      const siblings = groups.get(folder.parentId) ?? []
      siblings.push(folder)
      groups.set(folder.parentId, siblings)
    }

    for (const group of groups.values()) {
      group.sort((a, b) => {
        const orderDelta = builtinOrder(a.id) - builtinOrder(b.id)
        return orderDelta === 0 ? a.label.localeCompare(b.label) : orderDelta
      })
    }

    return groups
  }, [folders])

  const addSkillConfig = activeWorkspace ? getEditConfig('add-skill', activeWorkspace.rootPath) : null

  const refreshSkills = React.useCallback(async () => {
    if (!activeWorkspaceId) {
      return
    }

    const loaded = await window.electronAPI.getSkills(activeWorkspaceId, activeSessionWorkingDirectory)
    setSkills(loaded || [])
  }, [activeSessionWorkingDirectory, activeWorkspaceId, setSkills])

  React.useEffect(() => {
    if (!activeWorkspaceId) {
      return
    }
    if (typeof window.electronAPI.getSkillFolders !== 'function') {
      return
    }

    let cancelled = false
    window.electronAPI.getSkillFolders(activeWorkspaceId)
      .then((loaded) => {
        if (cancelled) {
          return
        }

        const physicalFolders = loaded.map(folderFromSkillFolder)
        setCustomFolders((current) => {
          const transientFolders = current.filter((folder) => !physicalFolders.some((physical) => physical.id === folder.id))
          return [...physicalFolders, ...transientFolders]
        })
      })
      .catch((error) => {
        console.error('[SkillCrew] Failed to load skill folders:', error)
      })

    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId])

  React.useEffect(() => {
    if (!activeWorkspaceId || !inspectedSkillSlug) {
      setSkillFileDraft('')
      setSkillFilePathDraft('')
      return
    }

    let cancelled = false
    setSkillFileLoading(true)
    window.electronAPI.readSkillContent(activeWorkspaceId, inspectedSkillSlug, activeSessionWorkingDirectory)
      .then((result) => {
        if (cancelled) return
        setSkillFileDraft(result.content)
        setSkillFilePathDraft(result.path)
      })
      .catch((error) => {
        if (cancelled) return
        toast.error(`读取 @${inspectedSkillSlug} 失败`, {
          description: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        if (!cancelled) setSkillFileLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeSessionWorkingDirectory, activeWorkspaceId, inspectedSkillSlug])

  const saveInspectedSkill = React.useCallback(async () => {
    if (!activeWorkspaceId || !inspectedSkill) {
      return
    }

    setSkillFileSaving(true)
    try {
      await window.electronAPI.saveSkillContent(
        activeWorkspaceId,
        inspectedSkill.slug,
        skillFileDraft,
        activeSessionWorkingDirectory,
      )
      await refreshSkills()
      toast.success(`已保存 @${inspectedSkill.slug}`)
    } catch (error) {
      toast.error(`保存 @${inspectedSkill.slug} 失败`, {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSkillFileSaving(false)
    }
  }, [activeSessionWorkingDirectory, activeWorkspaceId, inspectedSkill, refreshSkills, skillFileDraft])

  const openSkillInspector = React.useCallback((skill: LoadedSkill) => {
    setInspectedSkillSlug(skill.slug)
  }, [])

  const toggleFolder = React.useCallback((folderId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(folderId)) {
        next.delete(folderId)
      } else {
        next.add(folderId)
      }
      return next
    })
  }, [])

  const createFolder = React.useCallback(
    async (parentId: string | null) => {
      const parent = parentId ? folderById.get(parentId) : null
      const rawName = window.prompt(parent ? `在 #${parent.label} 下新建 Crew 文件夹` : '新建 Crew 文件夹', 'new-room')

      if (!rawName) {
        return
      }

      const slug = sanitizeFolderName(rawName)
      const id = parentId ? `${parentId}/${slug}` : slug
      const relativePath = parent?.relativePath ? `${parent.relativePath}/${slug}` : slug
      const rootPath = parent?.physicalPath ?? (activeWorkspace?.rootPath ? `${activeWorkspace.rootPath}/skills` : '~/.agents/skills')

      if (folderById.has(id)) {
        toast.error('这个 Crew 文件夹已经存在')
        return
      }

      let physicalPath = `${rootPath}/${slug}`
      if (activeWorkspaceId && typeof window.electronAPI.createSkillFolder === 'function') {
        try {
          const created = await window.electronAPI.createSkillFolder(activeWorkspaceId, relativePath)
          physicalPath = created.path
        } catch (error) {
          toast.error('创建物理文件夹失败', {
            description: error instanceof Error ? error.message : String(error),
          })
          return
        }
      }

      const folder: CrewFolder = {
        id,
        label: slug,
        description: '自定义 Crew 聊天室',
        relativePath,
        physicalPath,
        parentId,
      }

      setCustomFolders((current) => [...current, folder])
      setExpanded((current) => {
        const next = new Set(current)
        if (parentId) {
          next.add(parentId)
        }
        next.add(id)
        return next
      })
      setActiveChannel(id)
      toast.success(`已创建 #${slug}`)
    },
    [activeWorkspace?.rootPath, activeWorkspaceId, folderById, setActiveChannel],
  )

  const beginCreateSkill = React.useCallback(
    (folder: CrewFolder | null) => {
      const target = folder ?? folderById.get(activeChannel) ?? null
      setAddSkillDefault(
        target
          ? `在 #${target.label} 创建一个 skill。要求包含角色边界、唤醒条件、发言方式、交接工作和测试用例。`
          : '创建一个新的 Crew skill。要求包含角色边界、唤醒条件、发言方式、交接工作和测试用例。',
      )
      window.setTimeout(() => setAddSkillOpen(true), 0)
    },
    [activeChannel, folderById],
  )

  const beginImportSkill = React.useCallback((folder: CrewFolder | null) => {
    const target = folder ?? folderById.get(activeChannel) ?? folderById.get('debate') ?? null
    setImportTargetFolderId(target?.id ?? null)
    setImportQuery('')
    setImportSkillOpen(true)
  }, [activeChannel, folderById])

  const moveSkill = React.useCallback(
    async (skillSlug: string, folderId: string) => {
      const folder = folderById.get(folderId)
      if (!folder) {
        return
      }

      const skill = skills.find((candidate) => candidate.slug === skillSlug)
      if (!skill) {
        return
      }

      if (skill.source === 'workspace' && activeWorkspaceId && typeof window.electronAPI.moveSkill === 'function') {
        try {
          await window.electronAPI.moveSkill(activeWorkspaceId, skillSlug, folder.relativePath)
          setSkillPlacement((current) => {
            const next = { ...current }
            delete next[skillSlug]
            return next
          })
          setExpanded((current) => new Set([...current, folderId]))
          await refreshSkills()
          toast.success(`已把 @${skillSlug} 移动到 #${folder.label}`)
          return
        } catch (error) {
          toast.error(`移动 @${skillSlug} 失败`, {
            description: error instanceof Error ? error.message : String(error),
          })
          return
        }
      }

      setSkillPlacement((current) => ({ ...current, [skillSlug]: folderId }))
      setExpanded((current) => new Set([...current, folderId]))
      toast.success(`已把 @${skillSlug} 映射到 #${folder.label}`)
    },
    [activeWorkspaceId, folderById, refreshSkills, skills],
  )

  const importInstalledSkill = React.useCallback(async (skill: LoadedSkill) => {
    if (!activeWorkspaceId || !importTargetFolder) {
      return
    }

    setImportingSkillSlug(skill.slug)
    try {
      if (skill.source === 'workspace') {
        await moveSkill(skill.slug, importTargetFolder.id)
      } else {
        await window.electronAPI.importSkillToCrewFolder({
          workspaceId: activeWorkspaceId,
          sourceSkillPath: skill.path,
          slug: skill.slug,
          targetFolderPath: importTargetFolder.relativePath,
          workingDirectory: activeSessionWorkingDirectory,
        })
        await refreshSkills()
        setExpanded((current) => new Set([...current, importTargetFolder.id]))
        setActiveChannel(importTargetFolder.id)
        toast.success(`已导入 @${skill.slug} 到 #${importTargetFolder.label}`)
      }
      setImportSkillOpen(false)
    } catch (error) {
      toast.error(`导入 @${skill.slug} 失败`, {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setImportingSkillSlug((current) => current === skill.slug ? null : current)
    }
  }, [activeSessionWorkingDirectory, activeWorkspaceId, importTargetFolder, moveSkill, refreshSkills, setActiveChannel])

  const openSkillPath = React.useCallback(async (skill: LoadedSkill) => {
    await window.electronAPI.openFile(skillFilePath(skill))
  }, [])

  const showSkillInFolder = React.useCallback(async (skill: LoadedSkill) => {
    await window.electronAPI.showInFolder(skill.path)
  }, [])

  const renderFolder = React.useCallback(
    (folder: CrewFolder, depth: number): React.ReactNode => {
      const Icon = ROOM_ICONS[folder.id] ?? Folder
      const isExpanded = expanded.has(folder.id)
      const isActive = activeChannel === folder.id
      const children = childFoldersByParent.get(folder.id) ?? []
      const folderSkills = skillsByFolder.get(folder.id) ?? []
      const hasChildren = children.length > 0 || folderSkills.length > 0

      return (
        <React.Fragment key={folder.id}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                role="button"
                tabIndex={0}
                className={`group mx-2 flex min-h-11 cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition ${
                  isActive ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted'
                } ${draggingSkillSlug ? 'ring-inset hover:ring-1 hover:ring-primary/35' : ''}`}
                style={{ paddingLeft: 8 + depth * 18 }}
                onClick={() => setActiveChannel(folder.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setActiveChannel(folder.id)
                  }
                }}
                onDragOver={(event) => {
                  if (draggingSkillSlug) {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                  }
                }}
                onDrop={(event) => {
                  const skillSlug = event.dataTransfer.getData('application/x-skill-slug')
                  if (skillSlug) {
                    event.preventDefault()
                    moveSkill(skillSlug, folder.id)
                    setDraggingSkillSlug(null)
                  }
                }}
              >
                <button
                  type="button"
                  className={`grid size-5 shrink-0 place-items-center rounded ${isActive ? 'text-background/75' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    toggleFolder(folder.id)
                  }}
                  aria-label={isExpanded ? `折叠 ${folder.label}` : `展开 ${folder.label}`}
                >
                  <ChevronRight className={`size-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </button>

                <div
                  className={`grid size-7 shrink-0 place-items-center rounded-md ${
                    isActive ? 'bg-background/15' : folder.builtin ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {isExpanded ? <FolderOpen className="size-4" /> : <Icon className="size-4" />}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">#{folder.label}</div>
                  <div className={`truncate text-xs ${isActive ? 'text-background/65' : 'text-muted-foreground'}`}>
                    {folder.description}
                  </div>
                </div>

                <span className={`text-xs ${isActive ? 'text-background/60' : 'text-muted-foreground'}`}>
                  {(folderSkills.length + children.length).toString()}
                </span>
              </div>
            </ContextMenuTrigger>
            <StyledContextMenuContent className="w-56">
              <StyledContextMenuItem onSelect={() => setActiveChannel(folder.id)}>
                <FolderOpen className="mr-2 size-4" />
                作为聊天室打开
              </StyledContextMenuItem>
              <StyledContextMenuItem onSelect={() => createFolder(folder.id)}>
                <FolderPlus className="mr-2 size-4" />
                新建子文件夹
              </StyledContextMenuItem>
              <StyledContextMenuItem onSelect={() => beginCreateSkill(folder)}>
                <Plus className="mr-2 size-4" />
                新建 Skill
              </StyledContextMenuItem>
              <StyledContextMenuItem onSelect={() => beginImportSkill(folder)}>
                <UserPlus className="mr-2 size-4" />
                导入已安装 Skill
              </StyledContextMenuItem>
              <StyledContextMenuSeparator />
              <StyledContextMenuItem onSelect={() => copyText(folder.physicalPath, '物理路径')}>
                <Copy className="mr-2 size-4" />
                复制物理路径
              </StyledContextMenuItem>
            </StyledContextMenuContent>
          </ContextMenu>

          {isExpanded && children.map((child) => renderFolder(child, depth + 1))}
          {isExpanded && folderSkills.map((skill) => renderSkill(skill, folder.id, depth + 1))}
          {isExpanded && !hasChildren ? (
            <div className="mx-2 truncate px-2 py-1 text-xs text-muted-foreground" style={{ paddingLeft: 42 + depth * 18 }}>
              空聊天室，右键可新建 skill
            </div>
          ) : null}
        </React.Fragment>
      )
    },
    [
      activeChannel,
      beginCreateSkill,
      beginImportSkill,
      childFoldersByParent,
      createFolder,
      draggingSkillSlug,
      expanded,
      moveSkill,
      renderSkill,
      setActiveChannel,
      skillsByFolder,
      toggleFolder,
    ],
  )

  const rootFolders = childFoldersByParent.get(null) ?? []

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border/70 bg-background">
      <div className="border-b border-border/60 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Crew Tree</div>
            <div className="truncate text-xs text-muted-foreground">{shortPath(activeWorkspace?.rootPath ?? '/Users/gengrf')}</div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => createFolder(null)}
              title="新建 Crew 文件夹"
            >
              <FolderPlus className="size-4" />
            </button>
            {addSkillConfig ? (
              <EditPopover
                {...addSkillConfig}
                open={addSkillOpen}
                onOpenChange={setAddSkillOpen}
                defaultValue={addSkillDefault}
                trigger={
                  <button
                    type="button"
                    className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="新建 Skill"
                  >
                    <Plus className="size-4" />
                  </button>
                }
              />
            ) : null}
            <button
              type="button"
              className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => beginImportSkill(null)}
              title="导入本机已安装 Skill 到当前聊天室"
            >
              <UserPlus className="size-4" />
            </button>
          </div>
        </div>
      </div>

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="min-h-0 flex-1 overflow-y-auto py-2">
            <div className="mb-2 px-2">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted"
                onClick={() => setActiveChannel('chairman')}
              >
                <div className="grid size-8 place-items-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                  <Crown className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">@董事长</div>
                  <div className="truncate text-xs text-muted-foreground">global variable / 调度所有 skill</div>
                </div>
              </button>
            </div>

            <div className="space-y-0.5">{rootFolders.map((folder) => renderFolder(folder, 0))}</div>
          </div>
        </ContextMenuTrigger>
        <StyledContextMenuContent className="w-52">
          <StyledContextMenuItem onSelect={() => createFolder(null)}>
            <FolderPlus className="mr-2 size-4" />
            新建 Crew 文件夹
          </StyledContextMenuItem>
          <StyledContextMenuItem onSelect={() => beginCreateSkill(null)}>
            <Plus className="mr-2 size-4" />
            新建 Skill
          </StyledContextMenuItem>
          <StyledContextMenuItem onSelect={() => beginImportSkill(null)}>
            <UserPlus className="mr-2 size-4" />
            导入已安装 Skill
          </StyledContextMenuItem>
        </StyledContextMenuContent>
      </ContextMenu>

      <ImportSkillDialog
        open={importSkillOpen}
        targetFolder={importTargetFolder}
        skills={importSkillCandidates}
        query={importQuery}
        importingSkillSlug={importingSkillSlug}
        getSkillFolderId={getSkillFolderId}
        onOpenChange={setImportSkillOpen}
        onQueryChange={setImportQuery}
        onImport={(skill) => void importInstalledSkill(skill)}
      />

      <SkillInspectorDialog
        skill={inspectedSkill}
        open={Boolean(inspectedSkill)}
        fileContent={skillFileDraft}
        filePath={skillFilePathDraft}
        loading={skillFileLoading}
        saving={skillFileSaving}
        onOpenChange={(open) => {
          if (!open) {
            setInspectedSkillSlug(null)
          }
        }}
        onContentChange={setSkillFileDraft}
        onSave={() => void saveInspectedSkill()}
        onOpenExternal={() => {
          if (inspectedSkill) {
            void openSkillPath(inspectedSkill)
          }
        }}
        onShowInFolder={() => {
          if (inspectedSkill) {
            void showSkillInFolder(inspectedSkill)
          }
        }}
      />
    </div>
  )

  function renderSkill(skill: LoadedSkill, folderId: string, depth: number): React.ReactNode {
    const isDragging = draggingSkillSlug === skill.slug

    return (
      <ContextMenu key={skill.slug}>
        <ContextMenuTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            draggable
            className={`group mx-2 flex min-h-10 cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition hover:bg-muted ${
              isDragging ? 'opacity-45' : ''
            }`}
            style={{ paddingLeft: 26 + depth * 18 }}
            onClick={() => setActiveChannel(folderId)}
            onDoubleClick={() => openSkillInspector(skill)}
            onDragStart={(event) => {
              setDraggingSkillSlug(skill.slug)
              event.dataTransfer.setData('application/x-skill-slug', skill.slug)
              event.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => setDraggingSkillSlug(null)}
          >
            <div className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
              <Bot className="size-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">@{skill.slug}</div>
              <div className="truncate text-xs text-muted-foreground">{skill.metadata.description || shortPath(dirname(skill.path))}</div>
            </div>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{SOURCE_LABELS[skill.source]}</span>
          </div>
        </ContextMenuTrigger>

        <StyledContextMenuContent className="w-60">
          <StyledContextMenuItem onSelect={() => openSkillInspector(skill)}>
            <Info className="mr-2 size-4" />
            查看属性
          </StyledContextMenuItem>
          <StyledContextMenuItem onSelect={() => openSkillPath(skill)}>
            <Pencil className="mr-2 size-4" />
            修改 SKILL.md
          </StyledContextMenuItem>
          <StyledContextMenuItem onSelect={() => showSkillInFolder(skill)}>
            <ExternalLink className="mr-2 size-4" />
            在 Finder 显示
          </StyledContextMenuItem>
          <StyledContextMenuSeparator />
          <StyledContextMenuSub>
            <StyledContextMenuSubTrigger>
              <MoveRight className="mr-2 size-4" />
              移动到文件夹
            </StyledContextMenuSubTrigger>
            <StyledContextMenuSubContent className="w-52">
              {folders.map((folder) => (
                <StyledContextMenuItem key={folder.id} disabled={folder.id === folderId} onSelect={() => moveSkill(skill.slug, folder.id)}>
                  #{folder.label}
                </StyledContextMenuItem>
              ))}
            </StyledContextMenuSubContent>
          </StyledContextMenuSub>
          <StyledContextMenuSeparator />
          <StyledContextMenuItem onSelect={() => copyText(skillFilePath(skill), 'SKILL.md 路径')}>
            <Copy className="mr-2 size-4" />
            复制 SKILL.md 路径
          </StyledContextMenuItem>
        </StyledContextMenuContent>
      </ContextMenu>
    )
  }
}

function builtinOrder(id: string): number {
  const index = DEFAULT_SKILL_CREW_ROOMS.indexOf(id as (typeof DEFAULT_SKILL_CREW_ROOMS)[number])
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

function sourceRank(source: LoadedSkill['source']): number {
  if (source === 'global') return 0
  if (source === 'project') return 1
  return 2
}

function inferCreatorLabel(skill: LoadedSkill, fileContent: string): string {
  const creatorMatch = fileContent.match(/^creator:\s*(.+)$/m)
  if (creatorMatch?.[1]?.trim()) {
    return creatorMatch[1].trim()
  }

  if (skill.source === 'workspace') {
    return 'workspace skill / 当前工作区文件'
  }

  if (skill.source === 'project') {
    return 'project skill / 当前项目文件'
  }

  return 'global skill / ~/.agents/skills'
}

function ImportSkillDialog({
  open,
  targetFolder,
  skills,
  query,
  importingSkillSlug,
  getSkillFolderId,
  onOpenChange,
  onQueryChange,
  onImport,
}: {
  open: boolean
  targetFolder: CrewFolder | null
  skills: LoadedSkill[]
  query: string
  importingSkillSlug: string | null
  getSkillFolderId: (skill: LoadedSkill) => string
  onOpenChange: (open: boolean) => void
  onQueryChange: (query: string) => void
  onImport: (skill: LoadedSkill) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[76vh] max-w-[min(820px,calc(100vw-32px))] grid-rows-none flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <DialogTitle>导入已安装 Skill</DialogTitle>
          <DialogDescription>
            {targetFolder ? `导入到 #${targetFolder.label}。global/project 会复制成本聊天室本地 skill，workspace skill 会移动进来。` : '先选择一个 Crew 文件夹。'}
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-border/60 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              autoFocus
              className="h-9 w-full rounded-md border border-border/70 bg-background pl-8 pr-3 text-sm outline-none focus:border-foreground/40"
              placeholder="搜索 slug、name、description 或路径"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {skills.length === 0 ? (
            <div className="px-2 py-8 text-center text-sm text-muted-foreground">
              没有匹配的已安装 skill
            </div>
          ) : (
            <div className="space-y-1">
              {skills.map((skill) => {
                const currentFolderId = getSkillFolderId(skill)
                const alreadyInTarget = Boolean(targetFolder && skill.source === 'workspace' && currentFolderId === targetFolder.id)
                const importing = importingSkillSlug === skill.slug
                return (
                  <div key={`${skill.source}:${skill.path}`} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/70">
                    <div className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                      <Bot className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="truncate text-sm font-medium">@{skill.slug}</div>
                        <span className="shrink-0 rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {SOURCE_LABELS[skill.source]}
                        </span>
                        {skill.source === 'workspace' ? (
                          <span className="shrink-0 rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            #{currentFolderId.split('/').pop()}
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {skill.metadata.description || shortPath(skill.path)}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={alreadyInTarget ? 'outline' : 'default'}
                      disabled={!targetFolder || importing || alreadyInTarget}
                      onClick={() => onImport(skill)}
                    >
                      {importing ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : null}
                      {alreadyInTarget ? '已在当前群' : skill.source === 'workspace' ? '移动进来' : '导入'}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border/60 px-5 py-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SkillInspectorDialog({
  skill,
  open,
  fileContent,
  filePath,
  loading,
  saving,
  onOpenChange,
  onContentChange,
  onSave,
  onOpenExternal,
  onShowInFolder,
}: {
  skill: LoadedSkill | null
  open: boolean
  fileContent: string
  filePath: string
  loading: boolean
  saving: boolean
  onOpenChange: (open: boolean) => void
  onContentChange: (content: string) => void
  onSave: () => void
  onOpenExternal: () => void
  onShowInFolder: () => void
}) {
  if (!skill) {
    return null
  }

  const creator = inferCreatorLabel(skill, fileContent)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[84vh] max-w-[min(980px,calc(100vw-32px))] grid-rows-none flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
              <Bot className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate">@{skill.slug}</DialogTitle>
              <DialogDescription className="mt-1 line-clamp-2">
                {skill.metadata.description || '没有 description'}
              </DialogDescription>
            </div>
            <span className="mt-0.5 shrink-0 rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
              {SOURCE_LABELS[skill.source]}
            </span>
          </div>
        </DialogHeader>

        <div className="grid gap-3 border-b border-border/60 px-5 py-3 text-xs md:grid-cols-2">
          <InspectorField label="创建者 / 来源" value={creator} />
          <InspectorField label="Name" value={skill.metadata.name || skill.slug} />
          <InspectorField label="Slug" value={skill.slug} />
          <InspectorField label="SKILL.md" value={shortPath(filePath || skillFilePath(skill))} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-5 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Prompt / SKILL.md
            </div>
            {loading ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                loading
              </span>
            ) : null}
          </div>
          <Textarea
            value={fileContent}
            onChange={(event) => onContentChange(event.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none overflow-auto font-mono text-xs leading-5"
            placeholder="正在读取 SKILL.md..."
          />
        </div>

        <DialogFooter className="border-t border-border/60 px-5 py-3">
          <Button type="button" variant="outline" onClick={onShowInFolder}>
            <ExternalLink className="mr-2 size-4" />
            Finder
          </Button>
          <Button type="button" variant="outline" onClick={onOpenExternal}>
            <Pencil className="mr-2 size-4" />
            外部编辑
          </Button>
          <Button type="button" onClick={onSave} disabled={loading || saving || !fileContent.trim()}>
            {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InspectorField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="truncate text-foreground/85" title={value}>{value}</div>
    </div>
  )
}
