/**
 * Skills Storage
 *
 * CRUD operations for workspace skills.
 * Skills are stored in {workspace}/skills/{slug}/ directories.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'fs';
import { homedir } from 'os';
import { basename, join, relative, resolve } from 'path';
import matter from 'gray-matter';
import type { LoadedSkill, SkillFolder, SkillMetadata, SkillSource } from './types.ts';
import { getWorkspaceSkillsPath } from '../workspaces/storage.ts';
import {
  validateIconValue,
  findIconFile,
  downloadIcon,
  needsIconDownload,
  isIconUrl,
} from '../utils/icon.ts';

// ============================================================
// Agent Skills Paths (Issue #171)
// ============================================================

/** Global agent skills directory: ~/.agents/skills/ */
export const GLOBAL_AGENT_SKILLS_DIR = join(homedir(), '.agents', 'skills');

/** Project-level agent skills relative directory name */
export const PROJECT_AGENT_SKILLS_DIR = '.agents/skills';

/**
 * Normalize requiredSources frontmatter to a clean string array.
 * Accepts a single string or array of strings, trims whitespace, and deduplicates.
 */
function normalizeRequiredSources(value: unknown): string[] | undefined {
  const asArray = typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value
      : undefined;

  if (!asArray) return undefined;

  const normalized = Array.from(new Set(
    asArray
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => entry.trim())
      .filter(Boolean)
  ));

  return normalized.length > 0 ? normalized : undefined;
}

// ============================================================
// Parsing
// ============================================================

/**
 * Parse SKILL.md content and extract frontmatter + body
 */
function parseSkillFile(content: string): { metadata: SkillMetadata; body: string } | null {
  try {
    const parsed = matter(content);

    // Validate required fields
    if (!parsed.data.name || !parsed.data.description) {
      return null;
    }

    // Validate and extract optional icon field
    // Only accepts emoji or URL - rejects inline SVG and relative paths
    const icon = validateIconValue(parsed.data.icon, 'Skills');

    return {
      metadata: {
        name: parsed.data.name as string,
        description: parsed.data.description as string,
        globs: parsed.data.globs as string[] | undefined,
        alwaysAllow: parsed.data.alwaysAllow as string[] | undefined,
        icon,
        requiredSources: normalizeRequiredSources(parsed.data.requiredSources),
      },
      body: parsed.content,
    };
  } catch {
    return null;
  }
}

// ============================================================
// Load Operations
// ============================================================

/**
 * Load a single skill from a directory
 * @param skillsDir - Absolute path to skills directory
 * @param slug - Skill directory name
 * @param source - Where this skill is loaded from
 */
function loadSkillFromDir(skillsDir: string, skillPath: string, source: SkillSource, slug = basename(skillPath)): LoadedSkill | null {
  const skillDir = join(skillsDir, skillPath);
  const skillFile = join(skillDir, 'SKILL.md');

  // Check directory exists
  if (!existsSync(skillDir) || !statSync(skillDir).isDirectory()) {
    return null;
  }

  // Check SKILL.md exists
  if (!existsSync(skillFile)) {
    return null;
  }

  // Read and parse SKILL.md
  let content: string;
  try {
    content = readFileSync(skillFile, 'utf-8');
  } catch {
    return null;
  }

  const parsed = parseSkillFile(content);
  if (!parsed) {
    return null;
  }

  return {
    slug,
    metadata: parsed.metadata,
    content: parsed.body,
    iconPath: findIconFile(skillDir),
    path: skillDir,
    source,
  };
}

/**
 * Load all skills from a directory
 * @param skillsDir - Absolute path to skills directory
 * @param source - Where these skills are loaded from
 */
function loadSkillsFromDir(skillsDir: string, source: SkillSource): LoadedSkill[] {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const skills: LoadedSkill[] = [];

  try {
    function scan(dirPath: string, relativeParts: string[]): void {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;

        const nextParts = [...relativeParts, entry.name];
        const relativePath = join(...nextParts);
        const skill = loadSkillFromDir(skillsDir, relativePath, source, entry.name);
        if (skill) {
          skills.push(skill);
        } else {
          scan(join(dirPath, entry.name), nextParts);
        }
      }
    }

    scan(skillsDir, []);
  } catch {
    // Ignore errors reading skills directory
  }

  return skills;
}

