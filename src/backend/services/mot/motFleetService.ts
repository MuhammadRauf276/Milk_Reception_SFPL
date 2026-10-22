import { prisma } from '@core/db';
import type { MotAuthContext } from '@/backend/services/mot/motCore';

export type FleetStatus = 'FREE' | 'COLLECTING' | 'RETURNING' | 'AT_ZMCC_WAITING_UNLOAD' | 'INACTIVE';

export interface FleetTransferEntry {
  at: string;
  from_zmcc: string | null;
  to_zmcc: string | null;
  by: string | null;
}

export interface FleetVehicleRow {
  id: string;
  vehicle_number: string;
  zmcc_id: string;
  zmcc_code: string;
  zmcc_name: string;
  is_active: boolean;
  status: FleetStatus;
  arrival_token: string | null;
  last_journey: {
    id: string;
    journey_number: string;
    status: string;
    operational_date: string;
    started_at: string;
    ended_at: string | null;
    route_name: string | null;
    mot_name: string | null;
  } | null;
  transfers: FleetTransferEntry[];
}

interface AuditValues {
  zmcc_name?: string | null;
  zmcc_code?: string | null;
}

/**
 * Whole fleet (Data Executive / Super Admin). Status:
 *  Free, Collecting, Returning, At ZMCC waiting unload (last arrival not finished), Inactive.
 * Transfer history comes from the audit log.
 */
export async function listFleet(
  auth: MotAuthContext,
  filters?: { zmcc_id?: string; search?: string }
): Promise<FleetVehicleRow[]> {
  const where: Record<string, unknown> = {};
  if (filters?.zmcc_id) {
    try {
      where.zmcc_id = BigInt(filters.zmcc_id);
    } catch {
      return [];
    }
  }
  if (filters?.search?.trim()) {
    where.vehicle_number = { contains: filters.search.trim(), mode: 'insensitive' };
  }
  void auth;

  const vehicles = await prisma.motVehicle.findMany({
    where,
    orderBy: { vehicle_number: 'asc' },
    include: { zmcc: { select: { id: true, code: true, name: true } } },
  });
  if (vehicles.length === 0) return [];
  const ids = vehicles.map((v) => v.id);

  const [lastJourneys, lastArrivals, audits] = await Promise.all([
    Promise.all(
      vehicles.map((v) =>
        prisma.motJourney.findFirst({
          where: { mot_vehicle_id: v.id },
          orderBy: { started_at: 'desc' },
          select: {
            id: true,
            journey_number: true,
            status: true,
            operational_date: true,
            started_at: true,
            ended_at: true,
            route: { select: { name: true } },
            mot_profile: { select: { name: true } },
          },
        })
      )
    ),
    Promise.all(
      vehicles.map((v) =>
        prisma.zmccMotArrival.findFirst({
          where: { journey: { mot_vehicle_id: v.id } },
          orderBy: { arrival_timestamp: 'desc' },
          select: { zmcc_token: true, lab_session: { select: { journey_closed_at: true } } },
        })
      )
    ),
    prisma.auditLog.findMany({
      where: { table_name: 'mot_vehicle', record_id: { in: ids }, action: 'MOT_VEHICLE_TRANSFERRED' },
      orderBy: { created_at: 'desc' },
      include: { user: { select: { username: true, full_name: true } } },
    }),
  ]);

  const transfersByVehicle = new Map<string, FleetTransferEntry[]>();
  for (const a of audits) {
    const key = a.record_id.toString();
    const oldV = (a.old_values ?? {}) as AuditValues;
    const newV = (a.new_values ?? {}) as AuditValues;
    const entry: FleetTransferEntry = {
      at: a.created_at.toISOString(),
      from_zmcc: oldV.zmcc_name ?? oldV.zmcc_code ?? null,
      to_zmcc: newV.zmcc_name ?? newV.zmcc_code ?? null,
      by: a.user ? a.user.full_name || a.user.username : null,
    };
    const list = transfersByVehicle.get(key) ?? [];
    list.push(entry);
    transfersByVehicle.set(key, list);
  }

  return vehicles.map((v, idx) => {
    const j = lastJourneys[idx];
    const arr = lastArrivals[idx];
    const waiting = !!arr && !arr.lab_session?.journey_closed_at;
    let status: FleetStatus;
    if (!v.is_active) status = 'INACTIVE';
    else if (j?.status === 'COLLECTING') status = 'COLLECTING';
    else if (j?.status === 'RETURNING') status = 'RETURNING';
    else if (waiting) status = 'AT_ZMCC_WAITING_UNLOAD';
    else status = 'FREE';

    return {
      id: v.id.toString(),
      vehicle_number: v.vehicle_number,
      zmcc_id: v.zmcc_id.toString(),
      zmcc_code: v.zmcc.code,
      zmcc_name: v.zmcc.name,
      is_active: v.is_active,
      status,
      arrival_token: waiting && arr ? arr.zmcc_token : null,
      last_journey: j
        ? {
            id: j.id.toString(),
            journey_number: j.journey_number,
            status: j.status,
            operational_date: j.operational_date.toISOString().split('T')[0],
            started_at: j.started_at.toISOString(),
            ended_at: j.ended_at ? j.ended_at.toISOString() : null,
            route_name: j.route?.name ?? null,
            mot_name: j.mot_profile?.name ?? null,
          }
        : null,
      transfers: transfersByVehicle.get(v.id.toString()) ?? [],
    };
  });
}
