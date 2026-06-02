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
  MoveRight,
  Pencil,
  Plus,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'

import { DEFAULT_SKILL_CREW_ROOMS, skillCrewChannelAtom } from '@/atoms/skill-crew'
import { skillsAtom } from '@/atoms/skills'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
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

type CrewSkillPlacement = Record<string, string>

const ROOM_DESCRIPTIONS: Record<string, string> = {
  debate: '董事长主持的多 skill 辩论',
  design: '产品、界面和角色设定',
  build: '实现路径、验证和交付',
  policy: '申报、规则和外部约束',
}

const ROOM_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  debate: Crown,
  design: Sparkles,
  build: Folder,
  policy: FileText,
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

function inferRoomId(skill: LoadedSkill): string {
  const haystack = `${skill.slug} ${skill.path} ${skill.metadata.name ?? ''} ${skill.metadata.description ?? ''}`.toLowerCase()

  if (/(design|frontend|css|gsap|anime|lottie|three|hyperframes|ui|visual)/.test(haystack)) {
    return 'design'
  }

  if (/(decision|muzero|kant|abductive|hermeneutic|skillcreator|debate|reason)/.test(haystack)) {
    return 'debate'
  }

  if (/(lark|policy|approval|okr|calendar|mail|slack|doc|sheet|wiki)/.test(haystack)) {
    return 'policy'
  }

  return 'build'
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

function inferPhysicalFolderId(skill: LoadedSkill, folders: CrewFolder[]): string | null {
  const candidates = folders
    .filter((folder) => folder.relativePath)
    .sort((a, b) => b.relativePath.length - a.relativePath.length)

  for (const folder of candidates) {
    if (skill.path.endsWith(`/skills/${folder.relativePath}/${skill.slug}`)) {
      return folder.id
    }
  }

  return null
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
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(['debate', 'design', 'build', 'policy']))
  const [customFolders, setCustomFolders] = React.useState<CrewFolder[]>([])
  const [skillPlacement, setSkillPlacement] = React.useState<CrewSkillPlacement>({})
  const [draggingSkillSlug, setDraggingSkillSlug] = React.useState<string | null>(null)
  const [addSkillOpen, setAddSkillOpen] = React.useState(false)
  const [addSkillDefault, setAddSkillDefault] = React.useState('创建一个新的 Crew skill。')

  const folders = React.useMemo(
    () => {
      const builtinFolders = buildBuiltinFolders(activeWorkspace?.rootPath)
      const builtinIds = new Set(builtinFolders.map((folder) => folder.id))
      return [...builtinFolders, ...customFolders.filter((folder) => !builtinIds.has(folder.id))]
    },
    [activeWorkspace?.rootPath, customFolders],
  )

  const folderById = React.useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])

  const skillsByFolder = React.useMemo(() => {
    const groups = new Map<string, LoadedSkill[]>()

    for (const folder of folders) {
      groups.set(folder.id, [])
    }

    for (const skill of skills) {
      const folderId = skillPlacement[skill.slug] ?? inferPhysicalFolderId(skill, folders) ?? inferRoomId(skill)
      const target = groups.has(folderId) ? folderId : 'build'
      groups.get(target)?.push(skill)
    }

    for (const group of groups.values()) {
      group.sort((a, b) => a.slug.localeCompare(b.slug))
    }

    return groups
  }, [folders, skillPlacement, skills])

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
        </StyledContextMenuContent>
      </ContextMenu>
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
          <StyledContextMenuItem onSelect={() => navigate(routes.view.skills(skill.slug))}>
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
