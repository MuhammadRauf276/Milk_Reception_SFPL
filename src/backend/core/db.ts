import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// Initialize PostgreSQL Connection Pool using env DATABASE_URL
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

