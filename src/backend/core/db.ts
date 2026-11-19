import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma 7 talks to PostgreSQL through a driver adapter (node-postgres) instead of
// the Rust query engine, and no longer reads DATABASE_URL implicitly.
export function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  // Times are stored with a time zone, and the driver sends and reads them as UTC text without a zone, so this
  // connection must run in UTC. Database tools keep the database zone (Asia/Karachi) and show Pakistan time.
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, options: '-c TimeZone=UTC' }) });
}

declare const globalThis: {
  prismaGlobal: ReturnType<typeof createPrismaClient>;
} & typeof global;

export const prisma = globalThis.prismaGlobal ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma;
