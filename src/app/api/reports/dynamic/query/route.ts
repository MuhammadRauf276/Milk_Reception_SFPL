import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { executeDynamicReportQuery } from '@/backend/services/dynamicReportEngine';
import type { DynamicQueryRequest } from '@/frontend/modules/dashboard/reports/dynamicReportTypes';

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAuthorized =
      canActAs(user.role, 'ZMCC_MANAGER') ||
      user.role === 'HEAD_OF_MPD' ||
      user.role === 'SUPER_ADMIN' ||
      user.role === 'DATA_EXECUTIVE' ||
      user.role === 'EXECUTIVE_MANAGEMENT';

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Forbidden. ZMCC Manager or executive authority required.' },
        { status: 403 }
      );
    }

    const body: DynamicQueryRequest = await req.json();
    if (!body || !body.domain || !Array.isArray(body.selectedFieldIds)) {
      return NextResponse.json(
        { error: 'Invalid query payload: domain and selectedFieldIds are required.' },
        { status: 400 }
      );
    }

    const result = await executeDynamicReportQuery(body, user);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to execute dynamic report query' },
      { status: 500 }
    );
  }
}
