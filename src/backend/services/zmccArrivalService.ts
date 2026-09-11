import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { getCurrentUser } from '@core/auth';
import { User, Role } from '@core/types';
import { getPakistanCalendarDate } from '@core/business-day';

export interface ZmccArrivalAuthContext {
  user: User;
  actorUserId: bigint;
  role: Role;
  isSuperAdmin: boolean;
  isZmccManager: boolean;
  isPheOperator: boolean;
  effectiveZmccId: bigint | null;
}

export type ZmccArrivalAction =
  | 'SUBMIT_ARRIVAL'
  | 'CORRECT_ARRIVAL'
  | 'READ_ARRIVAL';

export interface ServiceResult<T> {
  status: number;
  data?: T;
  error?: string;
}

export interface SubmitMotArrivalPayload {
  journey_id: string | number | bigint;
  route_milk_token: string;
  arrival_timestamp: string | Date;
  client_event_id: string;
  phe_latitude?: number | null;
  phe_longitude?: number | null;
  phe_gps_accuracy?: number | null;
  zmcc_id?: string | number | bigint;
}

export interface CorrectMotArrivalPayload {
  reason: string;
  route_milk_token?: string;
  arrival_timestamp?: string | Date;
  phe_latitude?: number | null;
  phe_longitude?: number | null;
  phe_gps_accuracy?: number | null;
}

export interface SubmitContractorArrivalPayload {
  contractor_source_id: string | number | bigint;
  vehicle_number: string;
  arrival_timestamp: string | Date;
  client_event_id: string;
  phe_latitude?: number | null;
  phe_longitude?: number | null;
  phe_gps_accuracy?: number | null;
  zmcc_id?: string | number | bigint;
  target_zmcc_id?: string | number | bigint;
}

export interface CorrectContractorArrivalPayload {
  reason: string;
  vehicle_number?: string;
  arrival_timestamp?: string | Date;
  phe_latitude?: number | null;
  phe_longitude?: number | null;
  phe_gps_accuracy?: number | null;
}

export async function resolveZmccArrivalAuth(
  reqOrUser?: Request | User,
  action: ZmccArrivalAction = 'READ_ARRIVAL'
): Promise<{ auth?: ZmccArrivalAuthContext; errorResponse?: { error: string; status: number } }> {
  let authUser: User | null = null;
  if (reqOrUser && 'role' in reqOrUser && 'id' in reqOrUser) {
    authUser = reqOrUser as User;
  } else {
    authUser = await getCurrentUser(reqOrUser as Request);
  }

  if (!authUser) {
    return { errorResponse: { error: 'Unauthorized. Authentication required.', status: 401 } };
  }

  let actorUserId: bigint;
  try {
    actorUserId = BigInt(String(authUser.id).trim());
  } catch {
    return { errorResponse: { error: 'Unauthorized. Invalid user ID format.', status: 401 } };
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: actorUserId },
    include: {
      procurement_source: true,
    },
  });

  if (!dbUser || !dbUser.is_active) {
    return { errorResponse: { error: 'Unauthorized. Account is inactive or unverified.', status: 403 } };
  }

  const role = dbUser.role as Role;
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const isZmccManager = role === 'ZMCC_MANAGER';
  const isPheOperator = role === 'PHE_OPERATOR';

  if (action === 'SUBMIT_ARRIVAL') {
    if (!isPheOperator && !isSuperAdmin) {
      return {
        errorResponse: {
          error: 'Forbidden. Only PHE Operators or Super Admins may record arrivals.',
          status: 403,
        },
      };
    }
  } else if (action === 'CORRECT_ARRIVAL') {
    if (!isZmccManager && !isSuperAdmin) {
      return {
        errorResponse: {
          error: 'Forbidden. Only ZMCC Managers or Super Admins may correct arrival records.',
          status: 403,
        },
      };
    }
  } else if (action === 'READ_ARRIVAL') {
    if (!isSuperAdmin && !isZmccManager && !isPheOperator) {
      return {
        errorResponse: {
          error: 'Forbidden. You do not have permission to view ZMCC arrivals.',
          status: 403,
        },
      };
    }
  }

  let effectiveZmccId: bigint | null = null;
  if (!isSuperAdmin) {
    if (!dbUser.procurement_source_id || !dbUser.procurement_source) {
      return {
        errorResponse: {
          error: 'Forbidden. Scoped user must be assigned to an active ZMCC procurement source.',
          status: 403,
        },
      };
    }
    if (!dbUser.procurement_source.is_active) {
      return {
        errorResponse: {
          error: 'Forbidden. Assigned procurement source is inactive.',
          status: 403,
        },
      };
    }
    if (dbUser.procurement_source.source_type !== 'ZMCC') {
      return {
        errorResponse: {
          error: 'Forbidden. Assigned procurement source is not a ZMCC.',
          status: 403,
        },
      };
    }
    effectiveZmccId = dbUser.procurement_source_id;
  }

  return {
    auth: {
      user: {
        id: dbUser.id.toString(),
        username: dbUser.username,
        name: dbUser.full_name || dbUser.username,
        role: dbUser.role as Role,
        department: dbUser.department || '',
        scope_type: dbUser.scope_type,
        procurement_source_id: dbUser.procurement_source_id ? dbUser.procurement_source_id.toString() : null,
        procurement_source: dbUser.procurement_source
          ? {
              id: dbUser.procurement_source.id.toString(),
              code: dbUser.procurement_source.code,
              name: dbUser.procurement_source.name,
              source_type: dbUser.procurement_source.source_type,
              is_active: dbUser.procurement_source.is_active,
            }
          : null,
      },
      actorUserId,
      role,
      isSuperAdmin,
      isZmccManager,
      isPheOperator,
      effectiveZmccId,
    },
  };
}

function validateGpsCoords(
  latitude?: number | null,
  longitude?: number | null,
  gpsAccuracy?: number | null
): { lat: number | null; lng: number | null; acc: number | null; error?: string } {
  const hasLat = latitude !== undefined && latitude !== null;
  const hasLng = longitude !== undefined && longitude !== null;
  const hasAcc = gpsAccuracy !== undefined && gpsAccuracy !== null;

  if (!hasLat && !hasLng) {
    if (hasAcc) {
      return { lat: null, lng: null, acc: null, error: 'GPS accuracy cannot be provided without latitude and longitude.' };
    }
    return { lat: null, lng: null, acc: null };
  }

  if (!hasLat || !hasLng) {
    return { lat: null, lng: null, acc: null, error: 'Both latitude and longitude must be provided together.' };
  }

  const lat = Number(latitude);
  const lng = Number(longitude);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) {
    return { lat: null, lng: null, acc: null, error: 'Invalid GPS coordinates provided.' };
  }

  let acc: number | null = null;
  if (hasAcc) {
    acc = Number(gpsAccuracy);
    if (isNaN(acc) || acc < 0) {
      return { lat: null, lng: null, acc: null, error: 'GPS accuracy must be a non-negative number.' };
    }
  }

  return { lat, lng, acc };
}

