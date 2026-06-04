import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigWatcher } from '../watcher.ts';
import { loadAllSkills } from '../../skills/storage.ts';

const tempRoots: string[] = [];

function makeWorkspace(): string {
  const root = join(tmpdir(), `craft-watcher-nested-skills-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
}

function writeSkill(workspaceRoot: string, room: string, slug: string, name: string): void {
  const skillDir = join(workspaceRoot, 'skills', room, slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: nested skill test\n---\n\n# ${name}\n`, 'utf-8');
}

describe('ConfigWatcher nested skills', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refreshes cached skills for skills/<room>/<slug>/SKILL.md changes', async () => {
    const workspaceRoot = makeWorkspace();
    const slug = 'nested-refresh-skill';
    writeSkill(workspaceRoot, 'debate', slug, 'Old Name');

    expect(loadAllSkills(workspaceRoot).find((skill) => skill.slug === slug)?.metadata.name).toBe('Old Name');

    let resolveChange!: (name: string | null) => void;
    const changed = new Promise<string | null>((resolve) => {
      resolveChange = resolve;
    });

    const watcher = new ConfigWatcher(workspaceRoot, {
      onSkillChange(changedSlug) {
        if (changedSlug !== slug) return;
        const refreshed = loadAllSkills(workspaceRoot).find((skill) => skill.slug === slug);
        resolveChange(refreshed?.metadata.name ?? null);
      },
    });

    watcher.start();
    try {
      writeSkill(workspaceRoot, 'debate', slug, 'Fresh Name');
      watcher.notifyFileChange(`skills/debate/${slug}/SKILL.md`);

      const refreshedName = await Promise.race([
        changed,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);

      expect(refreshedName).toBe('Fresh Name');
    } finally {
      watcher.stop();
    }
  });
});
