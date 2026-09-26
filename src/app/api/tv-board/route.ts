import { NextResponse } from 'next/server';
import { getAdminHeadDashboard } from '@/backend/services/adminHeadDashboardService';
export async function GET() { const dashboard = await getAdminHeadDashboard(); return NextResponse.json({ vehicles: dashboard.vehicles }, { headers: { 'Cache-Control': 'public, max-age=30' } }); }