interface MotArrivalReplayComparison {
  journey_id: bigint;
  route_milk_token: string;
  arrival_timestamp: Date;
  phe_latitude: number | null;
  phe_longitude: number | null;
  phe_gps_accuracy: number | null;
}

function isExactMotArrivalReplay(
  existing: {
    journey_id: bigint;
    route_milk_token: string;
    arrival_timestamp: Date | string;
    phe_latitude: any;
    phe_longitude: any;
    phe_gps_accuracy: any;
  },
  expected: MotArrivalReplayComparison
): boolean {
  if (existing.journey_id !== expected.journey_id) return false;
  if (existing.route_milk_token.trim() !== expected.route_milk_token.trim()) return false;

  const existingTime = new Date(existing.arrival_timestamp).getTime();
  const expectedTime = expected.arrival_timestamp.getTime();
  if (Math.abs(existingTime - expectedTime) >= 1000) return false;

  const existingLat = existing.phe_latitude != null ? Number(existing.phe_latitude) : null;
  const existingLng = existing.phe_longitude != null ? Number(existing.phe_longitude) : null;
  const existingAcc = existing.phe_gps_accuracy != null ? Number(existing.phe_gps_accuracy) : null;

  if (expected.phe_latitude == null) {
    if (existingLat != null) return false;
  } else {
    if (existingLat == null || Math.abs(expected.phe_latitude - existingLat) >= 0.0001) return false;
  }

  if (expected.phe_longitude == null) {
    if (existingLng != null) return false;
  } else {
    if (existingLng == null || Math.abs(expected.phe_longitude - existingLng) >= 0.0001) return false;
  }

  if (expected.phe_gps_accuracy == null) {
    if (existingAcc != null) return false;
  } else {
    if (existingAcc == null || Math.abs(expected.phe_gps_accuracy - existingAcc) >= 0.01) return false;
  }

  return true;
}

interface ContractorArrivalReplayComparison {
  zmcc_id: bigint;
  contractor_source_id: bigint;
  vehicle_number: string;
  arrival_timestamp: Date;
  phe_latitude: number | null;
  phe_longitude: number | null;
  phe_gps_accuracy: number | null;
}

function isExactContractorArrivalReplay(
  existing: {
    zmcc_id: bigint;
    contractor_source_id: bigint;
    vehicle_number: string;
    arrival_timestamp: Date | string;
    phe_latitude: any;
    phe_longitude: any;
    phe_gps_accuracy: any;
  },
  expected: ContractorArrivalReplayComparison
): boolean {
  if (existing.zmcc_id !== expected.zmcc_id) return false;
  if (existing.contractor_source_id !== expected.contractor_source_id) return false;
  if (existing.vehicle_number.trim().toUpperCase() !== expected.vehicle_number.trim().toUpperCase()) return false;

  const existingTime = new Date(existing.arrival_timestamp).getTime();
  const expectedTime = expected.arrival_timestamp.getTime();
  if (Math.abs(existingTime - expectedTime) >= 1000) return false;

  const existingLat = existing.phe_latitude != null ? Number(existing.phe_latitude) : null;
  const existingLng = existing.phe_longitude != null ? Number(existing.phe_longitude) : null;
  const existingAcc = existing.phe_gps_accuracy != null ? Number(existing.phe_gps_accuracy) : null;

  if (expected.phe_latitude == null) {
    if (existingLat != null) return false;
  } else {
    if (existingLat == null || Math.abs(expected.phe_latitude - existingLat) >= 0.0001) return false;
  }

  if (expected.phe_longitude == null) {
    if (existingLng != null) return false;
  } else {
    if (existingLng == null || Math.abs(expected.phe_longitude - existingLng) >= 0.0001) return false;
  }

  if (expected.phe_gps_accuracy == null) {
    if (existingAcc != null) return false;
  } else {
    if (existingAcc == null || Math.abs(expected.phe_gps_accuracy - existingAcc) >= 0.01) return false;
  }

  return true;
}

export function serializeMotArrival(arrival: any) {
  return {
    id: arrival.id.toString(),
    journey_id: arrival.journey_id.toString(),
    zmcc_id: arrival.zmcc_id.toString(),
    route_milk_token: arrival.route_milk_token,
    zmcc_token: arrival.zmcc_token,
    arrival_timestamp: arrival.arrival_timestamp instanceof Date ? arrival.arrival_timestamp.toISOString() : arrival.arrival_timestamp,
    arrival_date: arrival.arrival_date instanceof Date ? arrival.arrival_date.toISOString().split('T')[0] : arrival.arrival_date,
    phe_latitude: arrival.phe_latitude != null ? Number(arrival.phe_latitude) : null,
    phe_longitude: arrival.phe_longitude != null ? Number(arrival.phe_longitude) : null,
    phe_gps_accuracy: arrival.phe_gps_accuracy != null ? Number(arrival.phe_gps_accuracy) : null,
    client_event_id: arrival.client_event_id,
    recorded_by_user_id: arrival.recorded_by_user_id.toString(),
    recorded_by: arrival.recorded_by
      ? {
          id: arrival.recorded_by.id.toString(),
          username: arrival.recorded_by.username,
          full_name: arrival.recorded_by.full_name,
        }
      : undefined,
    submitted_at: arrival.submitted_at instanceof Date ? arrival.submitted_at.toISOString() : arrival.submitted_at,
    correction_count: arrival.correction_count,
    created_at: arrival.created_at instanceof Date ? arrival.created_at.toISOString() : arrival.created_at,
    updated_at: arrival.updated_at instanceof Date ? arrival.updated_at.toISOString() : arrival.updated_at,
    journey: arrival.journey
      ? {
          id: arrival.journey.id.toString(),
          journey_number: arrival.journey.journey_number,
          status: arrival.journey.status,
          route_code: arrival.journey.route?.route_code,
          route_name: arrival.journey.route?.name,
          vehicle_number: arrival.journey.mot_vehicle?.vehicle_number,
          mot_name: arrival.journey.mot_profile?.name,
          mot_code: arrival.journey.mot_profile?.mot_code,
          ended_at: arrival.journey.ended_at ? arrival.journey.ended_at.toISOString() : null,
          final_mot_gps: arrival.journey.final_mot_gps_at ? {
            timestamp: arrival.journey.final_mot_gps_at.toISOString(),
            latitude: arrival.journey.final_mot_latitude != null ? Number(arrival.journey.final_mot_latitude) : null,
            longitude: arrival.journey.final_mot_longitude != null ? Number(arrival.journey.final_mot_longitude) : null,
            gps_accuracy: arrival.journey.final_mot_gps_accuracy != null ? Number(arrival.journey.final_mot_gps_accuracy) : null,
          } : null,
        }
      : undefined,
    zmcc: arrival.zmcc
      ? {
          id: arrival.zmcc.id.toString(),
          code: arrival.zmcc.code,
          name: arrival.zmcc.name,
        }
      : undefined,
  };
}

