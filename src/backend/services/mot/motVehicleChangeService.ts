import { Prisma } from '@prisma/client';
import type { User } from '@backend/core/types';
import { prisma } from '@/backend/core/db';
import { writeAuditLog } from '@/backend/core/audit';
import { clearHandledNotifications, createNotificationsForEvent } from '@/backend/services/notificationService';
import { getDispatchResources } from '@/backend/services/dispatch/dispatchResourceService';
import { getErrorCode } from '@/lib/errors';
import { isInMotScope, resolveMotAuth, type MotAuthContext, type ServiceResult } from './motCore';

const PROBLEM_EVENT = 'MOT_VEHICLE_PROBLEM_PENDING';

const requestInclude = {
  journey: {
    select: {
      id: true,
      journey_number: true,
      status: true,
      route: { select: { name: true } },
      mot_profile: { select: { name: true } },
      stops: { select: { status: true } },
    },
  },
  from_vehicle: { select: { id: true, vehicle_number: true } },
  to_vehicle: { select: { id: true, vehicle_number: true } },
} satisfies Prisma.MotVehicleChangeRequestInclude;

type RequestRow = Prisma.MotVehicleChangeRequestGetPayload<{ include: typeof requestInclude }>;

function serialize(r: RequestRow) {
  return {
    id: r.id.toString(),
    journey_id: r.journey_id.toString(),
    journey_number: r.journey.journey_number,
    route_name: r.journey.route?.name ?? null,
    mot_name: r.journey.mot_profile?.name ?? null,
    zmcc_id: r.zmcc_id.toString(),
    status: r.status,
    reason: r.reason,
    requested_at: r.requested_at.toISOString(),
    decided_at: r.decided_at?.toISOString() ?? null,
    decision_note: r.decision_note,
    from_vehicle: { id: r.from_vehicle.id.toString(), vehicle_number: r.from_vehicle.vehicle_number },
    to_vehicle: r.to_vehicle ? { id: r.to_vehicle.id.toString(), vehicle_number: r.to_vehicle.vehicle_number } : null,
    shops_total: r.journey.stops.length,
    shops_visited: r.journey.stops.filter((s) => s.status === 'VISITED').length,
    visited_shops: (r.visited_shops ?? []) as Array<{ shop_name: string; gross_liters: number }>,
    carried_gross_liters: r.carried_gross_liters === null ? null : Number(r.carried_gross_liters),
  };
}

export type VehicleChangeRequestDto = ReturnType<typeof serialize>;

/** The MOT's own open journey, or the one named when a manager covers MOT work. */
async function findTargetJourney(auth: MotAuthContext, journeyId?: string | null) {
  if (journeyId) {
    let id: bigint;
    try {
      id = BigInt(journeyId);
    } catch {
      return null;
    }
    return prisma.motJourney.findUnique({ where: { id } });
  }
  const profile = await prisma.motProfile.findUnique({ where: { user_id: auth.actorUserId }, select: { id: true } });
  if (!profile) return null;
  return prisma.motJourney.findFirst({
    where: { mot_profile_id: profile.id, status: { in: ['COLLECTING', 'RETURNING'] } },
  });
}

export async function requestVehicleChange(
  reqOrUser: Request | User,
  opts: { journeyId?: string | null; reason?: unknown }
): Promise<ServiceResult<{ request: VehicleChangeRequestDto; message: string }>> {
  const { auth, errorResponse } = await resolveMotAuth(reqOrUser, 'REQUEST_VEHICLE_CHANGE');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const reason = typeof opts.reason === 'string' ? opts.reason.trim() : '';
  if (reason.length < 3) return { status: 400, error: 'Please write what happened to the vehicle.' };

  const journey = await findTargetJourney(auth, opts.journeyId);
  if (!journey) return { status: 404, error: 'No active journey found.' };
  if (!isInMotScope(auth, journey.zmcc_id)) {
    return { status: 403, error: 'Forbidden. Journey belongs to another ZMCC.' };
  }
  if (journey.status !== 'COLLECTING') {
    return { status: 409, error: 'A vehicle can only be replaced while the journey is collecting.' };
  }

  const openRequest = () =>
    prisma.motVehicleChangeRequest.findFirst({
      where: { journey_id: journey.id, status: 'PENDING' },
      include: requestInclude,
    });
  const alreadyOpen = await openRequest();
  if (alreadyOpen) {
    return { status: 200, data: { request: serialize(alreadyOpen), message: 'The Zonal Manager already has your request.' } };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.motVehicleChangeRequest.create({
        data: {
          journey_id: journey.id,
          zmcc_id: journey.zmcc_id,
          from_vehicle_id: journey.mot_vehicle_id,
          reason,
          requested_by: auth.actorUserId,
        },
        include: requestInclude,
      });
      await writeAuditLog(tx, {
        tableName: 'mot_vehicle_change_request',
        recordId: row.id,
        action: 'MOT_VEHICLE_PROBLEM_REPORTED',
        oldValues: null,
        newValues: { journey_number: journey.journey_number, vehicle: row.from_vehicle.vehicle_number, reason },
        actor: { userId: auth.actorUserId, actorRole: auth.role },
      });
      await createNotificationsForEvent(tx, {
        eventKey: PROBLEM_EVENT,
        sourceId: row.id.toString(),
        sourceZmccId: journey.zmcc_id,
        title: 'Vehicle problem: new vehicle needed',
        body: `${row.from_vehicle.vehicle_number}, journey #${journey.journey_number}: ${reason}`,
        deepLink: '/mpd/zmcc-manager?tab=MOT_JOURNEYS',
        dedupeSuffix: row.id.toString(),
      });
      return row;
    });
    return { status: 201, data: { request: serialize(created), message: 'Request sent to the Zonal Manager.' } };
  } catch (err) {
    if (getErrorCode(err) === 'P2002') {
      const existing = await openRequest();
      if (existing) {
        return { status: 200, data: { request: serialize(existing), message: 'The Zonal Manager already has your request.' } };
      }
    }
    throw err;
  }
}

