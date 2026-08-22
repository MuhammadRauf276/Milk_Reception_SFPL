import { describe, it, expect } from 'vitest';
import { assertSafeTestDatabase, parseDatabaseNameFromUrl } from '../helpers/testDbSafety';

describe('Test Database Safety Guard (assertSafeTestDatabase)', () => {
  it('rejects when TEST_DATABASE_URL is undefined or missing', () => {
    expect(() => {
      assertSafeTestDatabase({ testDbUrl: undefined, devDbUrl: 'postgresql://usr:pwd@localhost:5432/milk_reception_db' });
    }).toThrowError(/TEST_DATABASE_URL is missing or empty/);
  });

  it('rejects when TEST_DATABASE_URL is empty whitespace', () => {
    expect(() => {
      assertSafeTestDatabase({ testDbUrl: '   ', devDbUrl: 'postgresql://usr:pwd@localhost:5432/milk_reception_db' });
    }).toThrowError(/TEST_DATABASE_URL is missing or empty/);
  });

  it('rejects when TEST_DATABASE_URL equals DATABASE_URL', () => {
    const sharedUrl = 'postgresql://usr:pwd@localhost:5432/milk_reception_test';
    expect(() => {
      assertSafeTestDatabase({ testDbUrl: sharedUrl, devDbUrl: sharedUrl });
    }).toThrowError(/cannot be identical to DATABASE_URL/);
  });

  it('rejects when test database name does not contain "test"', () => {
    const unsafeTestUrl = 'postgresql://usr:pwd@localhost:5432/milk_reception_prod';
    expect(() => {
      assertSafeTestDatabase({
        testDbUrl: unsafeTestUrl,
        devDbUrl: 'postgresql://usr:pwd@localhost:5432/milk_reception_db',
      });
    }).toThrowError(/does not contain "test"/);
  });

  it('rejects destructive setup when NODE_ENV is "production"', () => {
    const validTestUrl = 'postgresql://usr:pwd@localhost:5432/milk_reception_test';
    expect(() => {
      assertSafeTestDatabase({
        testDbUrl: validTestUrl,
        devDbUrl: 'postgresql://usr:pwd@localhost:5432/milk_reception_db',
        nodeEnv: 'production',
        isDestructive: true,
      });
    }).toThrowError(/when NODE_ENV is "production"/);
  });

  it('accepts valid, distinct test database with test in the name', () => {
    const validTestUrl = 'postgresql://usr:pwd@localhost:5432/milk_reception_test?schema=public';
    const result = assertSafeTestDatabase({
      testDbUrl: validTestUrl,
      devDbUrl: 'postgresql://usr:pwd@localhost:5432/milk_reception_db',
      nodeEnv: 'test',
      isDestructive: false,
    });
    expect(result.isSafe).toBe(true);
    expect(result.testDbName).toBe('milk_reception_test');
  });

  it('correctly parses database name from various PostgreSQL connection formats', () => {
    expect(parseDatabaseNameFromUrl('postgresql://user:pass@localhost:5432/my_test_db')).toBe('my_test_db');
    expect(parseDatabaseNameFromUrl('postgresql://user:pass@localhost:5432/my_test_db?sslmode=require')).toBe('my_test_db');
    expect(parseDatabaseNameFromUrl('postgres://localhost:5432/unit_test')).toBe('unit_test');
  });
});
