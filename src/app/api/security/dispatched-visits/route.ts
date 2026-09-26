import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { requireCapability } from '@/backend/modules/access-control/serverGuard';
import { vehicleVisitPaperIdentity } from '@/backend/modules/paper-references';

const SECURITY_SCOPE = { kind: 'DEPARTMENT', departmentId: 'Security' } as const;

export async function GET(req: Request) {
  const access = await requireCapability('VIEW', SECURITY_SCOPE, { request: req });
  if (!access.allowed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: access.status });
  }

  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q')?.trim() || '';

  try {
    const visits = await prisma.vehicleVisit.findMany({
      where: {
        current_status: { in: ['Dispatched', 'DISPATCHED'] },
        gate_log: {
          is: null,
        },
        ...(query
          ? {
              OR: [
                { visit_number: { contains: query, mode: 'insensitive' } },
                { reception_number: { contains: query, mode: 'insensitive' } },
                { vehicle_number: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        portions: {
          include: {
            dispatch_info: true,
          },
          orderBy: { portion_number: 'asc' },
        },
        creator: true,
        procurement_source: true,
      },
      orderBy: { created_at: 'desc' },
    });

    const formatted = visits.map((v) => {
      const portions = v.portions || [];
      const totalVehicleQty = v.vehicle_dispatch_quantity_value !== null && v.vehicle_dispatch_quantity_value !== undefined
        ? Number(v.vehicle_dispatch_quantity_value)
        : null;
      const totalVehicleUnit = v.vehicle_dispatch_quantity_unit || null;
      const firstDispatchInfo = portions[0]?.dispatch_info;

      return {
        id: v.id.toString(),
        visit_number: v.visit_number,
        reception_number: v.reception_number || null,
        vehicle_number: v.vehicle_number,
        identifiers: vehicleVisitPaperIdentity(v),
        operational_date: v.operational_date ? v.operational_date.toISOString().split('T')[0] : null,
        current_status: v.current_status,
        portion_count: portions.length,
        vehicle_dispatch_quantity_value: totalVehicleQty,
        vehicle_dispatch_quantity_unit: totalVehicleUnit,
        total_quantity_value: totalVehicleQty,
        total_quantity_unit: totalVehicleUnit,
        dispatch_timestamp: firstDispatchInfo?.dispatch_timestamp ? firstDispatchInfo.dispatch_timestamp.toISOString() : null,
        zonal_contractor_name: v.procurement_source?.name || 'Source unavailable',
      };
    });

    return NextResponse.json({ visits: formatted });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch dispatched visits' }, { status: 500 });
  }
}
