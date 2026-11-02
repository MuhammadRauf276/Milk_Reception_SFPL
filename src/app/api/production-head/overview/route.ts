import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { canViewPlant13TsLiters } from '@/lib/role-visibility';
import { getProductionHeadOverview } from '@/backend/services/productionHeadOverviewService';
import { getErrorMessage } from '@/lib/errors';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!canViewPlant13TsLiters(user.role) && !canActAs(user.role, 'PRODUCTION_HEAD')) {
      return NextResponse.json(
        { error: 'Forbidden. Production Head supervisory authorization required.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');
    const station = searchParams.get('station') as 'ALL' | 'WEIGHBRIDGE' | 'RECEPTION' | null;

    const data = await getProductionHeadOverview(date, station);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to load production head overview:', error);
    return NextResponse.json(
      { error: getErrorMessage(error) || 'Internal server error' },
      { status: 500 }
    );
  }
}