function findSkillRelativePath(skillsDir: string, slug: string): string | null {
  const directSkillFile = join(skillsDir, slug, 'SKILL.md');
  if (existsSync(directSkillFile)) {
    return slug;
  }

  function scan(dirPath: string, relativeParts: string[]): string | null {
    let entries;
    try {
      entries = readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;

      const nextParts = [...relativeParts, entry.name];
      const relativePath = join(...nextParts);

      if (entry.name === slug && existsSync(join(skillsDir, relativePath, 'SKILL.md'))) {
        return relativePath;
      }

      const nested = scan(join(dirPath, entry.name), nextParts);
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  return scan(skillsDir, []);
}

function assertWithinDirectory(rootDir: string, targetPath: string): void {
  const root = resolve(rootDir);
  const target = resolve(targetPath);
  const rel = relative(root, target);
  if (rel.startsWith('..') || rel === '..' || rel.startsWith('/') || rel === '') {
    if (target !== root) {
      throw new Error(`Path escapes skills directory: ${targetPath}`);
    }
  }
}

function normalizeFolderPath(folderPath: string): string {
  return folderPath
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part !== '.' && part !== '..')
    .join('/');
}

/**
 * Load a single skill from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function loadSkill(workspaceRoot: string, slug: string): LoadedSkill | null {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const relativePath = findSkillRelativePath(skillsDir, slug);
  return relativePath ? loadSkillFromDir(skillsDir, relativePath, 'workspace', slug) : null;
}

/**
 * Load all skills from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function loadWorkspaceSkills(workspaceRoot: string): LoadedSkill[] {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  return loadSkillsFromDir(skillsDir, 'workspace');
}

// ── Skills cache ────────────────────────────────────────────────────────
// loadAllSkills reads from up to 3 directories on every call (~100ms).
// The result rarely changes during a session, so we cache it per
// (workspaceRoot, projectRoot) pair with a 5-minute safety TTL.

const skillsCache = new Map<string, { skills: LoadedSkill[]; ts: number }>();
const SKILLS_CACHE_TTL = 5 * 60_000; // 5 minutes

/** Invalidate the skills cache (call on working dir change or skill file events). */
export function invalidateSkillsCache(): void {
  skillsCache.clear();
}

/**
 * Load all skills from all sources (global, workspace, project)
 * Skills with the same slug are overridden by higher-priority sources.
 * Priority: global (lowest) < workspace < project (highest)
 *
 * Results are cached per (workspaceRoot, projectRoot) pair. Call
 * invalidateSkillsCache() on working directory changes or skill file events.
 *
 * @param workspaceRoot - Absolute path to workspace root
 * @param projectRoot - Optional project root (working directory) for project-level skills
 */
export function loadAllSkills(workspaceRoot: string, projectRoot?: string): LoadedSkill[] {
  const cacheKey = `${workspaceRoot}::${projectRoot ?? ''}`;
  const now = Date.now();
  const cached = skillsCache.get(cacheKey);
  if (cached && now - cached.ts < SKILLS_CACHE_TTL) {
    return cached.skills;
  }

  const skillsBySlug = new Map<string, LoadedSkill>();

  // 1. Global skills (lowest priority): ~/.agents/skills/
  for (const skill of loadSkillsFromDir(GLOBAL_AGENT_SKILLS_DIR, 'global')) {
    skillsBySlug.set(skill.slug, skill);
  }

  // 2. Workspace skills (medium priority)
  for (const skill of loadWorkspaceSkills(workspaceRoot)) {
    skillsBySlug.set(skill.slug, skill);
  }

  // 3. Project skills (highest priority): {projectRoot}/.agents/skills/
  if (projectRoot) {
    const projectSkillsDir = join(projectRoot, PROJECT_AGENT_SKILLS_DIR);
    for (const skill of loadSkillsFromDir(projectSkillsDir, 'project')) {
      skillsBySlug.set(skill.slug, skill);
    }
  }

  const result = Array.from(skillsBySlug.values());
  skillsCache.set(cacheKey, { skills: result, ts: now });
  return result;
}

/**
 * Load a single skill by slug from all sources (project > workspace > global).
 * Unlike loadAllSkills(), this only reads the specific slug directory — O(1) not O(N).
 *
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill slug to load
 * @param projectRoot - Optional project root for project-level skills
 */
export function loadSkillBySlug(workspaceRoot: string, slug: string, projectRoot?: string): LoadedSkill | null {
  // Highest priority: project-level
  if (projectRoot) {
    const projectSkillsDir = join(projectRoot, PROJECT_AGENT_SKILLS_DIR);
    const projectSkillPath = findSkillRelativePath(projectSkillsDir, slug);
    const skill = projectSkillPath ? loadSkillFromDir(projectSkillsDir, projectSkillPath, 'project', slug) : null;
    if (skill) return skill;
  }

  // Medium priority: workspace
  const workspaceSkillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const workspaceSkillPath = findSkillRelativePath(workspaceSkillsDir, slug);
  const workspaceSkill = workspaceSkillPath ? loadSkillFromDir(workspaceSkillsDir, workspaceSkillPath, 'workspace', slug) : null;
  if (workspaceSkill) return workspaceSkill;

  // Lowest priority: global
  const globalSkillPath = findSkillRelativePath(GLOBAL_AGENT_SKILLS_DIR, slug);
  return globalSkillPath ? loadSkillFromDir(GLOBAL_AGENT_SKILLS_DIR, globalSkillPath, 'global', slug) : null;
}

/**
 * Get icon path for a skill
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function getSkillIconPath(workspaceRoot: string, slug: string): string | null {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const relativePath = findSkillRelativePath(skillsDir, slug);
  if (!relativePath) {
    return null;
  }

  const skillDir = join(skillsDir, relativePath);

  if (!existsSync(skillDir)) {
    return null;
  }

  return findIconFile(skillDir) || null;
}

// ============================================================
// Delete Operations
// ============================================================

/**
 * Delete a skill from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function deleteSkill(workspaceRoot: string, slug: string): boolean {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const relativePath = findSkillRelativePath(skillsDir, slug);

  if (!relativePath) {
    return false;
  }

  const skillDir = join(skillsDir, relativePath);

  if (!existsSync(skillDir)) {
    return false;
  }

  try {
    rmSync(skillDir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a workspace skill folder or Crew room under {workspace}/skills.
 * Returns the created absolute path.
 */
export function createSkillFolder(workspaceRoot: string, folderPath: string): string {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const normalized = normalizeFolderPath(folderPath);
  const targetDir = normalized ? join(skillsDir, normalized) : skillsDir;

  assertWithinDirectory(skillsDir, targetDir);
  mkdirSync(targetDir, { recursive: true });
  return targetDir;
}

/**
 * List physical Crew room folders under {workspace}/skills.
 * Directories containing SKILL.md are skill directories and are not returned.
 */
export function listSkillFolders(workspaceRoot: string): SkillFolder[] {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  if (!existsSync(skillsDir)) {
    return [];
  }

  const folders: SkillFolder[] = [];

  function scan(dirPath: string, relativeParts: string[]): void {
    let entries;
    try {
      entries = readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;

      const childPath = join(dirPath, entry.name);
      const nextParts = [...relativeParts, entry.name];
      const relativePath = join(...nextParts);

      if (existsSync(join(childPath, 'SKILL.md'))) {
        continue;
      }

      folders.push({
        name: entry.name,
        relativePath,
        parentPath: relativeParts.length > 0 ? join(...relativeParts) : null,
        path: childPath,
      });
      scan(childPath, nextParts);
    }
  }

  scan(skillsDir, []);
  return folders.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Move a workspace skill under another folder inside {workspace}/skills.
 */
export function moveWorkspaceSkill(workspaceRoot: string, slug: string, targetFolderPath: string): LoadedSkill | null {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const relativePath = findSkillRelativePath(skillsDir, slug);
  if (!relativePath) {
    return null;
  }

  const sourceDir = join(skillsDir, relativePath);
  const normalizedTargetFolder = normalizeFolderPath(targetFolderPath);
  const targetParent = normalizedTargetFolder ? join(skillsDir, normalizedTargetFolder) : skillsDir;
  const targetDir = join(targetParent, slug);

  assertWithinDirectory(skillsDir, sourceDir);
  assertWithinDirectory(skillsDir, targetParent);
  assertWithinDirectory(skillsDir, targetDir);

  if (resolve(sourceDir) === resolve(targetDir)) {
    return loadSkillFromDir(skillsDir, relativePath, 'workspace', slug);
  }

  if (existsSync(targetDir)) {
    throw new Error(`Target skill already exists: ${targetDir}`);
  }

  mkdirSync(targetParent, { recursive: true });
  renameSync(sourceDir, targetDir);
  invalidateSkillsCache();

  const targetRelativePath = normalizedTargetFolder ? join(normalizedTargetFolder, slug) : slug;
  return loadSkillFromDir(skillsDir, targetRelativePath, 'workspace', slug);
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Check if a skill exists in a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function skillExists(workspaceRoot: string, slug: string): boolean {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  return findSkillRelativePath(skillsDir, slug) !== null;
}

/**
 * List skill slugs in a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function listSkillSlugs(workspaceRoot: string): string[] {
  return loadWorkspaceSkills(workspaceRoot).map((skill) => skill.slug);
}

// ============================================================
// Icon Download (uses shared utilities)
// ============================================================

/**
 * Download an icon from a URL and save it to the skill directory.
 * Returns the path to the downloaded icon, or null on failure.
 */
export async function downloadSkillIcon(
  skillDir: string,
  iconUrl: string
): Promise<string | null> {
  return downloadIcon(skillDir, iconUrl, 'Skills');
}

/**
 * Check if a skill needs its icon downloaded.
 * Returns true if metadata has a URL icon and no local icon file exists.
 */
export function skillNeedsIconDownload(skill: LoadedSkill): boolean {
  return needsIconDownload(skill.metadata.icon, skill.iconPath);
}

// Re-export icon utilities for convenience
export { isIconUrl } from '../utils/icon.ts';
