import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { getCurrentUser } from '@core/auth';
import { User, Role } from '@core/types';
import { evaluateLabResult, validateCategoricalOption } from '@/lib/lab-rules';
import { isValidDateOnly } from '@/lib/datetime-utils';

export interface ZmccLabAuthContext {
  user: User;
  actorUserId: bigint;
  role: Role;
  isSuperAdmin: boolean;
  isZmccManager: boolean;
  isZmccLabAttendant: boolean;
  effectiveZmccId: bigint | null;
}

export type ZmccLabAction =
  | 'READ_LAB'
  | 'START_OR_RESUME_SESSION'
  | 'UPDATE_DRAFT'
  | 'COMPLETE_SESSION'
  | 'CORRECT_SESSION';

export interface ServiceResult<T> {
  status: number;
  data?: T;
  error?: string;
}

export async function resolveZmccLabAuth(
  reqOrUser?: Request | User | any,
  action: ZmccLabAction = 'READ_LAB'
): Promise<{ auth?: ZmccLabAuthContext; errorResponse?: { error: string; status: number } }> {
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
  const isZmccLabAttendant = role === 'ZMCC_LAB_ATTENDANT';

  // Permission checks by action
  if (action === 'START_OR_RESUME_SESSION' || action === 'UPDATE_DRAFT' || action === 'COMPLETE_SESSION') {
    if (!isZmccLabAttendant && !isSuperAdmin) {
      return {
        errorResponse: {
          error: 'Forbidden. Only ZMCC Lab Attendants or Super Admins may perform testing sessions.',
          status: 403,
        },
      };
    }
  } else if (action === 'CORRECT_SESSION') {
    if (!isZmccManager && !isSuperAdmin) {
      return {
        errorResponse: {
          error: 'Forbidden. Only ZMCC Managers or Super Admins may correct finalized lab records.',
          status: 403,
        },
      };
    }
  } else if (action === 'READ_LAB') {
    if (!isSuperAdmin && !isZmccManager && !isZmccLabAttendant) {
      return {
        errorResponse: {
          error: 'Forbidden. You do not have permission to access ZMCC laboratory data.',
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
          error: 'Forbidden. User must be assigned to an active ZMCC procurement source.',
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
      isZmccLabAttendant,
      effectiveZmccId,
    },
  };
}

export function serializeLabResult(res: any) {
  return {
    id: res.id.toString(),
    session_id: res.session_id.toString(),
    test_id: res.test_id.toString(),
    test_code_snapshot: res.test_code_snapshot,
    test_name_snapshot: res.test_name_snapshot,
    result_type_snapshot: res.result_type_snapshot,
    unit_snapshot: res.unit_snapshot,
    is_required_snapshot: res.is_required_snapshot,
    display_order_snapshot: res.display_order_snapshot,
    result_options_snapshot: res.result_options_snapshot,
    numeric_value: res.numeric_value !== null && res.numeric_value !== undefined ? Number(res.numeric_value) : null,
    text_value: res.text_value,
    evaluation_status: res.evaluation_status,
    is_passed: res.is_passed,
    recorded_at: res.recorded_at instanceof Date ? res.recorded_at.toISOString() : res.recorded_at,
    created_at: res.created_at instanceof Date ? res.created_at.toISOString() : res.created_at,
    updated_at: res.updated_at instanceof Date ? res.updated_at.toISOString() : res.updated_at,
  };
}

export function serializeLabSession(session: any) {
  return {
    id: session.id.toString(),
    zmcc_id: session.zmcc_id.toString(),
    arrival_type: session.arrival_type,
    mot_arrival_id: session.mot_arrival_id ? session.mot_arrival_id.toString() : null,
    contractor_arrival_id: session.contractor_arrival_id ? session.contractor_arrival_id.toString() : null,
    status: session.status,
    started_by_user_id: session.started_by_user_id.toString(),
    started_at: session.started_at instanceof Date ? session.started_at.toISOString() : session.started_at,
    completed_by_user_id: session.completed_by_user_id ? session.completed_by_user_id.toString() : null,
    completed_at: session.completed_at instanceof Date ? session.completed_at.toISOString() : session.completed_at,
    decision: session.decision,
    rejection_reason: session.rejection_reason,
    remarks: session.remarks,
    completion_client_event_id: session.completion_client_event_id,
    correction_count: session.correction_count,
    restricted_correction_count: session.restricted_correction_count ?? 0,
    last_corrected_by_user_id: session.last_corrected_by_user_id ? session.last_corrected_by_user_id.toString() : null,
    last_corrected_at: session.last_corrected_at instanceof Date ? session.last_corrected_at.toISOString() : session.last_corrected_at,
    created_at: session.created_at instanceof Date ? session.created_at.toISOString() : session.created_at,
    updated_at: session.updated_at instanceof Date ? session.updated_at.toISOString() : session.updated_at,
    zmcc: session.zmcc
      ? {
          id: session.zmcc.id.toString(),
          code: session.zmcc.code,
          name: session.zmcc.name,
          source_type: session.zmcc.source_type,
        }
      : undefined,
    starter: session.starter
      ? {
          id: session.starter.id.toString(),
          username: session.starter.username,
          full_name: session.starter.full_name,
        }
      : undefined,
    completer: session.completer
      ? {
          id: session.completer.id.toString(),
          username: session.completer.username,
          full_name: session.completer.full_name,
        }
      : undefined,
    last_corrector: session.last_corrector
      ? {
          id: session.last_corrector.id.toString(),
          username: session.last_corrector.username,
          full_name: session.last_corrector.full_name,
        }
      : undefined,
    mot_arrival: session.mot_arrival
      ? {
          id: session.mot_arrival.id.toString(),
          journey_id: session.mot_arrival.journey_id.toString(),
          route_milk_token: session.mot_arrival.route_milk_token,
          zmcc_token: session.mot_arrival.zmcc_token,
          arrival_timestamp: session.mot_arrival.arrival_timestamp instanceof Date ? session.mot_arrival.arrival_timestamp.toISOString() : session.mot_arrival.arrival_timestamp,
          arrival_date: session.mot_arrival.arrival_date instanceof Date ? session.mot_arrival.arrival_date.toISOString().split('T')[0] : session.mot_arrival.arrival_date,
          journey: session.mot_arrival.journey
            ? {
                id: session.mot_arrival.journey.id.toString(),
                journey_number: session.mot_arrival.journey.journey_number,
                route: session.mot_arrival.journey.route
                  ? {
                      id: session.mot_arrival.journey.route.id.toString(),
                      route_code: session.mot_arrival.journey.route.route_code,
                      name: session.mot_arrival.journey.route.name,
                    }
                  : null,
                mot_vehicle: session.mot_arrival.journey.mot_vehicle
                  ? {
                      id: session.mot_arrival.journey.mot_vehicle.id.toString(),
                      vehicle_number: session.mot_arrival.journey.mot_vehicle.vehicle_number,
                    }
                  : null,
                mot_profile: session.mot_arrival.journey.mot_profile
                  ? {
                      id: session.mot_arrival.journey.mot_profile.id.toString(),
                      mot_code: session.mot_arrival.journey.mot_profile.mot_code,
                      name: session.mot_arrival.journey.mot_profile.name,
                    }
                  : null,
              }
            : undefined,
        }
      : undefined,
    contractor_arrival: session.contractor_arrival
      ? {
          id: session.contractor_arrival.id.toString(),
          contractor_source_id: session.contractor_arrival.contractor_source_id.toString(),
          vehicle_number: session.contractor_arrival.vehicle_number,
          zmcc_token: session.contractor_arrival.zmcc_token,
          arrival_timestamp: session.contractor_arrival.arrival_timestamp instanceof Date ? session.contractor_arrival.arrival_timestamp.toISOString() : session.contractor_arrival.arrival_timestamp,
          arrival_date: session.contractor_arrival.arrival_date instanceof Date ? session.contractor_arrival.arrival_date.toISOString().split('T')[0] : session.contractor_arrival.arrival_date,
          contractor_source: session.contractor_arrival.contractor_source
            ? {
                id: session.contractor_arrival.contractor_source.id.toString(),
                code: session.contractor_arrival.contractor_source.code,
                name: session.contractor_arrival.contractor_source.name,
              }
            : undefined,
        }
      : undefined,
    results: session.results ? session.results.map(serializeLabResult) : [],
  };
}

export async function getArrivalsQueue(
  reqOrUser: Request | User
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccLabAuth(reqOrUser, 'READ_LAB');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const effectiveZmccId = auth.effectiveZmccId;

  // MOT arrivals condition:
  // 1. zmcc_id matches (if scoped)
  // 2. lab_session is null OR lab_session.status = 'IN_PROGRESS'
  // 3. journey.status = 'COMPLETED'
  const motWhere: Prisma.ZmccMotArrivalWhereInput = {
    ...(effectiveZmccId ? { zmcc_id: effectiveZmccId } : {}),
    journey: { status: 'COMPLETED' },
    OR: [
      { lab_session: null },
      { lab_session: { status: 'IN_PROGRESS' } },
    ],
  };

  // Contractor arrivals condition:
  // 1. zmcc_id matches (if scoped)
  // 2. lab_session is null OR lab_session.status = 'IN_PROGRESS'
  // 3. contractor_source.is_active = true
  const contractorWhere: Prisma.ZmccContractorArrivalWhereInput = {
    ...(effectiveZmccId ? { zmcc_id: effectiveZmccId } : {}),
    contractor_source: { is_active: true },
    OR: [
      { lab_session: null },
      { lab_session: { status: 'IN_PROGRESS' } },
    ],
  };

  const [motArrivals, contractorArrivals] = await Promise.all([
    prisma.zmccMotArrival.findMany({
      where: motWhere,
      include: {
        zmcc: true,
        recorded_by: true,
        journey: {
          include: {
            route: true,
            mot_vehicle: true,
            mot_profile: true,
          },
        },
        lab_session: true,
      },
      orderBy: { arrival_timestamp: 'asc' },
    }),
    prisma.zmccContractorArrival.findMany({
      where: contractorWhere,
      include: {
        zmcc: true,
        contractor_source: true,
        recorded_by: true,
        lab_session: true,
      },
      orderBy: { arrival_timestamp: 'asc' },
    }),
  ]);

  const queueItems: any[] = [];

  for (const m of motArrivals) {
    queueItems.push({
      queue_type: 'MOT',
      arrival_id: m.id.toString(),
      zmcc_id: m.zmcc_id.toString(),
      zmcc_code: m.zmcc.code,
      zmcc_name: m.zmcc.name,
      zmcc_token: m.zmcc_token,
      route_milk_token: m.route_milk_token,
      arrival_timestamp: m.arrival_timestamp.toISOString(),
      arrival_date: m.arrival_date.toISOString().split('T')[0],
      journey_id: m.journey_id.toString(),
      journey_number: m.journey.journey_number,
      vehicle_number: m.journey.mot_vehicle ? m.journey.mot_vehicle.vehicle_number : null,
      route_code: m.journey.route ? m.journey.route.route_code : null,
      route_name: m.journey.route ? m.journey.route.name : null,
      mot_code: m.journey.mot_profile ? m.journey.mot_profile.mot_code : null,
      mot_name: m.journey.mot_profile ? m.journey.mot_profile.name : null,
      lab_session_id: m.lab_session ? m.lab_session.id.toString() : null,
      lab_session_status: m.lab_session ? m.lab_session.status : null,
    });
  }

  for (const c of contractorArrivals) {
    queueItems.push({
      queue_type: 'CONTRACTOR',
      arrival_id: c.id.toString(),
      zmcc_id: c.zmcc_id.toString(),
      zmcc_code: c.zmcc.code,
      zmcc_name: c.zmcc.name,
      zmcc_token: c.zmcc_token,
      contractor_source_id: c.contractor_source_id.toString(),
      contractor_code: c.contractor_source.code,
      contractor_name: c.contractor_source.name,
      vehicle_number: c.vehicle_number,
      arrival_timestamp: c.arrival_timestamp.toISOString(),
      arrival_date: c.arrival_date.toISOString().split('T')[0],
      lab_session_id: c.lab_session ? c.lab_session.id.toString() : null,
      lab_session_status: c.lab_session ? c.lab_session.status : null,
    });
  }

  // Sort queue strictly by arrival_timestamp ascending (oldest arrival first)
  queueItems.sort((a, b) => new Date(a.arrival_timestamp).getTime() - new Date(b.arrival_timestamp).getTime());

  return {
    status: 200,
    data: queueItems,
  };
}

export interface StartOrResumePayload {
  arrival_type: 'MOT' | 'CONTRACTOR';
  arrival_id: string | number | bigint;
}

export async function startOrResumeSession(
  reqOrUser: Request | User,
  payload: StartOrResumePayload
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccLabAuth(reqOrUser, 'START_OR_RESUME_SESSION');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const { arrival_type, arrival_id } = payload;
  if (!arrival_type || !['MOT', 'CONTRACTOR'].includes(arrival_type)) {
    return { status: 400, error: 'arrival_type must be either MOT or CONTRACTOR.' };
  }

  if (!arrival_id) {
    return { status: 400, error: 'arrival_id is required.' };
  }

  let arrivalIdBigInt: bigint;
  try {
    arrivalIdBigInt = BigInt(String(arrival_id).trim());
  } catch {
    return { status: 400, error: 'Invalid arrival_id format.' };
  }

  // Fetch arrival and verify existence & ZMCC scoping
  let arrivalZmccId: bigint;
  if (arrival_type === 'MOT') {
    const arrival = await prisma.zmccMotArrival.findUnique({
      where: { id: arrivalIdBigInt },
      include: {
        journey: true,
        lab_session: {
          include: {
            zmcc: true,
            starter: true,
            completer: true,
            results: {
              orderBy: { display_order_snapshot: 'asc' },
            },
          },
        },
      },
    });

    if (!arrival) {
      return { status: 404, error: 'MOT Arrival not found.' };
    }

    if (!auth.isSuperAdmin && arrival.zmcc_id !== auth.effectiveZmccId!) {
      return { status: 403, error: 'Forbidden. Arrival record belongs to another ZMCC.' };
    }

    if (arrival.journey.status !== 'COMPLETED') {
      return { status: 400, error: 'Cannot start lab session for MOT journey that is not COMPLETED.' };
    }

    arrivalZmccId = arrival.zmcc_id;

    // If session already exists
    if (arrival.lab_session) {
      return {
        status: 200,
        data: serializeLabSession(arrival.lab_session),
      };
    }
  } else {
    const arrival = await prisma.zmccContractorArrival.findUnique({
      where: { id: arrivalIdBigInt },
      include: {
        contractor_source: true,
        lab_session: {
          include: {
            zmcc: true,
            starter: true,
            completer: true,
            results: {
              orderBy: { display_order_snapshot: 'asc' },
            },
          },
        },
      },
    });

    if (!arrival) {
      return { status: 404, error: 'Contractor Arrival not found.' };
    }

    if (!auth.isSuperAdmin && arrival.zmcc_id !== auth.effectiveZmccId!) {
      return { status: 403, error: 'Forbidden. Arrival record belongs to another ZMCC.' };
    }

    if (!arrival.contractor_source.is_active) {
      return { status: 400, error: 'Cannot start lab session for an inactive contractor.' };
    }

    arrivalZmccId = arrival.zmcc_id;

    // If session already exists
    if (arrival.lab_session) {
      return {
        status: 200,
        data: serializeLabSession(arrival.lab_session),
      };
    }
  }

  // Active lab tests for ZMCC
  const activeTests = await prisma.labTest.findMany({
    where: {
      isActive: true,
      testScope: { in: ['ZMCC', 'ALL'] },
    },
    orderBy: [
      { displayOrder: 'asc' },
      { testName: 'asc' },
    ],
  });

  if (activeTests.length === 0) {
    return { status: 400, error: 'No active ZMCC lab tests configured.' };
  }

  // Calculated test safety: Fail closed if unsupported required CALCULATED tests exist
  const unsupportedCalculated = activeTests.find(
    (t) => t.resultType === 'CALCULATED' && t.isRequired
  );
  if (unsupportedCalculated) {
    return {
      status: 400,
      error: `Calculated ZMCC lab test ${unsupportedCalculated.testCode} has no canonical calculation owner.`,
    };
  }

  // Start new session transactionally with snapshot creation
  try {
    const session = await prisma.$transaction(async (tx) => {
      // Re-verify existing session inside transaction
      const existing = await tx.zmccLabSession.findFirst({
        where: arrival_type === 'MOT' ? { mot_arrival_id: arrivalIdBigInt } : { contractor_arrival_id: arrivalIdBigInt },
        include: {
          zmcc: true,
          starter: true,
          completer: true,
          results: {
            orderBy: { display_order_snapshot: 'asc' },
          },
        },
      });

      if (existing) {
        return existing;
      }

      const newSession = await tx.zmccLabSession.create({
        data: {
          zmcc_id: arrivalZmccId,
          arrival_type,
          mot_arrival_id: arrival_type === 'MOT' ? arrivalIdBigInt : null,
          contractor_arrival_id: arrival_type === 'CONTRACTOR' ? arrivalIdBigInt : null,
          status: 'IN_PROGRESS',
          started_by_user_id: auth.actorUserId,
          results: {
            create: activeTests.map((t) => ({
              test_id: t.id,
              test_code_snapshot: t.testCode,
              test_name_snapshot: t.testName,
              result_type_snapshot: t.resultType,
              unit_snapshot: t.unit,
              is_required_snapshot: t.isRequired,
              display_order_snapshot: t.displayOrder,
              result_options_snapshot: t.resultOptions ? JSON.parse(JSON.stringify(t.resultOptions)) : Prisma.DbNull,
              numeric_value: null,
              text_value: null,
              evaluation_status: 'PENDING',
              is_passed: null,
            })),
          },
        },
        include: {
          zmcc: true,
          starter: true,
          completer: true,
          last_corrector: true,
          results: {
            orderBy: { display_order_snapshot: 'asc' },
          },
        },
      });

      return newSession;
    });

    return {
      status: 201,
      data: serializeLabSession(session),
    };
  } catch (err: any) {
    // Check if unique constraint violated (concurrent start)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.zmccLabSession.findFirst({
        where: arrival_type === 'MOT' ? { mot_arrival_id: arrivalIdBigInt } : { contractor_arrival_id: arrivalIdBigInt },
        include: {
          zmcc: true,
          starter: true,
          completer: true,
          last_corrector: true,
          results: {
            orderBy: { display_order_snapshot: 'asc' },
          },
        },
      });
      if (existing) {
        return {
          status: 200,
          data: serializeLabSession(existing),
        };
      }
    }
    console.error('startOrResumeSession error:', err);
    return { status: 500, error: 'Failed to start lab session.' };
  }
}