export function serializeContractorArrival(arrival: any) {
  return {
    id: arrival.id.toString(),
    zmcc_id: arrival.zmcc_id.toString(),
    contractor_source_id: arrival.contractor_source_id.toString(),
    vehicle_number: arrival.vehicle_number,
    arrival_timestamp: arrival.arrival_timestamp instanceof Date ? arrival.arrival_timestamp.toISOString() : arrival.arrival_timestamp,
    arrival_date: arrival.arrival_date instanceof Date ? arrival.arrival_date.toISOString().split('T')[0] : arrival.arrival_date,
    zmcc_token: arrival.zmcc_token,
    phe_latitude: arrival.phe_latitude != null ? Number(arrival.phe_latitude) : null,
    phe_longitude: arrival.phe_longitude != null ? Number(arrival.phe_longitude) : null,
    phe_gps_accuracy: arrival.phe_gps_accuracy != null ? Number(arrival.phe_gps_accuracy) : null,
    client_event_id: arrival.client_event_id,
    recorded_by_user_id: arrival.recorded_by_user_id.toString(),
    recorded_by: arrival.recorded_by
      ? {
          id: arrival.recorded_by.id.toString(),
          username: arrival.recorded_by.username,
          full_name: arrival.recorded_by.full_name,
        }
      : undefined,
    submitted_at: arrival.submitted_at instanceof Date ? arrival.submitted_at.toISOString() : arrival.submitted_at,
    correction_count: arrival.correction_count,
    created_at: arrival.created_at instanceof Date ? arrival.created_at.toISOString() : arrival.created_at,
    updated_at: arrival.updated_at instanceof Date ? arrival.updated_at.toISOString() : arrival.updated_at,
    contractor_source: arrival.contractor_source
      ? {
          id: arrival.contractor_source.id.toString(),
          code: arrival.contractor_source.code,
          name: arrival.contractor_source.name,
          source_type: arrival.contractor_source.source_type,
        }
      : undefined,
    zmcc: arrival.zmcc
      ? {
          id: arrival.zmcc.id.toString(),
          code: arrival.zmcc.code,
          name: arrival.zmcc.name,
        }
      : undefined,
  };
}

