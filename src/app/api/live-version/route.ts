import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { getCurrentUser } from '@core/auth';

const CACHE_MS = 10_000;
let cached: { at: number; build: string; stamp: string } | null = null;

async function readBuildId(): Promise<string> {
  try {
    return (await readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), '.next', 'BUILD_ID'), 'utf8')).trim();
  } catch {
    return 'dev';
  }
}

const time = (d: Date | null | undefined) => (d ? d.getTime() : 0);

/**
 * What open screens poll to learn that something changed: the app build, and a stamp that moves when tests, policies,
 * routes, testers or vehicles change. Cached briefly, so many open screens make one small database read.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  if (!cached || Date.now() - cached.at > CACHE_MS) {
    const [tests, assignments, policies, routes, testers, vehicles, build] = await Promise.all([
      prisma.labTest.aggregate({ _max: { updatedAt: true }, _count: true }),
      prisma.milkTestPolicyAssignment.aggregate({ _max: { updated_at: true }, _count: true }),
      prisma.testPointPolicy.aggregate({ _max: { id: true }, _count: true }),
      prisma.zmccRoute.aggregate({ _max: { updated_at: true }, _count: true }),
      prisma.motProfile.aggregate({ _max: { updated_at: true }, _count: true }),
      prisma.motVehicle.aggregate({ _max: { updated_at: true }, _count: true }),
      readBuildId(),
    ]);
    const stamp = [
      time(tests._max.updatedAt),
      tests._count,
      time(assignments._max.updated_at),
      assignments._count,
      String(policies._max.id ?? 0),
      policies._count,
      time(routes._max.updated_at),
      routes._count,
      time(testers._max.updated_at),
      testers._count,
      time(vehicles._max.updated_at),
      vehicles._count,
    ].join('.');
    cached = { at: Date.now(), build, stamp };
  }
  return NextResponse.json({ build: cached.build, stamp: cached.stamp }, { headers: { 'Cache-Control': 'no-store' } });
}
