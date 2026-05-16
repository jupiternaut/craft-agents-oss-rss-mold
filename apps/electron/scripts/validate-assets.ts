import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const requiredPaths = [
  'dist/resources',
  'dist/resources/config-defaults.json',
  'dist/resources/docs',
  'dist/resources/permissions/default.json',
  'dist/resources/release-notes',
  'dist/resources/themes',
  'dist/resources/tool-icons',
  'dist/resources/powershell-parser.ps1',
];

const missing = requiredPaths.filter((path) => !existsSync(path));

if (missing.length > 0) {
  console.error('Missing bundled assets:');
  for (const path of missing) {
    console.error(`- ${path}`);
  }
  process.exit(1);
}

const requiredNonEmptyDirs = [
  'dist/resources/docs',
  'dist/resources/release-notes',
  'dist/resources/themes',
  'dist/resources/tool-icons',
];

for (const dir of requiredNonEmptyDirs) {
  const entries = readdirSync(dir);
  if (entries.length === 0) {
    console.error(`Bundled asset directory is empty: ${dir}`);
    process.exit(1);
  }
}

const parserPath = join('dist', 'resources', 'powershell-parser.ps1');
if (!statSync(parserPath).isFile()) {
  console.error(`Bundled asset is not a file: ${parserPath}`);
  process.exit(1);
}

console.log('✓ Validated bundled assets');
