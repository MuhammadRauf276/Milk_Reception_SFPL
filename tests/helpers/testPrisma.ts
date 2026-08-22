import { PrismaClient } from '@prisma/client';
import { assertSafeTestDatabase } from './testDbSafety';

let testPrismaClient: PrismaClient | null = null;

export function getTestPrisma(): PrismaClient {
  if (testPrismaClient) {
    return testPrismaClient;
  }

  // Safety guard check
  const { testDbName } = assertSafeTestDatabase();

  const testDbUrl = process.env.TEST_DATABASE_URL!;

  testPrismaClient = new PrismaClient({
    datasources: {
      db: {
        url: testDbUrl,
      },
    },
    log: ['error'],
  });

  return testPrismaClient;
}

export async function disconnectTestPrisma(): Promise<void> {
  if (testPrismaClient) {
    await testPrismaClient.$disconnect();
    testPrismaClient = null;
  }
}
