import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { getAdminHeadDashboard } from '@/backend/services/adminHeadDashboardService';
export async function GET(req: Request) { const current = await getCurrentUser(req); if (!current) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); const user = await prisma.user.findUnique({ where: { id: BigInt(current.id) } }); if (!user || !['ADMIN_HEAD','SUPER_ADMIN'].includes(user.role)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 }); return NextResponse.json({ dashboard: await getAdminHeadDashboard() }); }
