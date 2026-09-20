import fs from 'fs';
import path from 'path';

export interface TrackedMigration {
  name: string;
  fullPath: string;
  sqlPath: string;
}

/**
 * Returns all tracked Prisma migration directories in sorted order.
 */
export function getTrackedMigrations(customRepoRoot?: string): TrackedMigration[] {
  const repoRoot = customRepoRoot || path.resolve(__dirname, '../..');
  const migrationsDir = path.join(repoRoot, 'prisma', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }
  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  const migrationDirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();

  return migrationDirs.map((name) => {
    const fullPath = path.join(migrationsDir, name);
    const sqlPath = path.join(fullPath, 'migration.sql');
    return { name, fullPath, sqlPath };
  });
}

/**
 * Returns the exact count of tracked Prisma migrations.
 */
export function getTrackedMigrationCount(customRepoRoot?: string): number {
  return getTrackedMigrations(customRepoRoot).length;
}

/**
 * Asserts that the tracked migration count matches the expected number.
 */
export function assertExactMigrationCount(expectedCount = 33, customRepoRoot?: string): void {
  const actualCount = getTrackedMigrationCount(customRepoRoot);
  if (actualCount !== expectedCount) {
    throw new Error(
      `Migration count invariant failed: expected ${expectedCount} tracked migrations, but found ${actualCount}.`
    );
  }
}