export async function getSessionById(
  reqOrUser: Request | User,
  sessionIdParam: string | number | bigint
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccLabAuth(reqOrUser, 'READ_LAB');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let sessionId: bigint;
  try {
    sessionId = BigInt(String(sessionIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid session ID format.' };
  }

  const session = await prisma.zmccLabSession.findUnique({
    where: { id: sessionId },
    include: {
      zmcc: true,
      starter: true,
      completer: true,
      last_corrector: true,
      mot_arrival: {
        include: {
          journey: {
            include: {
              route: true,
              mot_vehicle: true,
              mot_profile: true,
            },
          },
        },
      },
      contractor_arrival: {
        include: {
          contractor_source: true,
        },
      },
      results: {
        orderBy: { display_order_snapshot: 'asc' },
      },
    },
  });

  if (!session) {
    return { status: 404, error: 'ZMCC Lab session not found.' };
  }

  if (!auth.isSuperAdmin && session.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Lab session belongs to another ZMCC.' };
  }

  return {
    status: 200,
    data: serializeLabSession(session),
  };
}

export interface UpdateDraftPayload {
  results: Array<{
    test_id: string | number | bigint;
    numeric_value?: number | null;
    text_value?: string | null;
  }>;
  remarks?: string | null;
}

export async function updateDraftResults(
  reqOrUser: Request | User,
  sessionIdParam: string | number | bigint,
  payload: UpdateDraftPayload
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccLabAuth(reqOrUser, 'UPDATE_DRAFT');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let sessionId: bigint;
  try {
    sessionId = BigInt(String(sessionIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid session ID format.' };
  }

  const session = await prisma.zmccLabSession.findUnique({
    where: { id: sessionId },
    include: {
      results: true,
    },
  });

  if (!session) {
    return { status: 404, error: 'ZMCC Lab session not found.' };
  }

  if (!auth.isSuperAdmin && session.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Lab session belongs to another ZMCC.' };
  }

  if (session.status !== 'IN_PROGRESS') {
    return { status: 400, error: 'Cannot update draft results on a finalized lab session.' };
  }

  if (!payload || !Array.isArray(payload.results)) {
    return { status: 400, error: 'payload.results must be an array.' };
  }

  const sessionResultsMap = new Map(session.results.map((r) => [r.test_id.toString(), r]));

  // Validate values against types
  for (const item of payload.results) {
    const testIdStr = String(item.test_id).trim();
    const existing = sessionResultsMap.get(testIdStr);
    if (!existing) {
      return { status: 400, error: `Test ID ${testIdStr} does not belong to this lab session.` };
    }

    const resType = existing.result_type_snapshot;
    if (resType === 'CALCULATED') {
      if (item.numeric_value != null || (item.text_value != null && item.text_value.trim() !== '')) {
        return {
          status: 400,
          error: `Calculated ZMCC lab test ${existing.test_code_snapshot} has no canonical calculation owner and cannot be manually modified.`,
        };
      }
    } else if (resType === 'NUMERIC') {
      if (item.numeric_value !== undefined && item.numeric_value !== null) {
        const num = Number(item.numeric_value);
        if (isNaN(num) || num < 0) {
          return { status: 400, error: `Numeric value for test ${existing.test_code_snapshot} must be non-negative.` };
        }
      }
    } else if (resType === 'TEXT') {
      // Free text: any string allowed
    } else if (['QUALITATIVE', 'BOOLEAN', 'OK_NOT_OK', 'POSITIVE_NEGATIVE'].includes(resType)) {
      if (item.text_value !== undefined && item.text_value !== null && item.text_value.trim()) {
        const rawText = item.text_value.trim().toUpperCase();
        const options = existing.result_options_snapshot as any[];
        const isValid = validateCategoricalOption(existing.result_type_snapshot, rawText, options);
        if (!isValid) {
          return {
            status: 400,
            error: `Invalid value "${item.text_value}" for test ${existing.test_code_snapshot}.`,
          };
        }
      }
    }
  }

  // Update records
  await prisma.$transaction(async (tx) => {
    for (const item of payload.results) {
      const testIdStr = String(item.test_id).trim();
      const existing = sessionResultsMap.get(testIdStr)!;
      const resType = existing.result_type_snapshot;

      let numVal: Prisma.Decimal | null = null;
      let txtVal: string | null = null;
      let evalStatus = 'PENDING';
      let isPassed: boolean | null = null;

      if (resType === 'CALCULATED') {
        // Attendants cannot manually modify CALCULATED tests
        continue;
      } else if (resType === 'NUMERIC') {
        if (item.numeric_value !== undefined && item.numeric_value !== null) {
          const num = Number(item.numeric_value);
          numVal = new Prisma.Decimal(num.toFixed(4));
          const evaluation = evaluateLabResult(
            existing.test_code_snapshot,
            num,
            null,
            existing.result_type_snapshot,
            existing.result_options_snapshot as any
          );
          isPassed = evaluation.isPassed;
          evalStatus = evaluation.status;
        }
      } else if (resType === 'TEXT') {
        if (item.text_value !== undefined && item.text_value !== null && item.text_value.trim()) {
          txtVal = item.text_value.trim();
          evalStatus = 'NEUTRAL';
          isPassed = null;
        }
      } else {
        if (item.text_value !== undefined && item.text_value !== null && item.text_value.trim()) {
          txtVal = item.text_value.trim();
          const evaluation = evaluateLabResult(
            existing.test_code_snapshot,
            null,
            txtVal,
            existing.result_type_snapshot,
            existing.result_options_snapshot as any
          );
          isPassed = evaluation.isPassed;
          evalStatus = evaluation.status;
        }
      }

      await tx.zmccLabResult.update({
        where: {
          session_id_test_id: {
            session_id: sessionId,
            test_id: existing.test_id,
          },
        },
        data: {
          numeric_value: numVal,
          text_value: txtVal,
          is_passed: isPassed,
          evaluation_status: evalStatus,
          recorded_at: numVal !== null || txtVal !== null ? new Date() : null,
        },
      });
    }

    if (payload.remarks !== undefined) {
      await tx.zmccLabSession.update({
        where: { id: sessionId },
        data: {
          remarks: payload.remarks ? payload.remarks.trim() : null,
        },
      });
    }
  });

  return getSessionById(reqOrUser, sessionId);
}

export interface CompleteSessionPayload {
  completion_client_event_id: string;
  decision: 'ACCEPTED' | 'REJECTED';
  rejection_reason?: string | null;
  remarks?: string | null;
  results: Array<{
    test_id: string | number | bigint;
    numeric_value?: number | null;
    text_value?: string | null;
  }>;
}

function matchesPersistedSessionCompletion(
  persistedSession: any,
  targetSessionId: bigint,
  payload: CompleteSessionPayload
): boolean {
  // 1. Session identity
  if (persistedSession.id.toString() !== targetSessionId.toString()) {
    return false;
  }

  // 2. Decision
  if (persistedSession.decision !== payload.decision) {
    return false;
  }

  // 3. Normalized rejection reason
  const persistedRejection = persistedSession.rejection_reason ? persistedSession.rejection_reason.trim() : null;
  const payloadRejection = payload.rejection_reason ? payload.rejection_reason.trim() : null;
  if (persistedRejection !== payloadRejection) {
    return false;
  }

  // 4. Normalized remarks
  const persistedRemarks = persistedSession.remarks ? persistedSession.remarks.trim() : null;
  const payloadRemarks = payload.remarks ? payload.remarks.trim() : null;
  if (persistedRemarks !== payloadRemarks) {
    return false;
  }

  // 5. Complete submitted test-result set
  if (!Array.isArray(payload.results) || !Array.isArray(persistedSession.results)) {
    return false;
  }

  const persistedResults = [...persistedSession.results].sort((a, b) =>
    a.test_id.toString().localeCompare(b.test_id.toString())
  );

  const submittedMap = new Map<string, { numeric_value?: number | null; text_value?: string | null }>();
  for (const item of payload.results) {
    const tid = String(item.test_id).trim();
    if (submittedMap.has(tid)) {
      return false; // Duplicate test_id in payload
    }
    submittedMap.set(tid, item);
  }

  if (submittedMap.size !== persistedResults.length) {
    return false;
  }

  for (const pRes of persistedResults) {
    const tid = pRes.test_id.toString();
    const sub = submittedMap.get(tid);
    if (!sub) {
      return false;
    }

    const resType = pRes.result_type_snapshot;

    if (resType === 'NUMERIC') {
      const persistedNum = pRes.numeric_value != null ? Number(pRes.numeric_value.toString()).toFixed(4) : null;
      const subNum = sub.numeric_value != null && !isNaN(Number(sub.numeric_value)) ? Number(sub.numeric_value).toFixed(4) : null;
      if (persistedNum !== subNum) {
        return false;
      }
    } else if (resType === 'CALCULATED') {
      if (sub.numeric_value != null || (sub.text_value != null && sub.text_value.trim() !== '')) {
        return false;
      }
      if (pRes.numeric_value != null || (pRes.text_value != null && pRes.text_value.trim() !== '')) {
        return false;
      }
    } else {
      // TEXT, QUALITATIVE, BOOLEAN, OK_NOT_OK, POSITIVE_NEGATIVE
      const persistedText = pRes.text_value ? pRes.text_value.trim() : null;
      const subText = sub.text_value ? sub.text_value.trim() : null;
      if (persistedText !== subText) {
        return false;
      }
    }
  }

  return true;
}

export async function completeSession(
  reqOrUser: Request | User,
  sessionIdParam: string | number | bigint,
  payload: CompleteSessionPayload
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccLabAuth(reqOrUser, 'COMPLETE_SESSION');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let sessionId: bigint;
  try {
    sessionId = BigInt(String(sessionIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid session ID format.' };
  }

  const { completion_client_event_id, decision, rejection_reason, remarks, results } = payload || {};

  if (!completion_client_event_id || typeof completion_client_event_id !== 'string' || !completion_client_event_id.trim()) {
    return { status: 400, error: 'completion_client_event_id is required for idempotency.' };
  }

  const clientEventId = completion_client_event_id.trim();

  // Check idempotency by completion_client_event_id
  const existingByEvent = await prisma.zmccLabSession.findUnique({
    where: { completion_client_event_id: clientEventId },
    include: {
      zmcc: true,
      starter: true,
      completer: true,
      last_corrector: true,
      mot_arrival: {
        include: {
          journey: {
            include: {
              route: true,
              mot_vehicle: true,
              mot_profile: true,
            },
          },
        },
      },
      contractor_arrival: {
        include: {
          contractor_source: true,
        },
      },
      results: {
        orderBy: { display_order_snapshot: 'asc' },
      },
    },
  });

  if (existingByEvent) {
    if (matchesPersistedSessionCompletion(existingByEvent, sessionId, payload)) {
      return {
        status: 200,
        data: serializeLabSession(existingByEvent),
      };
    }
    return {
      status: 409,
      error: 'Conflict. completion_client_event_id was already used for a different completion payload.',
    };
  }

  // Fetch target session
  const session = await prisma.zmccLabSession.findUnique({
    where: { id: sessionId },
    include: {
      results: true,
      mot_arrival: true,
      contractor_arrival: true,
    },
  });

  if (!session) {
    return { status: 404, error: 'ZMCC Lab session not found.' };
  }

  if (!auth.isSuperAdmin && session.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Lab session belongs to another ZMCC.' };
  }

  if (session.status === 'COMPLETED') {
    return { status: 409, error: 'ZMCC Lab session is already completed.' };
  }

  if (!decision || !['ACCEPTED', 'REJECTED'].includes(decision)) {
    return { status: 400, error: 'decision must be either ACCEPTED or REJECTED.' };
  }

  const rejectionReasonTrimmed = rejection_reason ? rejection_reason.trim() : '';
  if (decision === 'REJECTED' && !rejectionReasonTrimmed) {
    return { status: 400, error: 'rejection_reason is required when decision is REJECTED.' };
  }

  if (!Array.isArray(results) || results.length === 0) {
    return { status: 400, error: 'results array is required to complete testing.' };
  }

  const sessionResultsMap = new Map(session.results.map((r) => [r.test_id.toString(), r]));
  const submittedMap = new Map(results.map((r) => [String(r.test_id).trim(), r]));

  // Reject duplicate test_id entries and unknown test IDs in payload
  const submittedTidSet = new Set<string>();
  for (const item of results) {
    if (!item || item.test_id === undefined || item.test_id === null) {
      return { status: 400, error: 'Every result entry must specify test_id.' };
    }
    const tidStr = String(item.test_id).trim();
    if (submittedTidSet.has(tidStr)) {
      return { status: 400, error: `Duplicate test_id "${tidStr}" in completion payload.` };
    }
    if (!sessionResultsMap.has(tidStr)) {
      return { status: 400, error: `Test ID "${tidStr}" does not belong to this testing session.` };
    }
    submittedTidSet.add(tidStr);
  }

  // Verify all frozen non-CALCULATED tests are present in submitted payload
  for (const snap of session.results) {
    const tid = snap.test_id.toString();
    const resType = snap.result_type_snapshot;
    const submitted = submittedMap.get(tid);

    if (resType === 'CALCULATED') {
      if (submitted && (submitted.numeric_value != null || (submitted.text_value != null && submitted.text_value.trim() !== ''))) {
        return {
          status: 400,
          error: `Calculated ZMCC lab test ${snap.test_code_snapshot} has no canonical calculation owner and cannot be manually modified.`,
        };
      }
      if (snap.is_required_snapshot) {
        return {
          status: 400,
          error: `Calculated ZMCC lab test ${snap.test_code_snapshot} has no canonical calculation owner.`,
        };
      }
      continue;
    }

    if (!submitted) {
      return {
        status: 400,
        error: `Missing result entry for test "${snap.test_name_snapshot}" (${snap.test_code_snapshot}). Completion payload must contain every frozen test.`,
      };
    }

    if (snap.is_required_snapshot) {
      if (resType === 'NUMERIC') {
        if (submitted.numeric_value === undefined || submitted.numeric_value === null || isNaN(Number(submitted.numeric_value))) {
          return { status: 400, error: `Required numeric test "${snap.test_name_snapshot}" must have a valid numeric value.` };
        }
      } else if (resType === 'TEXT') {
        if (!submitted.text_value || !submitted.text_value.trim()) {
          return { status: 400, error: `Required text test "${snap.test_name_snapshot}" must have a valid text value.` };
        }
      } else if (['QUALITATIVE', 'BOOLEAN', 'OK_NOT_OK', 'POSITIVE_NEGATIVE'].includes(resType)) {
        if (!submitted.text_value || !submitted.text_value.trim()) {
          return { status: 400, error: `Required categorical test "${snap.test_name_snapshot}" must have a selected value.` };
        }
      }
    }

    if (resType === 'NUMERIC') {
      if (submitted.numeric_value !== undefined && submitted.numeric_value !== null) {
        const n = Number(submitted.numeric_value);
        if (isNaN(n) || n < 0) {
          return { status: 400, error: `Numeric value for test ${snap.test_code_snapshot} must be non-negative.` };
        }
      }
    } else if (resType === 'TEXT') {
      // Free text allowed
    } else if (['QUALITATIVE', 'BOOLEAN', 'OK_NOT_OK', 'POSITIVE_NEGATIVE'].includes(resType)) {
      if (submitted.text_value && submitted.text_value.trim()) {
        const rawText = submitted.text_value.trim().toUpperCase();
        const options = snap.result_options_snapshot as any[];
        const isValid = validateCategoricalOption(snap.result_type_snapshot, rawText, options);
        if (!isValid) {
          return { status: 400, error: `Invalid option "${submitted.text_value}" for test ${snap.test_code_snapshot}.` };
        }
      }
    }
  }

  // Execute completion transaction
  try {
    const completedSession = await prisma.$transaction(async (tx) => {
      // Row-level lock
      const lockedSessionRows: Array<{ id: bigint; status: string; completion_client_event_id: string | null }> = await tx.$queryRaw`
        SELECT id, status, completion_client_event_id FROM zmcc_lab_session WHERE id = ${sessionId} FOR UPDATE
      `;
      if (!lockedSessionRows || lockedSessionRows.length === 0) {
        throw new Error('SESSION_NOT_FOUND');
      }
      if (lockedSessionRows[0].status === 'COMPLETED') {
        if (lockedSessionRows[0].completion_client_event_id === clientEventId) {
          throw new Error('REPLAY_MATCH_CHECK');
        }
        throw new Error('SESSION_ALREADY_COMPLETED');
      }

      // Update all submitted test results
      for (const item of results) {
        const testIdStr = String(item.test_id).trim();
        const existing = sessionResultsMap.get(testIdStr);
        if (!existing) continue;
        const resType = existing.result_type_snapshot;

        let numVal: Prisma.Decimal | null = null;
        let txtVal: string | null = null;
        let isPassed: boolean | null = null;
        let evalStatus = 'PENDING';

        if (resType === 'CALCULATED') {
          continue;
        } else if (resType === 'NUMERIC') {
          if (item.numeric_value !== undefined && item.numeric_value !== null) {
            const n = Number(item.numeric_value);
            numVal = new Prisma.Decimal(n.toFixed(4));
            const evaluation = evaluateLabResult(
              existing.test_code_snapshot,
              n,
              null,
              existing.result_type_snapshot,
              existing.result_options_snapshot as any
            );
            isPassed = evaluation.isPassed;
            evalStatus = evaluation.status;
          }
        } else if (resType === 'TEXT') {
          if (item.text_value && item.text_value.trim()) {
            txtVal = item.text_value.trim();
            evalStatus = 'NEUTRAL';
            isPassed = null;
          }
        } else {
          if (item.text_value && item.text_value.trim()) {
            txtVal = item.text_value.trim();
            const evaluation = evaluateLabResult(
              existing.test_code_snapshot,
              null,
              txtVal,
              existing.result_type_snapshot,
              existing.result_options_snapshot as any
            );
            isPassed = evaluation.isPassed;
            evalStatus = evaluation.status;
          }
        }

        await tx.zmccLabResult.update({
          where: {
            session_id_test_id: {
              session_id: sessionId,
              test_id: existing.test_id,
            },
          },
          data: {
            numeric_value: numVal,
            text_value: txtVal,
            is_passed: isPassed,
            evaluation_status: evalStatus,
            recorded_at: new Date(),
          },
        });
      }

      const updated = await tx.zmccLabSession.update({
        where: { id: sessionId },
        data: {
          status: 'COMPLETED',
          completed_by_user_id: auth.actorUserId,
          completed_at: new Date(),
          decision,
          rejection_reason: decision === 'REJECTED' ? rejectionReasonTrimmed : null,
          remarks: remarks ? remarks.trim() : null,
          completion_client_event_id: clientEventId,
        },
        include: {
          zmcc: true,
          starter: true,
          completer: true,
          last_corrector: true,
          mot_arrival: {
            include: {
              journey: {
                include: {
                  route: true,
                  mot_vehicle: true,
                  mot_profile: true,
                },
              },
            },
          },
          contractor_arrival: {
            include: {
              contractor_source: true,
            },
          },
          results: {
            orderBy: { display_order_snapshot: 'asc' },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'zmcc_lab_session',
          record_id: sessionId,
          action: 'ZMCC_LAB_SESSION_COMPLETED',
          old_values: { status: 'IN_PROGRESS' },
          new_values: {
            status: 'COMPLETED',
            decision,
            rejection_reason: decision === 'REJECTED' ? rejectionReasonTrimmed : null,
            completion_client_event_id: clientEventId,
            completed_by_user_id: auth.actorUserId.toString(),
            completed_at: updated.completed_at?.toISOString(),
          },
          user_id: auth.actorUserId,
        },
      });

      return updated;
    });

    return {
      status: 200,
      data: serializeLabSession(completedSession),
    };
  } catch (err: any) {
    if (err.message === 'REPLAY_MATCH_CHECK' || err.message === 'SESSION_ALREADY_COMPLETED') {
      const completedExisting = await prisma.zmccLabSession.findUnique({
        where: { id: sessionId },
        include: {
          zmcc: true,
          starter: true,
          completer: true,
          last_corrector: true,
          mot_arrival: {
            include: {
              journey: {
                include: {
                  route: true,
                  mot_vehicle: true,
                  mot_profile: true,
                },
              },
            },
          },
          contractor_arrival: {
            include: {
              contractor_source: true,
            },
          },
          results: {
            orderBy: { display_order_snapshot: 'asc' },
          },
        },
      });

      if (completedExisting && completedExisting.completion_client_event_id === clientEventId) {
        if (matchesPersistedSessionCompletion(completedExisting, sessionId, payload)) {
          return {
            status: 200,
            data: serializeLabSession(completedExisting),
          };
        } else {
          return {
            status: 409,
            error: 'Conflict. completion_client_event_id was already used for a different completion payload.',
          };
        }
      }
      return { status: 409, error: 'ZMCC Lab session is already completed.' };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const owningSession = await prisma.zmccLabSession.findUnique({
        where: { completion_client_event_id: clientEventId },
        include: {
          zmcc: true,
          starter: true,
          completer: true,
          last_corrector: true,
          mot_arrival: {
            include: {
              journey: {
                include: {
                  route: true,
                  mot_vehicle: true,
                  mot_profile: true,
                },
              },
            },
          },
          contractor_arrival: {
            include: {
              contractor_source: true,
            },
          },
          results: {
            orderBy: { display_order_snapshot: 'asc' },
          },
        },
      });

      if (owningSession) {
        if (matchesPersistedSessionCompletion(owningSession, sessionId, payload)) {
          return {
            status: 200,
            data: serializeLabSession(owningSession),
          };
        }
        return {
          status: 409,
          error: 'Conflict. completion_client_event_id was already used for a different completion payload.',
        };
      }
      return { status: 409, error: 'Conflict. completion_client_event_id collision detected.' };
    }
    console.error('completeSession error:', err);
    return { status: 500, error: 'Failed to complete lab session.' };
  }
}

export interface CorrectSessionPayload {
  reason: string;
  decision?: 'ACCEPTED' | 'REJECTED';
  rejection_reason?: string | null;
  remarks?: string | null;
  results?: Array<{
    test_id: string | number | bigint;
    numeric_value?: number | null;
    text_value?: string | null;
  }>;
}

export async function correctCompletedSession(
  reqOrUser: Request | User,
  sessionIdParam: string | number | bigint,
  payload: CorrectSessionPayload
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccLabAuth(reqOrUser, 'CORRECT_SESSION');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let sessionId: bigint;
  try {
    sessionId = BigInt(String(sessionIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid session ID format.' };
  }

  const { reason, decision, rejection_reason, remarks, results } = payload || {};

  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return { status: 400, error: 'Audit correction reason is required.' };
  }
  const reasonTrimmed = reason.trim();

  // Load session
  const session = await prisma.zmccLabSession.findUnique({
    where: { id: sessionId },
    include: {
      results: true,
    },
  });

  if (!session) {
    return { status: 404, error: 'ZMCC Lab session not found.' };
  }

  if (!auth.isSuperAdmin && session.zmcc_id !== auth.effectiveZmccId!) {
    return { status: 403, error: 'Forbidden. Lab session belongs to another ZMCC.' };
  }

  if (session.status !== 'COMPLETED') {
    return { status: 400, error: 'Only COMPLETED lab sessions can be corrected.' };
  }

  if (!auth.isSuperAdmin && (session.restricted_correction_count ?? 0) >= 2) {
    return { status: 400, error: 'Maximum correction limit (2) reached for this lab session.' };
  }

  const effectiveDecision = decision || session.decision;
  if (effectiveDecision && !['ACCEPTED', 'REJECTED'].includes(effectiveDecision)) {
    return { status: 400, error: 'decision must be either ACCEPTED or REJECTED.' };
  }

  let effectiveRejectionReason: string | null = session.rejection_reason;
  if (decision === 'REJECTED') {
    if (rejection_reason !== undefined) {
      effectiveRejectionReason = rejection_reason ? rejection_reason.trim() : null;
    }
    if (!effectiveRejectionReason) {
      return { status: 400, error: 'rejection_reason is required when decision is REJECTED.' };
    }
  } else if (decision === 'ACCEPTED') {
    effectiveRejectionReason = null;
  }

  // Validate results if provided
  const sessionResultsMap = new Map(session.results.map((r) => [r.test_id.toString(), r]));
  if (Array.isArray(results)) {
    for (const item of results) {
      const testIdStr = String(item.test_id).trim();
      const snap = sessionResultsMap.get(testIdStr);
      if (!snap) {
        return { status: 400, error: `Test ID ${testIdStr} does not belong to this session.` };
      }
      const resType = snap.result_type_snapshot;
      if (resType === 'CALCULATED') {
        if (item.numeric_value != null || (item.text_value != null && item.text_value.trim() !== '')) {
          return {
            status: 400,
            error: `Calculated ZMCC lab test ${snap.test_code_snapshot} has no canonical calculation owner and cannot be manually modified.`,
          };
        }
      } else if (resType === 'NUMERIC') {
        if (item.numeric_value !== undefined && item.numeric_value !== null) {
          const n = Number(item.numeric_value);
          if (isNaN(n) || n < 0) {
            return { status: 400, error: `Numeric value for test ${snap.test_code_snapshot} must be non-negative.` };
          }
        }
      } else if (resType === 'TEXT') {
        // Free text allowed
      } else if (['QUALITATIVE', 'BOOLEAN', 'OK_NOT_OK', 'POSITIVE_NEGATIVE'].includes(resType)) {
        if (item.text_value && item.text_value.trim()) {
          const rawText = item.text_value.trim().toUpperCase();
          const options = snap.result_options_snapshot as any[];
          const isValid = validateCategoricalOption(snap.result_type_snapshot, rawText, options);
          if (!isValid) {
            return { status: 400, error: `Invalid option "${item.text_value}" for test ${snap.test_code_snapshot}.` };
          }
        }
      }
    }
  }

  // Row-lock correction transaction
  try {
    const correctedSession = await prisma.$transaction(async (tx) => {
      const lockedRows: Array<{ id: bigint; correction_count: number; restricted_correction_count: number }> = await tx.$queryRaw`
        SELECT id, correction_count, restricted_correction_count FROM zmcc_lab_session WHERE id = ${sessionId} FOR UPDATE
      `;

      if (!lockedRows || lockedRows.length === 0) {
        throw new Error('SESSION_NOT_FOUND');
      }

      const currentTotalCount = lockedRows[0].correction_count;
      const currentRestrictedCount = lockedRows[0].restricted_correction_count ?? 0;

      if (!auth.isSuperAdmin && currentRestrictedCount >= 2) {
        throw new Error('MAX_CORRECTIONS_REACHED');
      }

      const oldValues: any = {
        decision: session.decision,
        rejection_reason: session.rejection_reason,
        remarks: session.remarks,
        correction_count: currentTotalCount,
        restricted_correction_count: currentRestrictedCount,
      };

      const newTotalCount = currentTotalCount + 1;
      const newRestrictedCount = auth.isSuperAdmin ? currentRestrictedCount : currentRestrictedCount + 1;
      const correctionTimestamp = new Date();

      const newValues: any = {
        decision: effectiveDecision,
        rejection_reason: effectiveRejectionReason,
        remarks: remarks !== undefined ? (remarks ? remarks.trim() : null) : session.remarks,
        correction_count: newTotalCount,
        restricted_correction_count: newRestrictedCount,
        correction_reason: reasonTrimmed,
        actor_user_id: auth.actorUserId.toString(),
        is_super_admin: auth.isSuperAdmin,
      };

      if (Array.isArray(results)) {
        for (const item of results) {
          const testIdStr = String(item.test_id).trim();
          const snap = sessionResultsMap.get(testIdStr);
          if (!snap) continue;

          let numVal: Prisma.Decimal | null = snap.numeric_value;
          let txtVal: string | null = snap.text_value;
          let isPassed: boolean | null = snap.is_passed;
          let evalStatus = snap.evaluation_status || 'PENDING';
          const resType = snap.result_type_snapshot;

          if (resType === 'CALCULATED') {
            continue;
          } else if (resType === 'NUMERIC') {
            if (item.numeric_value !== undefined) {
              if (item.numeric_value === null) {
                numVal = null;
                isPassed = null;
                evalStatus = 'PENDING';
              } else {
                const n = Number(item.numeric_value);
                numVal = new Prisma.Decimal(n.toFixed(4));
                const evalRes = evaluateLabResult(
                  snap.test_code_snapshot,
                  n,
                  null,
                  snap.result_type_snapshot,
                  snap.result_options_snapshot as any
                );
                isPassed = evalRes.isPassed;
                evalStatus = evalRes.status;
              }
            }
          } else if (resType === 'TEXT') {
            if (item.text_value !== undefined) {
              if (item.text_value === null || !item.text_value.trim()) {
                txtVal = null;
                isPassed = null;
                evalStatus = 'PENDING';
              } else {
                txtVal = item.text_value.trim();
                evalStatus = 'NEUTRAL';
                isPassed = null;
              }
            }
          } else {
            if (item.text_value !== undefined) {
              if (item.text_value === null || !item.text_value.trim()) {
                txtVal = null;
                isPassed = null;
                evalStatus = 'PENDING';
              } else {
                txtVal = item.text_value.trim();
                const evalRes = evaluateLabResult(
                  snap.test_code_snapshot,
                  null,
                  txtVal,
                  snap.result_type_snapshot,
                  snap.result_options_snapshot as any
                );
                isPassed = evalRes.isPassed;
                evalStatus = evalRes.status;
              }
            }
          }

          await tx.zmccLabResult.update({
            where: {
              session_id_test_id: {
                session_id: sessionId,
                test_id: snap.test_id,
              },
            },
            data: {
              numeric_value: numVal,
              text_value: txtVal,
              is_passed: isPassed,
              evaluation_status: evalStatus,
              recorded_at: correctionTimestamp,
            },
          });
        }
      }

      const updated = await tx.zmccLabSession.update({
        where: { id: sessionId },
        data: {
          decision: effectiveDecision,
          rejection_reason: effectiveRejectionReason,
          remarks: remarks !== undefined ? (remarks ? remarks.trim() : null) : session.remarks,
          correction_count: newTotalCount,
          restricted_correction_count: newRestrictedCount,
          last_corrected_by_user_id: auth.actorUserId,
          last_corrected_at: correctionTimestamp,
        },
        include: {
          zmcc: true,
          starter: true,
          completer: true,
          last_corrector: true,
          mot_arrival: {
            include: {
              journey: {
                include: {
                  route: true,
                  mot_vehicle: true,
                  mot_profile: true,
                },
              },
            },
          },
          contractor_arrival: {
            include: {
              contractor_source: true,
            },
          },
          results: {
            orderBy: { display_order_snapshot: 'asc' },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          table_name: 'zmcc_lab_session',
          record_id: sessionId,
          action: 'ZMCC_LAB_SESSION_CORRECTED',
          old_values: oldValues,
          new_values: newValues,
          user_id: auth.actorUserId,
        },
      });

      return updated;
    });

    return {
      status: 200,
      data: serializeLabSession(correctedSession),
    };
  } catch (err: any) {
    if (err.message === 'MAX_CORRECTIONS_REACHED') {
      return { status: 400, error: 'Maximum correction limit (2) reached for this lab session.' };
    }
    console.error('correctCompletedSession error:', err);
    return { status: 500, error: 'Failed to correct lab session.' };
  }
}

export interface LabHistoryQuery {
  page?: number;
  pageSize?: number;
  date?: string;
  decision?: string;
  search?: string;
}

export async function getLabHistory(
  reqOrUser: Request | User,
  query: LabHistoryQuery = {}
): Promise<ServiceResult<any>> {
  const { auth, errorResponse } = await resolveZmccLabAuth(reqOrUser, 'READ_LAB');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const effectiveZmccId = auth.effectiveZmccId;

  const where: Prisma.ZmccLabSessionWhereInput = {
    status: 'COMPLETED',
    ...(effectiveZmccId ? { zmcc_id: effectiveZmccId } : {}),
  };

  if (query.decision && ['ACCEPTED', 'REJECTED'].includes(query.decision.toUpperCase())) {
    where.decision = query.decision.toUpperCase();
  }

  if (query.date !== undefined && query.date !== null && query.date !== '') {
    if (!isValidDateOnly(query.date)) {
      return {
        status: 400,
        error: 'Invalid date parameter. Expected valid calendar date in YYYY-MM-DD format.',
      };
    }
    const start = new Date(`${query.date}T00:00:00.000+05:00`);
    const end = new Date(`${query.date}T23:59:59.999+05:00`);
    where.completed_at = {
      gte: start,
      lte: end,
    };
  }

  if (query.search && query.search.trim()) {
    const s = query.search.trim();
    where.OR = [
      { mot_arrival: { zmcc_token: { contains: s, mode: 'insensitive' } } },
      { mot_arrival: { route_milk_token: { contains: s, mode: 'insensitive' } } },
      { contractor_arrival: { zmcc_token: { contains: s, mode: 'insensitive' } } },
      { contractor_arrival: { vehicle_number: { contains: s, mode: 'insensitive' } } },
      { contractor_arrival: { contractor_source: { name: { contains: s, mode: 'insensitive' } } } },
    ];
  }

  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 50));
  const skip = (page - 1) * pageSize;

  const [total, items] = await Promise.all([
    prisma.zmccLabSession.count({ where }),
    prisma.zmccLabSession.findMany({
      where,
      include: {
        zmcc: true,
        starter: true,
        completer: true,
        last_corrector: true,
        mot_arrival: {
          include: {
            journey: {
              include: {
                route: true,
                mot_vehicle: true,
                mot_profile: true,
              },
            },
          },
        },
        contractor_arrival: {
          include: {
            contractor_source: true,
          },
        },
        results: {
          orderBy: { display_order_snapshot: 'asc' },
        },
      },
      orderBy: { completed_at: 'desc' },
      skip,
      take: pageSize,
    }),
  ]);

  return {
    status: 200,
    data: {
      items: items.map(serializeLabSession),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}
