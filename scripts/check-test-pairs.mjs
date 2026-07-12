import { existsSync, readdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const SOURCE_ROOT = 'packages/react-calendar/src';
const IMPLEMENTATION_PATTERN = /\.(?:ts|tsx)$/;
const TEST_PATTERN = /\.(?:test|spec)\.(?:ts|tsx)$/;
const EXEMPT_BASENAMES = new Set(['index.ts', 'types.ts']);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const missing = walk(SOURCE_ROOT)
  .filter(
    (path) =>
      IMPLEMENTATION_PATTERN.test(path) &&
      !TEST_PATTERN.test(path) &&
      !EXEMPT_BASENAMES.has(basename(path)),
  )
  .filter((path) => {
    const base = path.slice(0, -extname(path).length);
    return !existsSync(`${base}.test.ts`) && !existsSync(`${base}.test.tsx`);
  });

if (missing.length > 0) {
  console.error('対応する同階層テストがない実装ファイル:');
  for (const path of missing) {
    console.error(`- ${path}`);
  }
  process.exitCode = 1;
} else {
  console.log('✓ 全実装ファイルに同階層テストがあります');
}
