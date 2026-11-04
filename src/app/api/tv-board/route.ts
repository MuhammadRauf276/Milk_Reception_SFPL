import { NextResponse } from 'next/server';
import { getPaginatedOperationalLogs } from '@/backend/services/operationalReadModelService';
import { buildVehicleVisitGroups } from '@/frontend/modules/dashboard/zmcc/zmccManagerHelpers';

export const dynamic = 'force-dynamic';

/**
 * Public yard display: every vehicle dispatched to the plant that has not completed,
 * with its stage progress. Only lifecycle and quantity summaries are exposed (no lab values).
 */
export async function GET() {
  const { items } = await getPaginatedOperationalLogs({ mode: 'live', pageSize: 100 }, null, { kind: 'ALL' });
  const vehicles = buildVehicleVisitGroups(items)
    .filter((g) => !g.lifecycle.isComplete)
    .sort((a, b) => a.visitId - b.visitId)
    .map((g) => ({
      visitId: String(g.visitId),
      vehicleNumber: g.vehicleNumber,
      tokenNumber: g.tokenNumber,
      sourceName: g.sourceName,
      portionCount: g.portions.length,
      dispatch13TsLiters: g.totalDispatch13TsLiters,
      dispatchGrossLiters: g.totalDispatchGrossLiters,
      dispatchQuantityValue: g.vehicleDispatchQuantityValue,
      dispatchQuantityUnit: g.vehicleDispatchQuantityUnit,
      firstWeightKg: g.firstWeightKg,
      secondWeightKg: g.secondWeightKg,
      lifecycle: g.lifecycle,
    }));
  return NextResponse.json({ vehicles }, { headers: { 'Cache-Control': 'public, max-age=30' } });
}