export async function submitMotArrival(
  reqOrUser: Request | User,
  payload: SubmitMotArrivalPayload
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'SUBMIT_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  if (!payload || typeof payload !== 'object') {
    return { status: 400, error: 'Missing request payload.' };
  }

  const rawJourneyId = payload.journey_id;
  if (rawJourneyId === undefined || rawJourneyId === null || String(rawJourneyId).trim() === '') {
    return { status: 400, error: 'journey_id is required.' };
  }
  let journeyId: bigint;
  try {
    journeyId = BigInt(String(rawJourneyId).trim());
  } catch {
    return { status: 400, error: 'Invalid journey_id format.' };
  }

  const routeMilkToken = typeof payload.route_milk_token === 'string' ? payload.route_milk_token.trim() : '';
  if (!routeMilkToken) {
    return { status: 400, error: 'route_milk_token is required.' };
  }

  const clientEventId = typeof payload.client_event_id === 'string' ? payload.client_event_id.trim() : '';
  if (!clientEventId) {
    return { status: 400, error: 'client_event_id is required.' };
  }

  const arrivalDate = new Date(payload.arrival_timestamp);
  if (isNaN(arrivalDate.getTime())) {
    return { status: 400, error: 'Invalid arrival_timestamp.' };
  }

  const now = new Date();
  if (arrivalDate.getTime() > now.getTime() + 5 * 60 * 1000) {
    return { status: 400, error: 'arrival_timestamp cannot be in the future.' };
  }

  const gpsValidation = validateGpsCoords(payload.phe_latitude, payload.phe_longitude, payload.phe_gps_accuracy);
  if (gpsValidation.error) {
    return { status: 400, error: gpsValidation.error };
  }

  const expectedMotPayload: MotArrivalReplayComparison = {
    journey_id: journeyId,
    route_milk_token: routeMilkToken,
    arrival_timestamp: arrivalDate,
    phe_latitude: gpsValidation.lat,
    phe_longitude: gpsValidation.lng,
    phe_gps_accuracy: gpsValidation.acc,
  };

  const existingByEventId = await prisma.zmccMotArrival.findUnique({
    where: { client_event_id: clientEventId },
    include: {
      journey: {
        include: {
          route: true,
          mot_vehicle: true,
          mot_profile: true,
        },
      },
      zmcc: true,
      recorded_by: true,
    },
  });

  if (existingByEventId) {
    if (isExactMotArrivalReplay(existingByEventId, expectedMotPayload)) {
      return {
        status: 200,
        data: {
          ...serializeMotArrival(existingByEventId),
          is_replay: true,
        },
      };
    } else {
      return {
        status: 409,
        error: 'Conflict: Reused client_event_id with differing payload.',
      };
    }
  }

  const journey = await prisma.motJourney.findUnique({
    where: { id: journeyId },
    include: {
      zmcc: true,
      route: true,
      mot_vehicle: true,
      mot_profile: true,
      mot_arrival: true,
      stops: {
        select: {
          collection: {
            select: { device_collected_at: true },
          },
        },
      },
      locations: {
        select: { device_recorded_at: true },
        orderBy: { device_recorded_at: 'desc' },
        take: 1,
      },
    },
  });

  if (!journey) {
    return { status: 404, error: 'Journey not found.' };
  }

  if (!auth.isSuperAdmin && journey.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Journey belongs to a different ZMCC.' };
  }

  if (journey.mot_arrival) {
    return {
      status: 409,
      error: `Conflict: Journey ${journey.journey_number} already has an arrival recorded (ZMCC Token: ${journey.mot_arrival.zmcc_token}).`,
    };
  }

  if (journey.status !== 'COLLECTING') {
    return {
      status: 409,
      error: `Conflict: Journey ${journey.journey_number} is in ${journey.status} status and cannot accept arrival. Must be COLLECTING.`,
    };
  }

  if (arrivalDate.getTime() < new Date(journey.started_at).getTime()) {
    return {
      status: 400,
      error: `arrival_timestamp cannot predate journey start time (${journey.started_at.toISOString()}).`,
    };
  }

  for (const stop of journey.stops) {
    if (stop.collection && arrivalDate.getTime() < new Date(stop.collection.device_collected_at).getTime()) {
      return {
        status: 400,
        error: `arrival_timestamp cannot predate collection recorded at ${stop.collection.device_collected_at.toISOString()}.`,
      };
    }
  }

  if (journey.locations.length > 0) {
    const latestLocTime = new Date(journey.locations[0].device_recorded_at).getTime();
    if (arrivalDate.getTime() < latestLocTime) {
      return {
        status: 400,
        error: `arrival_timestamp cannot predate latest GPS point recorded at ${journey.locations[0].device_recorded_at.toISOString()}.`,
      };
    }
  }

  const pktDateStr = getPakistanCalendarDate(arrivalDate);
  const dateCode = pktDateStr.replace(/-/g, '');
  const arrivalDatePkt = new Date(`${pktDateStr}T00:00:00.000Z`);

  try {
    const createdArrival = await prisma.$transaction(async (tx) => {
      const checkJourney = await tx.motJourney.findUnique({
        where: { id: journeyId },
        select: { status: true, mot_arrival: { select: { id: true } } },
      });
      if (!checkJourney || checkJourney.status !== 'COLLECTING' || checkJourney.mot_arrival) {
        throw new Error('JOURNEY_ALREADY_COMPLETED');
      }

      const seqResult = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('zmcc_token_seq') as nextval`;
      if (!seqResult || seqResult.length === 0 || seqResult[0].nextval === undefined || seqResult[0].nextval === null) {
        throw new Error('FAILED_TO_ALLOCATE_ZMCC_TOKEN_SEQUENCE');
      }
      const seqNum = Number(seqResult[0].nextval);
      const zmccToken = `ZT-MOT-${dateCode}-${String(seqNum).padStart(4, '0')}`;

      const latestDeviceLoc = await tx.motJourneyLocation.findFirst({
        where: {
          journey_id: journey.id,
          source_type: 'MOT_DEVICE',
          device_recorded_at: { lte: arrivalDate },
        },
        orderBy: { device_recorded_at: 'desc' },
      });

      const arrival = await tx.zmccMotArrival.create({
        data: {
          journey_id: journey.id,
          zmcc_id: journey.zmcc_id,
          route_milk_token: routeMilkToken,
          zmcc_token: zmccToken,
          arrival_timestamp: arrivalDate,
          arrival_date: arrivalDatePkt,
          phe_latitude: gpsValidation.lat != null ? new Prisma.Decimal(gpsValidation.lat.toFixed(7)) : null,
          phe_longitude: gpsValidation.lng != null ? new Prisma.Decimal(gpsValidation.lng.toFixed(7)) : null,
          phe_gps_accuracy: gpsValidation.acc != null ? new Prisma.Decimal(gpsValidation.acc.toFixed(2)) : null,
          client_event_id: clientEventId,
          recorded_by_user_id: auth.actorUserId,
          submitted_at: now,
          correction_count: 0,
        },
        include: {
          journey: {
            include: {
              route: true,
              mot_vehicle: true,
              mot_profile: true,
            },
          },
          zmcc: true,
          recorded_by: true,
        },
      });

      await tx.motJourney.update({
        where: { id: journey.id },
        data: {
          status: 'COMPLETED',
          ended_at: arrivalDate,
          final_mot_gps_at: latestDeviceLoc ? latestDeviceLoc.device_recorded_at : null,
          final_mot_latitude: latestDeviceLoc ? latestDeviceLoc.latitude : null,
          final_mot_longitude: latestDeviceLoc ? latestDeviceLoc.longitude : null,
          final_mot_gps_accuracy: latestDeviceLoc ? latestDeviceLoc.gps_accuracy : null,
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'zmcc_mot_arrival',
          record_id: arrival.id,
          action: 'ZMCC_MOT_ARRIVAL_SUBMITTED',
          old_values: Prisma.DbNull,
          new_values: {
            journey_id: journey.id.toString(),
            journey_number: journey.journey_number,
            route_milk_token: routeMilkToken,
            zmcc_token: zmccToken,
            arrival_timestamp: arrivalDate.toISOString(),
            arrival_date: pktDateStr,
            client_event_id: clientEventId,
          },
          user_id: auth.actorUserId,
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'mot_journey',
          record_id: journey.id,
          action: 'MOT_JOURNEY_COMPLETED_AT_ZMCC',
          old_values: { status: 'COLLECTING' },
          new_values: {
            journey_number: journey.journey_number,
            status: 'COMPLETED',
            ended_at: arrivalDate.toISOString(),
            zmcc_token: zmccToken,
            arrival_id: arrival.id.toString(),
          },
          user_id: auth.actorUserId,
        },
      });

      return arrival;
    });

    return {
      status: 201,
      data: serializeMotArrival(createdArrival),
    };
  } catch (err: any) {
    if (err.message === 'JOURNEY_ALREADY_COMPLETED' || err.code === 'P2002') {
      const existingAfterCollision = await prisma.zmccMotArrival.findUnique({
        where: { client_event_id: clientEventId },
        include: {
          journey: {
            include: {
              route: true,
              mot_vehicle: true,
              mot_profile: true,
            },
          },
          zmcc: true,
          recorded_by: true,
        },
      });
      if (existingAfterCollision) {
        if (isExactMotArrivalReplay(existingAfterCollision, expectedMotPayload)) {
          return {
            status: 200,
            data: {
              ...serializeMotArrival(existingAfterCollision),
              is_replay: true,
            },
          };
        } else {
          return {
            status: 409,
            error: 'Conflict: Concurrent arrival submission collision or duplicate client_event_id with differing payload.',
          };
        }
      }
      return {
        status: 409,
        error: 'Conflict: Journey has already been completed or an arrival was recorded concurrently.',
      };
    }
    console.error('submitMotArrival unexpected error:', err);
    return { status: 500, error: 'Internal server error while recording MOT arrival.' };
  }
}

export async function correctMotArrival(
  reqOrUser: Request | User,
  arrivalIdParam: string | number | bigint,
  payload: CorrectMotArrivalPayload
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'CORRECT_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let arrivalId: bigint;
  try {
    arrivalId = BigInt(String(arrivalIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid arrival ID format.' };
  }

  if (!payload || typeof payload !== 'object') {
    return { status: 400, error: 'Missing correction payload.' };
  }

  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (!reason) {
    return { status: 400, error: 'reason is mandatory for arrival corrections.' };
  }

  const arrival = await prisma.zmccMotArrival.findUnique({
    where: { id: arrivalId },
    include: {
      journey: {
        include: {
          stops: {
            select: { collection: { select: { device_collected_at: true } } },
          },
          locations: {
            select: { device_recorded_at: true },
            orderBy: { device_recorded_at: 'desc' },
            take: 1,
          },
        },
      },
      zmcc: true,
      recorded_by: true,
    },
  });

  if (!arrival) {
    return { status: 404, error: 'MOT Arrival record not found.' };
  }

  if (!auth.isSuperAdmin && arrival.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Arrival record belongs to another ZMCC.' };
  }

  if (arrival.correction_count >= 2) {
    return {
      status: 400,
      error: 'Maximum number of corrections (2) has been reached for this arrival record.',
    };
  }

  const updateData: Prisma.ZmccMotArrivalUpdateInput = {};

  const oldValues: Record<string, any> = {};
  const newValues: Record<string, any> = {};
  let newArrivalDate: Date | null = null;

  if (payload.route_milk_token !== undefined) {
    const trimmedToken = String(payload.route_milk_token).trim();
    if (!trimmedToken) {
      return { status: 400, error: 'route_milk_token cannot be blank.' };
    }
    if (trimmedToken !== arrival.route_milk_token) {
      oldValues.route_milk_token = arrival.route_milk_token;
      newValues.route_milk_token = trimmedToken;
      updateData.route_milk_token = trimmedToken;
    }
  }

  if (payload.arrival_timestamp !== undefined) {
    const parsedTime = new Date(payload.arrival_timestamp);
    if (isNaN(parsedTime.getTime())) {
      return { status: 400, error: 'Invalid arrival_timestamp format.' };
    }
    const now = new Date();
    if (parsedTime.getTime() > now.getTime() + 5 * 60 * 1000) {
      return { status: 400, error: 'arrival_timestamp cannot be in the future.' };
    }
    if (parsedTime.getTime() < new Date(arrival.journey.started_at).getTime()) {
      return {
        status: 400,
        error: `arrival_timestamp cannot predate journey start time (${arrival.journey.started_at.toISOString()}).`,
      };
    }
    for (const stop of arrival.journey.stops) {
      if (stop.collection && parsedTime.getTime() < new Date(stop.collection.device_collected_at).getTime()) {
        return {
          status: 400,
          error: `arrival_timestamp cannot predate collection recorded at ${stop.collection.device_collected_at.toISOString()}.`,
        };
      }
    }
    if (arrival.journey.locations.length > 0) {
      const latestLocTime = new Date(arrival.journey.locations[0].device_recorded_at).getTime();
      if (parsedTime.getTime() < latestLocTime) {
        return {
          status: 400,
          error: `arrival_timestamp cannot predate latest GPS point recorded at ${arrival.journey.locations[0].device_recorded_at.toISOString()}.`,
        };
      }
    }

    if (parsedTime.getTime() !== arrival.arrival_timestamp.getTime()) {
      oldValues.arrival_timestamp = arrival.arrival_timestamp.toISOString();
      newValues.arrival_timestamp = parsedTime.toISOString();
      updateData.arrival_timestamp = parsedTime;
      newArrivalDate = parsedTime;

      const pktDateStr = getPakistanCalendarDate(parsedTime);
      updateData.arrival_date = new Date(`${pktDateStr}T00:00:00.000Z`);
    }
  }

  if (payload.phe_latitude !== undefined || payload.phe_longitude !== undefined) {
    const gpsValidation = validateGpsCoords(payload.phe_latitude, payload.phe_longitude, payload.phe_gps_accuracy);
    if (gpsValidation.error) {
      return { status: 400, error: gpsValidation.error };
    }
    oldValues.phe_latitude = arrival.phe_latitude != null ? Number(arrival.phe_latitude) : null;
    oldValues.phe_longitude = arrival.phe_longitude != null ? Number(arrival.phe_longitude) : null;
    oldValues.phe_gps_accuracy = arrival.phe_gps_accuracy != null ? Number(arrival.phe_gps_accuracy) : null;

    newValues.phe_latitude = gpsValidation.lat;
    newValues.phe_longitude = gpsValidation.lng;
    newValues.phe_gps_accuracy = gpsValidation.acc;

    updateData.phe_latitude = gpsValidation.lat != null ? new Prisma.Decimal(gpsValidation.lat.toFixed(7)) : null;
    updateData.phe_longitude = gpsValidation.lng != null ? new Prisma.Decimal(gpsValidation.lng.toFixed(7)) : null;
    updateData.phe_gps_accuracy = gpsValidation.acc != null ? new Prisma.Decimal(gpsValidation.acc.toFixed(2)) : null;
  }

  if (Object.keys(newValues).length === 0) {
    return { status: 400, error: 'No values were modified in this correction request.' };
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Concurrency safety: acquire row-level lock on the arrival record
      const lockedRows = await tx.$queryRaw<{ id: bigint; correction_count: number }[]>`
        SELECT id, correction_count FROM zmcc_mot_arrival WHERE id = ${arrivalId} FOR UPDATE
      `;
      if (!lockedRows || lockedRows.length === 0) {
        throw new Error('ARRIVAL_NOT_FOUND');
      }
      const currentCount = lockedRows[0].correction_count;
      if (currentCount >= 2) {
        throw new Error('MAX_CORRECTIONS_REACHED');
      }

      const nextCorrectionCount = currentCount + 1;
      const updatedRecord = await tx.zmccMotArrival.update({
        where: { id: arrivalId },
        data: {
          ...updateData,
          correction_count: nextCorrectionCount,
        },
        include: {
          journey: {
            include: {
              route: true,
              mot_vehicle: true,
              mot_profile: true,
            },
          },
          zmcc: true,
          recorded_by: true,
        },
      });

      if (newArrivalDate) {
        const latestDeviceLoc = await tx.motJourneyLocation.findFirst({
          where: {
            journey_id: arrival.journey_id,
            source_type: 'MOT_DEVICE',
            device_recorded_at: { lte: newArrivalDate },
          },
          orderBy: { device_recorded_at: 'desc' },
        });

        await tx.motJourney.update({
          where: { id: arrival.journey_id },
          data: {
            ended_at: newArrivalDate,
            final_mot_gps_at: latestDeviceLoc ? latestDeviceLoc.device_recorded_at : null,
            final_mot_latitude: latestDeviceLoc ? latestDeviceLoc.latitude : null,
            final_mot_longitude: latestDeviceLoc ? latestDeviceLoc.longitude : null,
            final_mot_gps_accuracy: latestDeviceLoc ? latestDeviceLoc.gps_accuracy : null,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          table_name: 'zmcc_mot_arrival',
          record_id: arrivalId,
          action: 'ZMCC_MOT_ARRIVAL_CORRECTED',
          old_values: oldValues,
          new_values: {
            ...newValues,
            correction_reason: reason,
            correction_count: nextCorrectionCount,
          },
          user_id: auth.actorUserId,
        },
      });

      return updatedRecord;
    });

    return {
      status: 200,
      data: serializeMotArrival(updated),
    };
  } catch (err: any) {
    if (err.message === 'MAX_CORRECTIONS_REACHED') {
      return {
        status: 409,
        error: 'Conflict: Maximum number of corrections (2) has been reached or another correction was committed concurrently.',
      };
    }
    if (err.message === 'ARRIVAL_NOT_FOUND') {
      return { status: 404, error: 'MOT Arrival record not found.' };
    }
    console.error('correctMotArrival error:', err);
    return { status: 500, error: 'Internal server error while correcting MOT arrival.' };
  }
}

export async function submitContractorArrival(
  reqOrUser: Request | User,
  payload: SubmitContractorArrivalPayload
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'SUBMIT_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  if (!payload || typeof payload !== 'object') {
    return { status: 400, error: 'Missing request payload.' };
  }

  const rawContractorId = payload.contractor_source_id;
  if (rawContractorId === undefined || rawContractorId === null || String(rawContractorId).trim() === '') {
    return { status: 400, error: 'contractor_source_id is required.' };
  }
  let contractorSourceId: bigint;
  try {
    contractorSourceId = BigInt(String(rawContractorId).trim());
  } catch {
    return { status: 400, error: 'Invalid contractor_source_id format.' };
  }

  const vehicleNumber = typeof payload.vehicle_number === 'string' ? payload.vehicle_number.trim().toUpperCase() : '';
  if (!vehicleNumber) {
    return { status: 400, error: 'vehicle_number is required.' };
  }

  const clientEventId = typeof payload.client_event_id === 'string' ? payload.client_event_id.trim() : '';
  if (!clientEventId) {
    return { status: 400, error: 'client_event_id is required.' };
  }

  const arrivalDate = new Date(payload.arrival_timestamp);
  if (isNaN(arrivalDate.getTime())) {
    return { status: 400, error: 'Invalid arrival_timestamp.' };
  }

  const now = new Date();
  if (arrivalDate.getTime() > now.getTime() + 5 * 60 * 1000) {
    return { status: 400, error: 'arrival_timestamp cannot be in the future.' };
  }

  const gpsValidation = validateGpsCoords(payload.phe_latitude, payload.phe_longitude, payload.phe_gps_accuracy);
  if (gpsValidation.error) {
    return { status: 400, error: gpsValidation.error };
  }

  let targetZmccId: bigint | null = null;
  const rawTargetZmccId = payload.zmcc_id ?? payload.target_zmcc_id;
  if (auth.isSuperAdmin) {
    if (!rawTargetZmccId || String(rawTargetZmccId).trim() === '') {
      return { status: 400, error: 'target_zmcc_id is required for Super Admin.' };
    }
    try {
      targetZmccId = BigInt(String(rawTargetZmccId).trim());
    } catch {
      return { status: 400, error: 'Invalid target_zmcc_id format.' };
    }
  } else {
    targetZmccId = auth.effectiveZmccId;
  }

  if (!targetZmccId) {
    return { status: 400, error: 'Target ZMCC could not be resolved.' };
  }

  // Validate target ZMCC exists, is active, and is of type 'ZMCC'
  const targetZmcc = await prisma.procurementSource.findUnique({
    where: { id: targetZmccId },
  });
  if (!targetZmcc) {
    return { status: 404, error: 'Target ZMCC procurement source not found.' };
  }
  if (targetZmcc.source_type !== 'ZMCC') {
    return { status: 400, error: `Target source is not of type ZMCC (found: ${targetZmcc.source_type}).` };
  }
  if (!targetZmcc.is_active) {
    return { status: 400, error: 'Target ZMCC procurement source is inactive.' };
  }

  const contractorSource = await prisma.procurementSource.findUnique({
    where: { id: contractorSourceId },
  });
  if (!contractorSource) {
    return { status: 404, error: 'Contractor procurement source not found.' };
  }
  if (contractorSource.source_type !== 'CONTRACTOR') {
    return { status: 400, error: 'Selected procurement source is not of type CONTRACTOR.' };
  }
  if (!contractorSource.is_active) {
    return { status: 400, error: 'Selected contractor procurement source is inactive.' };
  }

  const expectedContractorPayload: ContractorArrivalReplayComparison = {
    zmcc_id: targetZmccId,
    contractor_source_id: contractorSourceId,
    vehicle_number: vehicleNumber,
    arrival_timestamp: arrivalDate,
    phe_latitude: gpsValidation.lat,
    phe_longitude: gpsValidation.lng,
    phe_gps_accuracy: gpsValidation.acc,
  };

  const existingByEventId = await prisma.zmccContractorArrival.findUnique({
    where: { client_event_id: clientEventId },
    include: {
      contractor_source: true,
      zmcc: true,
      recorded_by: true,
    },
  });

  if (existingByEventId) {
    if (isExactContractorArrivalReplay(existingByEventId, expectedContractorPayload)) {
      return {
        status: 200,
        data: {
          ...serializeContractorArrival(existingByEventId),
          is_replay: true,
        },
      };
    } else {
      return {
        status: 409,
        error: 'Conflict: Reused client_event_id with differing contractor arrival payload.',
      };
    }
  }

  const pktDateStr = getPakistanCalendarDate(arrivalDate);
  const dateCode = pktDateStr.replace(/-/g, '');
  const arrivalDatePkt = new Date(`${pktDateStr}T00:00:00.000Z`);

  try {
    const createdArrival = await prisma.$transaction(async (tx) => {
      const seqResult = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('zmcc_token_seq') as nextval`;
      if (!seqResult || seqResult.length === 0 || seqResult[0].nextval === undefined || seqResult[0].nextval === null) {
        throw new Error('FAILED_TO_ALLOCATE_ZMCC_TOKEN_SEQUENCE');
      }
      const seqNum = Number(seqResult[0].nextval);
      const zmccToken = `ZT-CON-${dateCode}-${String(seqNum).padStart(4, '0')}`;

      const arrival = await tx.zmccContractorArrival.create({
        data: {
          zmcc_id: targetZmccId!,
          contractor_source_id: contractorSourceId,
          vehicle_number: vehicleNumber,
          arrival_timestamp: arrivalDate,
          arrival_date: arrivalDatePkt,
          zmcc_token: zmccToken,
          phe_latitude: gpsValidation.lat != null ? new Prisma.Decimal(gpsValidation.lat.toFixed(7)) : null,
          phe_longitude: gpsValidation.lng != null ? new Prisma.Decimal(gpsValidation.lng.toFixed(7)) : null,
          phe_gps_accuracy: gpsValidation.acc != null ? new Prisma.Decimal(gpsValidation.acc.toFixed(2)) : null,
          client_event_id: clientEventId,
          recorded_by_user_id: auth.actorUserId,
          submitted_at: now,
          correction_count: 0,
        },
        include: {
          contractor_source: true,
          zmcc: true,
          recorded_by: true,
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'zmcc_contractor_arrival',
          record_id: arrival.id,
          action: 'ZMCC_CONTRACTOR_ARRIVAL_SUBMITTED',
          old_values: Prisma.DbNull,
          new_values: {
            contractor_source_id: contractorSourceId.toString(),
            contractor_code: contractorSource.code,
            vehicle_number: vehicleNumber,
            zmcc_token: zmccToken,
            arrival_timestamp: arrivalDate.toISOString(),
            arrival_date: pktDateStr,
            client_event_id: clientEventId,
          },
          user_id: auth.actorUserId,
        },
      });

      return arrival;
    });

    return {
      status: 201,
      data: serializeContractorArrival(createdArrival),
    };
  } catch (err: any) {
    if (err.code === 'P2002') {
      const existingAfterCollision = await prisma.zmccContractorArrival.findUnique({
        where: { client_event_id: clientEventId },
        include: {
          contractor_source: true,
          zmcc: true,
          recorded_by: true,
        },
      });
      if (existingAfterCollision) {
        if (isExactContractorArrivalReplay(existingAfterCollision, expectedContractorPayload)) {
          return {
            status: 200,
            data: {
              ...serializeContractorArrival(existingAfterCollision),
              is_replay: true,
            },
          };
        } else {
          return {
            status: 409,
            error: 'Conflict: Reused client_event_id with differing contractor arrival payload.',
          };
        }
      }
      return {
        status: 409,
        error: 'Conflict: Duplicate client_event_id collision on contractor arrival.',
      };
    }
    console.error('submitContractorArrival error:', err);
    return { status: 500, error: 'Internal server error while recording contractor arrival.' };
  }
}

