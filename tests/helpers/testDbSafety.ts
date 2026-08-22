/**
 * Test Database Safety Guard
 * 
 * Verifies that automated regression/integration tests only execute against
 * an explicitly configured, distinct, and disposable test database.
 */

export interface TestDbSafetyCheckOptions {
  testDbUrl?: string;
  devDbUrl?: string;
  nodeEnv?: string;
  isDestructive?: boolean;
}

export function parseDatabaseNameFromUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const pathname = url.pathname.replace(/^\//, '');
    return pathname.split('?')[0] || '';
  } catch {
    // If URL parsing fails, fallback to simple regex
    const match = rawUrl.match(/\/([^/?#]+)(\?|$)/);
    return match ? match[1] : '';
  }
}

export function assertSafeTestDatabase(options?: TestDbSafetyCheckOptions): {
  testDbName: string;
  isSafe: boolean;
} {
  const testDbUrl = options?.testDbUrl ?? process.env.TEST_DATABASE_URL;
  const devDbUrl = options?.devDbUrl ?? (process.env.DEV_DATABASE_URL || '');
  const nodeEnv = options?.nodeEnv ?? process.env.NODE_ENV;
  const isDestructive = options?.isDestructive ?? false;

  // 1. Must exist and not be empty
  if (!testDbUrl || typeof testDbUrl !== 'string' || testDbUrl.trim() === '') {
    throw new Error(
      'TEST DATABASE SAFETY FAILURE: TEST_DATABASE_URL is missing or empty. ' +
      'Automated integration tests must specify a dedicated TEST_DATABASE_URL.'
    );
  }

  const cleanTestUrl = testDbUrl.trim();
  const cleanDevUrl = devDbUrl ? devDbUrl.trim() : '';

  // 2. Must not be equal to DEV_DATABASE_URL
  if (cleanDevUrl && cleanTestUrl === cleanDevUrl) {
    throw new Error(
      'TEST DATABASE SAFETY FAILURE: TEST_DATABASE_URL cannot be identical to DATABASE_URL. ' +
      'Tests must never run against the normal development database.'
    );
  }



  // 3. Database name must contain 'test'
  const testDbName = parseDatabaseNameFromUrl(cleanTestUrl);
  if (!testDbName || !testDbName.toLowerCase().includes('test')) {
    throw new Error(
      `TEST DATABASE SAFETY FAILURE: Test database name "${testDbName || 'UNKNOWN'}" does not contain "test". ` +
      'The test database must explicitly include "test" in its name to prevent accidental execution.'
    );
  }

  // 4. Production guard for destructive actions
  if (isDestructive && nodeEnv === 'production') {
    throw new Error(
      'TEST DATABASE SAFETY FAILURE: Destructive test operations are strictly forbidden when NODE_ENV is "production".'
    );
  }

  return {
    testDbName,
    isSafe: true,
  };
}
