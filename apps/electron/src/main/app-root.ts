import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { App } from 'electron'

function findMonorepoRoot(startPath: string): string | undefined {
  let dir = resolve(startPath)

  for (let i = 0; i <= 8; i++) {
    if (
      existsSync(join(dir, 'apps', 'electron', 'package.json')) &&
      existsSync(join(dir, 'packages', 'pi-agent-server', 'dist', 'index.js'))
    ) {
      return dir
    }

    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return undefined
}

export function resolveElectronAppRoot(app: App): string {
  if (app.isPackaged) return app.getAppPath()

  return findMonorepoRoot(process.cwd())
    ?? findMonorepoRoot(app.getAppPath())
    ?? process.cwd()
}