export async function correctContractorArrival(
  reqOrUser: Request | User,
  arrivalIdParam: string | number | bigint,
  payload: CorrectContractorArrivalPayload
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'CORRECT_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let arrivalId: bigint;
  try {
    arrivalId = BigInt(String(arrivalIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid arrival ID format.' };
  }

  if (!payload || typeof payload !== 'object') {
    return { status: 400, error: 'Missing correction payload.' };
  }

  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (!reason) {
    return { status: 400, error: 'reason is mandatory for arrival corrections.' };
  }

  const arrival = await prisma.zmccContractorArrival.findUnique({
    where: { id: arrivalId },
    include: {
      contractor_source: true,
      zmcc: true,
      recorded_by: true,
    },
  });

  if (!arrival) {
    return { status: 404, error: 'Contractor Arrival record not found.' };
  }

  if (!auth.isSuperAdmin && arrival.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Arrival record belongs to another ZMCC.' };
  }

  if (arrival.correction_count >= 2) {
    return {
      status: 400,
      error: 'Maximum number of corrections (2) has been reached for this arrival record.',
    };
  }

  const updateData: Prisma.ZmccContractorArrivalUpdateInput = {};

  const oldValues: Record<string, any> = {};
  const newValues: Record<string, any> = {};

  if (payload.vehicle_number !== undefined) {
    const trimmedVeh = String(payload.vehicle_number).trim().toUpperCase();
    if (!trimmedVeh) {
      return { status: 400, error: 'vehicle_number cannot be blank.' };
    }
    if (trimmedVeh !== arrival.vehicle_number) {
      oldValues.vehicle_number = arrival.vehicle_number;
      newValues.vehicle_number = trimmedVeh;
      updateData.vehicle_number = trimmedVeh;
    }
  }

  if (payload.arrival_timestamp !== undefined) {
    const parsedTime = new Date(payload.arrival_timestamp);
    if (isNaN(parsedTime.getTime())) {
      return { status: 400, error: 'Invalid arrival_timestamp format.' };
    }
    const now = new Date();
    if (parsedTime.getTime() > now.getTime() + 5 * 60 * 1000) {
      return { status: 400, error: 'arrival_timestamp cannot be in the future.' };
    }
    if (parsedTime.getTime() !== arrival.arrival_timestamp.getTime()) {
      oldValues.arrival_timestamp = arrival.arrival_timestamp.toISOString();
      newValues.arrival_timestamp = parsedTime.toISOString();
      updateData.arrival_timestamp = parsedTime;

      const pktDateStr = getPakistanCalendarDate(parsedTime);
      updateData.arrival_date = new Date(`${pktDateStr}T00:00:00.000Z`);
    }
  }

  if (payload.phe_latitude !== undefined || payload.phe_longitude !== undefined) {
    const gpsValidation = validateGpsCoords(payload.phe_latitude, payload.phe_longitude, payload.phe_gps_accuracy);
    if (gpsValidation.error) {
      return { status: 400, error: gpsValidation.error };
    }
    oldValues.phe_latitude = arrival.phe_latitude != null ? Number(arrival.phe_latitude) : null;
    oldValues.phe_longitude = arrival.phe_longitude != null ? Number(arrival.phe_longitude) : null;
    oldValues.phe_gps_accuracy = arrival.phe_gps_accuracy != null ? Number(arrival.phe_gps_accuracy) : null;

    newValues.phe_latitude = gpsValidation.lat;
    newValues.phe_longitude = gpsValidation.lng;
    newValues.phe_gps_accuracy = gpsValidation.acc;

    updateData.phe_latitude = gpsValidation.lat != null ? new Prisma.Decimal(gpsValidation.lat.toFixed(7)) : null;
    updateData.phe_longitude = gpsValidation.lng != null ? new Prisma.Decimal(gpsValidation.lng.toFixed(7)) : null;
    updateData.phe_gps_accuracy = gpsValidation.acc != null ? new Prisma.Decimal(gpsValidation.acc.toFixed(2)) : null;
  }

  if (Object.keys(newValues).length === 0) {
    return { status: 400, error: 'No values were modified in this correction request.' };
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Concurrency safety: acquire row-level lock on the arrival record
      const lockedRows = await tx.$queryRaw<{ id: bigint; correction_count: number }[]>`
        SELECT id, correction_count FROM zmcc_contractor_arrival WHERE id = ${arrivalId} FOR UPDATE
      `;
      if (!lockedRows || lockedRows.length === 0) {
        throw new Error('ARRIVAL_NOT_FOUND');
      }
      const currentCount = lockedRows[0].correction_count;
      if (currentCount >= 2) {
        throw new Error('MAX_CORRECTIONS_REACHED');
      }

      const nextCorrectionCount = currentCount + 1;
      const updatedRecord = await tx.zmccContractorArrival.update({
        where: { id: arrivalId },
        data: {
          ...updateData,
          correction_count: nextCorrectionCount,
        },
        include: {
          contractor_source: true,
          zmcc: true,
          recorded_by: true,
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'zmcc_contractor_arrival',
          record_id: arrivalId,
          action: 'ZMCC_CONTRACTOR_ARRIVAL_CORRECTED',
          old_values: oldValues,
          new_values: {
            ...newValues,
            correction_reason: reason,
            correction_count: nextCorrectionCount,
          },
          user_id: auth.actorUserId,
        },
      });

      return updatedRecord;
    });

    return {
      status: 200,
      data: serializeContractorArrival(updated),
    };
  } catch (err: any) {
    if (err.message === 'MAX_CORRECTIONS_REACHED') {
      return {
        status: 409,
        error: 'Conflict: Maximum number of corrections (2) has been reached or another correction was committed concurrently.',
      };
    }
    if (err.message === 'ARRIVAL_NOT_FOUND') {
      return { status: 404, error: 'Contractor Arrival record not found.' };
    }
    console.error('correctContractorArrival error:', err);
    return { status: 500, error: 'Internal server error while correcting contractor arrival.' };
  }
}