/** Requests on the MOT's journey: the waiting one and the record of earlier vehicle changes. */
export async function listJourneyVehicleChanges(
  reqOrUser: Request | User,
  opts: { journeyId?: string | null }
): Promise<ServiceResult<{ requests: VehicleChangeRequestDto[] }>> {
  const { auth, errorResponse } = await resolveMotAuth(reqOrUser, 'READ_CURRENT_JOURNEY');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const journey = await findTargetJourney(auth, opts.journeyId);
  if (!journey) return { status: 200, data: { requests: [] } };
  if (!isInMotScope(auth, journey.zmcc_id)) {
    return { status: 403, error: 'Forbidden. Journey belongs to another ZMCC.' };
  }
  const rows = await prisma.motVehicleChangeRequest.findMany({
    where: { journey_id: journey.id },
    include: requestInclude,
    orderBy: { requested_at: 'desc' },
  });
  return { status: 200, data: { requests: rows.map(serialize) } };
}

/** The manager's queue, with the free vehicles each ZMCC can give. */
export async function listPendingVehicleChanges(
  reqOrUser: Request | User,
  opts: { zmccId?: string | null }
): Promise<
  ServiceResult<{
    requests: VehicleChangeRequestDto[];
    available_vehicles: Record<string, Array<{ id: string; vehicle_number: string }>>;
  }>
> {
  const { auth, errorResponse } = await resolveMotAuth(reqOrUser, 'DECIDE_VEHICLE_CHANGE');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let zmccId: bigint | null = auth.effectiveZmccId;
  if (auth.isSystemScope && opts.zmccId) {
    try {
      zmccId = BigInt(opts.zmccId);
    } catch {
      return { status: 400, error: 'Invalid ZMCC ID format.' };
    }
  }
  if (zmccId === null && !auth.isSystemScope) return { status: 200, data: { requests: [], available_vehicles: {} } };

  const rows = await prisma.motVehicleChangeRequest.findMany({
    where: { status: 'PENDING', journey: { status: 'COLLECTING' }, ...(zmccId !== null ? { zmcc_id: zmccId } : {}) },
    include: requestInclude,
    orderBy: { requested_at: 'asc' },
  });

  const available_vehicles: Record<string, Array<{ id: string; vehicle_number: string }>> = {};
  for (const id of new Set(rows.map((r) => r.zmcc_id))) {
    const { vehicles } = await getDispatchResources(id);
    available_vehicles[id.toString()] = vehicles
      .filter((v) => v.is_available)
      .map((v) => ({ id: v.id, vehicle_number: v.vehicle_number }));
  }
  return { status: 200, data: { requests: rows.map(serialize), available_vehicles } };
}

