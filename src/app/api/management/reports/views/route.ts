import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import type { ManagementScope, ManagementFilters } from '@/backend/modules/management-reporting';
import {
  getLiveMotCollectionFeed,
  getLiveHcSupplierInwardFeed,
  getDailyProcurementRollup,
  getPlantTransitReconciliation,
  refreshProcurementMaterializedViews,
} from '@/backend/services/cqrsViewService';

const ALLOWED_ROLES = [
  'HEAD_OF_MPD',
  'SUPER_ADMIN',
  'EXECUTIVE_MANAGEMENT',
  'FINANCE_ACCOUNTS',
  'ZMCC_MANAGER',
  'DATA_EXECUTIVE',
  'QA_HEAD',
  'ADMIN',
];

export async function GET(req: Request) {
  const current = await getCurrentUser(req);
  if (!current) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: BigInt(current.id) },
  });

  if (!user || !ALLOWED_ROLES.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const url = new URL(req.url);
  const viewType = url.searchParams.get('type') || 'proc-rollup';
  const from = url.searchParams.get('from') || undefined;
  const to = url.searchParams.get('to') || undefined;
  const routeId = url.searchParams.get('routeId') || undefined;
  const vehicleNumber = url.searchParams.get('vehicleNumber') || undefined;
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const pageSize = parseInt(url.searchParams.get('pageSize') || '25', 10);

  // Scope determination
  let scope: ManagementScope;
  if (user.role === 'ZMCC_MANAGER') {
    if (!user.procurement_source_id) {
      return NextResponse.json({ error: 'ZMCC Manager has no assigned procurement source.' }, { status: 400 });
    }
    scope = { kind: 'ZMCC', zmccId: user.procurement_source_id.toString() };
  } else {
    scope = { kind: 'SYSTEM' };
  }

  const requestedSourceId = url.searchParams.get('sourceId') || url.searchParams.get('zmccId') || undefined;
  const filters: ManagementFilters = {
    from,
    to,
    sourceId: scope.kind === 'ZMCC' ? scope.zmccId : requestedSourceId,
    routeId,
    vehicleNumber,
    page,
    pageSize,
  };

  try {
    switch (viewType) {
      case 'mot-feed': {
        const data = await getLiveMotCollectionFeed(scope, filters);
        return NextResponse.json(data);
      }
      case 'hc-feed': {
        const data = await getLiveHcSupplierInwardFeed(scope, filters);
        return NextResponse.json(data);
      }
      case 'proc-rollup': {
        const data = await getDailyProcurementRollup(scope, filters);
        return NextResponse.json({ items: data });
      }
      case 'plant-transit': {
        const data = await getPlantTransitReconciliation(scope, filters);
        return NextResponse.json(data);
      }
      default:
        return NextResponse.json({ error: `Unknown view type: ${viewType}` }, { status: 400 });
    }
  } catch (err: any) {
    console.error('Error querying CQRS database view:', err);
    return NextResponse.json({ error: err.message || 'Internal server error querying view.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const current = await getCurrentUser(req);
  if (!current) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: BigInt(current.id) },
  });

  if (!user || !ALLOWED_ROLES.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  try {
    const result = await refreshProcurementMaterializedViews();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Error refreshing materialized views:', err);
    return NextResponse.json({ error: err.message || 'Failed to refresh materialized views.' }, { status: 500 });
  }
}