export async function listMotArrivals(
  reqOrUser: Request | User,
  filters: {
    date?: string;
    journey_id?: string | number | bigint;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'READ_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const where: Prisma.ZmccMotArrivalWhereInput = {};

  if (!auth.isSuperAdmin) {
    where.zmcc_id = auth.effectiveZmccId!;
  }

  if (filters.journey_id) {
    try {
      where.journey_id = BigInt(String(filters.journey_id).trim());
    } catch {
      return { status: 400, error: 'Invalid journey_id filter format.' };
    }
  }

  if (filters.date) {
    const dateStr = filters.date.trim();
    where.arrival_date = new Date(`${dateStr}T00:00:00.000Z`);
  }

  if (filters.search && filters.search.trim()) {
    const term = filters.search.trim();
    where.OR = [
      { route_milk_token: { contains: term, mode: 'insensitive' } },
      { zmcc_token: { contains: term, mode: 'insensitive' } },
      { journey: { journey_number: { contains: term, mode: 'insensitive' } } },
      { journey: { mot_vehicle: { vehicle_number: { contains: term, mode: 'insensitive' } } } },
      { journey: { mot_profile: { name: { contains: term, mode: 'insensitive' } } } },
    ];
  }

  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 50));
  const skip = (page - 1) * pageSize;

  const [total, items] = await Promise.all([
    prisma.zmccMotArrival.count({ where }),
    prisma.zmccMotArrival.findMany({
      where,
      include: {
        journey: {
          include: {
            route: true,
            mot_vehicle: true,
            mot_profile: true,
          },
        },
        zmcc: true,
        recorded_by: true,
      },
      orderBy: { arrival_timestamp: 'desc' },
      skip,
      take: pageSize,
    }),
  ]);

  return {
    status: 200,
    data: {
      items: items.map(serializeMotArrival),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getMotArrivalById(
  reqOrUser: Request | User,
  arrivalIdParam: string | number | bigint
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'READ_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let arrivalId: bigint;
  try {
    arrivalId = BigInt(String(arrivalIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid arrival ID format.' };
  }

  const arrival = await prisma.zmccMotArrival.findUnique({
    where: { id: arrivalId },
    include: {
      journey: {
        include: {
          route: true,
          mot_vehicle: true,
          mot_profile: true,
        },
      },
      zmcc: true,
      recorded_by: true,
    },
  });

  if (!arrival) {
    return { status: 404, error: 'MOT Arrival not found.' };
  }

  if (!auth.isSuperAdmin && arrival.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Arrival record belongs to another ZMCC.' };
  }

  return {
    status: 200,
    data: serializeMotArrival(arrival),
  };
}

export async function listContractorArrivals(
  reqOrUser: Request | User,
  filters: {
    date?: string;
    contractor_source_id?: string | number | bigint;
    vehicle_number?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'READ_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const where: Prisma.ZmccContractorArrivalWhereInput = {};

  if (!auth.isSuperAdmin) {
    where.zmcc_id = auth.effectiveZmccId!;
  }

  if (filters.contractor_source_id) {
    try {
      where.contractor_source_id = BigInt(String(filters.contractor_source_id).trim());
    } catch {
      return { status: 400, error: 'Invalid contractor_source_id format.' };
    }
  }

  if (filters.vehicle_number && filters.vehicle_number.trim()) {
    where.vehicle_number = { contains: filters.vehicle_number.trim(), mode: 'insensitive' };
  }

  if (filters.date) {
    const dateStr = filters.date.trim();
    where.arrival_date = new Date(`${dateStr}T00:00:00.000Z`);
  }

  if (filters.search && filters.search.trim()) {
    const term = filters.search.trim();
    where.OR = [
      { zmcc_token: { contains: term, mode: 'insensitive' } },
      { vehicle_number: { contains: term, mode: 'insensitive' } },
      { contractor_source: { name: { contains: term, mode: 'insensitive' } } },
      { contractor_source: { code: { contains: term, mode: 'insensitive' } } },
    ];
  }

  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 50));
  const skip = (page - 1) * pageSize;

  const [total, items] = await Promise.all([
    prisma.zmccContractorArrival.count({ where }),
    prisma.zmccContractorArrival.findMany({
      where,
      include: {
        contractor_source: true,
        zmcc: true,
        recorded_by: true,
      },
      orderBy: { arrival_timestamp: 'desc' },
      skip,
      take: pageSize,
    }),
  ]);

  return {
    status: 200,
    data: {
      items: items.map(serializeContractorArrival),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getContractorArrivalById(
  reqOrUser: Request | User,
  arrivalIdParam: string | number | bigint
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'READ_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let arrivalId: bigint;
  try {
    arrivalId = BigInt(String(arrivalIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid arrival ID format.' };
  }

  const arrival = await prisma.zmccContractorArrival.findUnique({
    where: { id: arrivalId },
    include: {
      contractor_source: true,
      zmcc: true,
      recorded_by: true,
    },
  });

  if (!arrival) {
    return { status: 404, error: 'Contractor Arrival not found.' };
  }

  if (!auth.isSuperAdmin && arrival.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Arrival record belongs to another ZMCC.' };
  }

  return {
    status: 200,
    data: serializeContractorArrival(arrival),
  };
}

export async function getActiveContractors(
  reqOrUser: Request | User
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'READ_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const contractors = await prisma.procurementSource.findMany({
    where: {
      source_type: 'CONTRACTOR',
      is_active: true,
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      source_type: true,
      is_active: true,
    },
  });

  return {
    status: 200,
    data: contractors.map((c) => ({
      id: c.id.toString(),
      code: c.code,
      name: c.name,
      source_type: c.source_type,
      is_active: c.is_active,
    })),
  };
}

export async function getArrivingMotJourneys(
  reqOrUser: Request | User
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccArrivalAuth(reqOrUser, 'READ_ARRIVAL');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const where: Prisma.MotJourneyWhereInput = {
    status: 'COLLECTING',
    mot_arrival: null,
  };

  if (!auth.isSuperAdmin) {
    where.zmcc_id = auth.effectiveZmccId!;
  }

  const journeys = await prisma.motJourney.findMany({
    where,
    include: {
      route: { select: { id: true, route_code: true, name: true } },
      mot_vehicle: { select: { id: true, vehicle_number: true } },
      mot_profile: { select: { id: true, mot_code: true, name: true, phone_number: true } },
      zmcc: { select: { id: true, code: true, name: true } },
      stops: {
        select: {
          id: true,
          status: true,
          collection: {
            select: {
              gross_liters: true,
              at_13ts_liters: true,
            },
          },
        },
      },
    },
    orderBy: { started_at: 'desc' },
  });

  const serialized = journeys.map((j) => {
    let visitedCount = 0;
    let totalGrossLiters = 0;
    let totalAt13TsLiters = 0;

    for (const s of j.stops) {
      if (s.status === 'VISITED') visitedCount++;
      if (s.collection) {
        totalGrossLiters += Number(s.collection.gross_liters);
        totalAt13TsLiters += Number(s.collection.at_13ts_liters);
      }
    }

    return {
      id: j.id.toString(),
      journey_number: j.journey_number,
      operational_date: j.operational_date.toISOString().split('T')[0],
      started_at: j.started_at.toISOString(),
      route: j.route ? { id: j.route.id.toString(), route_code: j.route.route_code, name: j.route.name } : null,
      mot_vehicle: j.mot_vehicle ? { id: j.mot_vehicle.id.toString(), vehicle_number: j.mot_vehicle.vehicle_number } : null,
      mot_profile: j.mot_profile ? { id: j.mot_profile.id.toString(), mot_code: j.mot_profile.mot_code, name: j.mot_profile.name, phone_number: j.mot_profile.phone_number } : null,
      zmcc: j.zmcc ? { id: j.zmcc.id.toString(), code: j.zmcc.code, name: j.zmcc.name } : null,
      total_stops: j.stops.length,
      visited_stops: visitedCount,
      total_gross_liters: Number(totalGrossLiters.toFixed(2)),
      total_at_13ts_liters: Number(totalAt13TsLiters.toFixed(2)),
    };
  });

  return {
    status: 200,
    data: serialized,
  };
}