export async function decideVehicleChange(
  reqOrUser: Request | User,
  requestId: string,
  input: { decision?: unknown; new_vehicle_id?: unknown; note?: unknown }
): Promise<ServiceResult<{ request: VehicleChangeRequestDto; message: string }>> {
  const { auth, errorResponse } = await resolveMotAuth(reqOrUser, 'DECIDE_VEHICLE_CHANGE');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let id: bigint;
  try {
    id = BigInt(requestId);
  } catch {
    return { status: 400, error: 'Invalid request ID format.' };
  }
  const note = typeof input.note === 'string' ? input.note.trim() : '';

  const row = await prisma.motVehicleChangeRequest.findUnique({ where: { id }, include: requestInclude });
  if (!row) return { status: 404, error: 'Request not found.' };
  if (!isInMotScope(auth, row.zmcc_id)) {
    return { status: 403, error: 'Forbidden. Request belongs to another ZMCC.' };
  }
  const alreadyAnswered = { status: 409, error: 'This request has already been answered.' };
  if (row.status !== 'PENDING') return alreadyAnswered;

  const actor = { userId: auth.actorUserId, actorRole: auth.role };

  if (input.decision === 'REJECT') {
    if (note.length < 3) return { status: 400, error: 'Please write why the request is refused.' };
    const updated = await prisma.$transaction(async (tx) => {
      const { count } = await tx.motVehicleChangeRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'REJECTED', decided_by: auth.actorUserId, decided_at: new Date(), decision_note: note },
      });
      if (count === 0) return null;
      await clearHandledNotifications(tx, [PROBLEM_EVENT], id);
      await writeAuditLog(tx, {
        tableName: 'mot_vehicle_change_request',
        recordId: id,
        action: 'MOT_VEHICLE_CHANGE_REJECTED',
        oldValues: { status: 'PENDING' },
        newValues: { status: 'REJECTED', note },
        actor,
      });
      return tx.motVehicleChangeRequest.findUniqueOrThrow({ where: { id }, include: requestInclude });
    });
    if (!updated) return alreadyAnswered;
    return { status: 200, data: { request: serialize(updated), message: 'Request refused.' } };
  }

  if (input.decision !== 'APPROVE') return { status: 400, error: 'Decision must be APPROVE or REJECT.' };
  if (!input.new_vehicle_id) return { status: 400, error: 'Please choose the new vehicle.' };

  let newVehicleId: bigint;
  try {
    newVehicleId = BigInt(String(input.new_vehicle_id));
  } catch {
    return { status: 400, error: 'Please choose the new vehicle.' };
  }
  if (row.journey.status !== 'COLLECTING') {
    return { status: 409, error: 'This journey is no longer collecting, so its vehicle cannot be changed.' };
  }
  const { vehicles } = await getDispatchResources(row.zmcc_id);
  const chosen = vehicles.find((v) => v.id === newVehicleId.toString());
  if (!chosen) return { status: 400, error: 'That vehicle does not belong to this ZMCC or is inactive.' };
  if (!chosen.is_available) {
    return { status: 409, error: `${chosen.vehicle_number} is not free: ${chosen.busy_reason ?? 'in use'}.` };
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // The record of what this vehicle did; each collection also keeps its own vehicle.
      const collections = await tx.motShopCollection.findMany({
        where: { journey_id: row.journey_id, mot_vehicle_id: row.from_vehicle_id },
        select: { gross_liters: true, shop: { select: { shop_name: true } } },
      });
      const carried = collections.reduce((sum, c) => sum + Number(c.gross_liters), 0);

      const claimed = await tx.motVehicleChangeRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          to_vehicle_id: newVehicleId,
          decided_by: auth.actorUserId,
          decided_at: new Date(),
          decision_note: note || null,
          visited_shops: collections.map((c) => ({
            shop_name: c.shop.shop_name,
            gross_liters: Number(c.gross_liters),
          })),
          carried_gross_liters: new Prisma.Decimal(carried.toFixed(2)),
        },
      });
      if (claimed.count === 0) return null;

      // Same journey, new vehicle: done shops stay done, remaining shops continue, the old vehicle is free.
      const moved = await tx.motJourney.updateMany({
        where: { id: row.journey_id, status: 'COLLECTING', mot_vehicle_id: row.from_vehicle_id },
        data: { mot_vehicle_id: newVehicleId, version: { increment: 1 } },
      });
      if (moved.count === 0) throw new Error('JOURNEY_CHANGED');

      await clearHandledNotifications(tx, [PROBLEM_EVENT], id);
      await writeAuditLog(tx, {
        tableName: 'mot_journey',
        recordId: row.journey_id,
        action: 'MOT_JOURNEY_VEHICLE_CHANGED',
        oldValues: { mot_vehicle_id: row.from_vehicle_id.toString(), vehicle: row.from_vehicle.vehicle_number },
        newValues: {
          mot_vehicle_id: newVehicleId.toString(),
          vehicle: chosen.vehicle_number,
          request_id: id.toString(),
          carried_gross_liters: carried,
        },
        actor,
      });
      return tx.motVehicleChangeRequest.findUniqueOrThrow({ where: { id }, include: requestInclude });
    });
    if (!updated) return alreadyAnswered;
    return {
      status: 200,
      data: {
        request: serialize(updated),
        message: `${chosen.vehicle_number} now carries journey #${row.journey.journey_number}.`,
      },
    };
  } catch (err) {
    if (getErrorCode(err) === 'P2002') {
      return { status: 409, error: `${chosen.vehicle_number} was just given to another journey. Please choose again.` };
    }
    if (err instanceof Error && err.message === 'JOURNEY_CHANGED') {
      return { status: 409, error: 'This journey has changed. Please refresh and try again.' };
    }
    throw err;
  }
}
