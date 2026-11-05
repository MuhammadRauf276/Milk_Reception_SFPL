import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

// A second query on this key once stored { user } where the app expects the user itself. Every workspace then saw no
// role and sent people to "No workspace" until they signed in again.
test('only useCurrentUser owns the cached signed-in user', () => {
  const owners = sourceFiles('src')
    .filter((file) => /queryKey:\s*\[\s*['"]auth['"]\s*,\s*['"]me['"]/.test(readFileSync(file, 'utf8')))
    .map((file) => file.replace(/\\/g, '/'));
  assert.deepEqual(owners, ['src/frontend/hooks/useCurrentUser.ts']);
});
