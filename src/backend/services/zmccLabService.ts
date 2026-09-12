import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { getCurrentUser } from '@core/auth';
import { User, Role } from '@core/types';
import { evaluateLabResult, validateCategoricalOption } from '@/lib/lab-rules';
import { isValidDateOnly } from '@/lib/datetime-utils';
import { computeCanonicalMilkMetrics } from '@/backend/utils/milkFormulas';
import { resolveCoreMilkTestResults, validateCoreMilkTestCandidates } from '@/backend/utils/milkTestResolvers';
import { MilkTestPolicyService } from '@/backend/services/milkTestPolicyService';

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
    quantity_value: session.quantity_value !== null && session.quantity_value !== undefined ? Number(session.quantity_value) : null,
    quantity_unit: session.quantity_unit ?? null,
    density: session.density !== null && session.density !== undefined ? Number(session.density) : null,
    gross_liters: session.gross_liters !== null && session.gross_liters !== undefined ? Number(session.gross_liters) : null,
    snf: session.snf !== null && session.snf !== undefined ? Number(session.snf) : null,
    ts: session.ts !== null && session.ts !== undefined ? Number(session.ts) : null,
    at_13ts_liters: session.at_13ts_liters !== null && session.at_13ts_liters !== undefined ? Number(session.at_13ts_liters) : null,
    calculation_version: session.calculation_version ?? null,
    correction_count: session.correction_count,
    manager_correction_count: session.manager_correction_count ?? 0,
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
                summary: session.mot_arrival.journey.summary
                  ? {
                      id: session.mot_arrival.journey.summary.id.toString(),
                      journey_id: session.mot_arrival.journey.summary.journey_id.toString(),
                      total_gross_liters: Number(session.mot_arrival.journey.summary.total_gross_liters),
                      total_at_13ts_liters: Number(session.mot_arrival.journey.summary.total_at_13ts_liters),
                      weighted_avg_lr: session.mot_arrival.journey.summary.weighted_avg_lr !== null && session.mot_arrival.journey.summary.weighted_avg_lr !== undefined ? Number(session.mot_arrival.journey.summary.weighted_avg_lr) : null,
                      weighted_avg_fat: session.mot_arrival.journey.summary.weighted_avg_fat !== null && session.mot_arrival.journey.summary.weighted_avg_fat !== undefined ? Number(session.mot_arrival.journey.summary.weighted_avg_fat) : null,
                      weighted_avg_snf: session.mot_arrival.journey.summary.weighted_avg_snf !== null && session.mot_arrival.journey.summary.weighted_avg_snf !== undefined ? Number(session.mot_arrival.journey.summary.weighted_avg_snf) : null,
                      weighted_avg_ts: session.mot_arrival.journey.summary.weighted_avg_ts !== null && session.mot_arrival.journey.summary.weighted_avg_ts !== undefined ? Number(session.mot_arrival.journey.summary.weighted_avg_ts) : null,
                      summary_version: session.mot_arrival.journey.summary.summary_version,
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

  // Canonical milk test policy by arrival type
  const testingPoint = arrival_type === 'MOT' ? 'ZMCC_LAB_MOT' : 'ZMCC_LAB_CONTRACTOR';
  const effectiveTests = await MilkTestPolicyService.getEffectivePolicy(testingPoint);

  if (!effectiveTests || effectiveTests.length === 0) {
    return { status: 400, error: `No active milk test policy is configured for ${testingPoint}.` };
  }

  // Pre-flight validate that policy contains exactly one LR and one Fat candidate
  const candidateValidation = validateCoreMilkTestCandidates(effectiveTests);
  if (!candidateValidation.valid) {
    return {
      status: 400,
      error: candidateValidation.error,
    };
  }

  // Calculated test safety: Fail closed if unsupported required CALCULATED tests exist
  const unsupportedCalculated = effectiveTests.find(
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
            create: effectiveTests.map((t) => ({
              test_id: BigInt(t.id),
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
              summary: true,
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
  quantity_value?: number | null;
  quantity_unit?: 'KG' | 'LITER' | string | null;
  results?: Array<{
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

  if (!payload || typeof payload !== 'object') {
    return { status: 400, error: 'Payload must be an object.' };
  }

  if (payload.quantity_value !== undefined && payload.quantity_value !== null) {
    const qVal = Number(payload.quantity_value);
    if (isNaN(qVal) || qVal <= 0) {
      return { status: 400, error: 'Actual quantity must be greater than 0.' };
    }
  }

  let normalizedDraftUnit: 'KG' | 'LITER' | null | undefined;
  if (payload.quantity_unit !== undefined && payload.quantity_unit !== null) {
    const u = payload.quantity_unit.toString().trim().toUpperCase();
    if (u !== 'KG' && u !== 'LITER') {
      return { status: 400, error: 'Quantity unit must be either KG or LITER.' };
    }
    normalizedDraftUnit = u as 'KG' | 'LITER';
  } else if (payload.quantity_unit === null) {
    normalizedDraftUnit = null;
  }

  const resultsToProcess = Array.isArray(payload.results) ? payload.results : [];

  const sessionResultsMap = new Map(session.results.map((r) => [r.test_id.toString(), r]));

  // Validate values against types
  for (const item of resultsToProcess) {
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
    const updatedDraftResultsMap = new Map(session.results.map((r) => [r.test_id.toString(), { ...r }]));

    for (const item of resultsToProcess) {
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

      updatedDraftResultsMap.set(testIdStr, {
        ...existing,
        numeric_value: numVal,
        text_value: txtVal,
      });
    }

    const effectiveQty = payload.quantity_value !== undefined
      ? (payload.quantity_value !== null ? Number(Number(payload.quantity_value).toFixed(2)) : null)
      : (session.quantity_value !== null ? Number(session.quantity_value) : null);
    const effectiveUnit = normalizedDraftUnit !== undefined
      ? normalizedDraftUnit
      : (session.quantity_unit as 'KG' | 'LITER' | null);

    // Compute preview metrics if draft inputs are complete
    let previewDensity: Prisma.Decimal | null = null;
    let previewGrossLiters: Prisma.Decimal | null = null;
    let previewSnf: Prisma.Decimal | null = null;
    let previewTs: Prisma.Decimal | null = null;
    let previewAt13ts: Prisma.Decimal | null = null;
    let previewVersion: string | null = null;

    if (effectiveQty && effectiveQty > 0 && effectiveUnit && ['KG', 'LITER'].includes(effectiveUnit)) {
      const resolved = resolveCoreMilkTestResults(Array.from(updatedDraftResultsMap.values()));
      if (resolved.success) {
        try {
          const m = computeCanonicalMilkMetrics(effectiveQty, effectiveUnit, resolved.lr, resolved.fat);
          previewDensity = new Prisma.Decimal(m.density.toFixed(4));
          previewGrossLiters = new Prisma.Decimal(m.grossLiters.toFixed(2));
          previewSnf = new Prisma.Decimal(m.snf.toFixed(2));
          previewTs = new Prisma.Decimal(m.ts.toFixed(2));
          previewAt13ts = new Prisma.Decimal(m.at13tsLiters.toFixed(2));
          previewVersion = m.calculationVersion;
        } catch {
          // If preview fails, keep derived values null (never fabricate defaults)
        }
      }
    }

    const sessionUpdateData: any = {};
    if (payload.quantity_value !== undefined) {
      sessionUpdateData.quantity_value = payload.quantity_value !== null ? new Prisma.Decimal(effectiveQty!.toFixed(2)) : null;
    }
    if (normalizedDraftUnit !== undefined) {
      sessionUpdateData.quantity_unit = normalizedDraftUnit as any;
    }
    if (payload.remarks !== undefined) {
      sessionUpdateData.remarks = payload.remarks ? payload.remarks.trim() : null;
    }
    sessionUpdateData.density = previewDensity;
    sessionUpdateData.gross_liters = previewGrossLiters;
    sessionUpdateData.snf = previewSnf;
    sessionUpdateData.ts = previewTs;
    sessionUpdateData.at_13ts_liters = previewAt13ts;
    sessionUpdateData.calculation_version = previewVersion;

    await tx.zmccLabSession.update({
      where: { id: sessionId },
      data: sessionUpdateData,
    });
  });

  return getSessionById(reqOrUser, sessionId);
}

export interface CompleteSessionPayload {
  completion_client_event_id: string;
  quantity_value: number;
  quantity_unit: 'KG' | 'LITER' | string;
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

  // 5. Quantity value
  const persistedQty = persistedSession.quantity_value != null ? Number(Number(persistedSession.quantity_value).toFixed(2)) : null;
  const submittedQty = payload.quantity_value != null && !isNaN(Number(payload.quantity_value)) ? Number(Number(payload.quantity_value).toFixed(2)) : null;
  if (persistedQty !== submittedQty) {
    return false;
  }

  // 6. Quantity unit
  const persistedUnit = persistedSession.quantity_unit ? persistedSession.quantity_unit.toString().trim().toUpperCase() : null;
  const submittedUnit = payload.quantity_unit ? payload.quantity_unit.toString().trim().toUpperCase() : null;
  if (persistedUnit !== submittedUnit) {
    return false;
  }

  // 7. Complete submitted test-result set
  if (!Array.isArray(payload.results) || !Array.isArray(persistedSession.results)) {
    return false;
  }

  const persistedMap = new Map<string, any>(persistedSession.results.map((r: any) => [r.test_id.toString(), r]));

  const submittedMap = new Map<string, { numeric_value?: number | null; text_value?: string | null }>();
  for (const item of payload.results) {
    const tid = String(item.test_id).trim();
    if (submittedMap.has(tid)) {
      return false; // Duplicate test_id in payload
    }
    if (!persistedMap.has(tid)) {
      return false; // Test does not belong to session
    }
    submittedMap.set(tid, item);
  }

  for (const pRes of persistedSession.results) {
    const tid = pRes.test_id.toString();
    const sub = submittedMap.get(tid);
    const resType = pRes.result_type_snapshot;

    if (resType === 'CALCULATED') {
      // Optional un-submittable calculated snapshot results may be omitted from submittedMap
      if (sub) {
        if (sub.numeric_value != null || (sub.text_value != null && sub.text_value.trim() !== '')) {
          return false;
        }
      }
      if (pRes.numeric_value != null || (pRes.text_value != null && pRes.text_value.trim() !== '')) {
        return false;
      }
    } else {
      if (!sub) {
        return false;
      }

      if (resType === 'NUMERIC') {
        const persistedNum = pRes.numeric_value != null ? Number(pRes.numeric_value.toString()).toFixed(4) : null;
        const subNum = sub.numeric_value != null && !isNaN(Number(sub.numeric_value)) ? Number(sub.numeric_value).toFixed(4) : null;
        if (persistedNum !== subNum) {
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

  // Reject manually submitted calculated metrics (they are system-owned)
  const pAny = payload as any;
  if (
    pAny.density !== undefined ||
    pAny.gross_liters !== undefined ||
    pAny.snf !== undefined ||
    pAny.ts !== undefined ||
    pAny.at_13ts_liters !== undefined ||
    pAny.calculation_version !== undefined
  ) {
    return {
      status: 400,
      error: 'Calculated metrics (density, gross_liters, snf, ts, at_13ts_liters, calculation_version) are system-owned and cannot be manually submitted.',
    };
  }

  // Validate quantity
  if (payload.quantity_value === undefined || payload.quantity_value === null || payload.quantity_value === ('' as any)) {
    return { status: 400, error: 'Actual milk quantity is required to complete session.' };
  }
  const quantityNum = Number(payload.quantity_value);
  if (isNaN(quantityNum) || quantityNum <= 0) {
    return { status: 400, error: 'Actual milk quantity must be greater than 0.' };
  }
  if (!payload.quantity_unit || typeof payload.quantity_unit !== 'string') {
    return { status: 400, error: 'Quantity unit is required (KG or LITER).' };
  }
  const quantityUnitNorm = payload.quantity_unit.trim().toUpperCase();
  if (quantityUnitNorm !== 'KG' && quantityUnitNorm !== 'LITER') {
    return { status: 400, error: 'Invalid quantity unit. Must be KG or LITER.' };
  }

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
              summary: true,
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

  // Resolve core measured LR and Fat tests from the merged submitted values
  const mergedSnapshots = session.results.map((snap) => {
    const sub = submittedMap.get(snap.test_id.toString());
    return {
      ...snap,
      numeric_value: sub && sub.numeric_value !== undefined ? sub.numeric_value : snap.numeric_value,
      text_value: sub && sub.text_value !== undefined ? sub.text_value : snap.text_value,
    };
  });

  const resolvedCore = resolveCoreMilkTestResults(mergedSnapshots);
  if (!resolvedCore.success) {
    return { status: resolvedCore.statusCode, error: resolvedCore.error };
  }

  // Compute canonical milk metrics using the single canonical formula owner
  let metrics;
  try {
    metrics = computeCanonicalMilkMetrics(
      quantityNum,
      quantityUnitNorm,
      resolvedCore.lr,
      resolvedCore.fat
    );
  } catch (err: any) {
    return { status: 400, error: err.message || 'Failed to compute canonical milk metrics.' };
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
          quantity_value: new Prisma.Decimal(quantityNum.toFixed(2)),
          quantity_unit: quantityUnitNorm as any,
          density: new Prisma.Decimal(metrics.density.toFixed(4)),
          gross_liters: new Prisma.Decimal(metrics.grossLiters.toFixed(2)),
          snf: new Prisma.Decimal(metrics.snf.toFixed(2)),
          ts: new Prisma.Decimal(metrics.ts.toFixed(2)),
          at_13ts_liters: new Prisma.Decimal(metrics.at13tsLiters.toFixed(2)),
          calculation_version: metrics.calculationVersion,
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
                  summary: true,
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
            arrival_type: session.arrival_type,
            arrival_id: (session.arrival_type === 'MOT' ? session.mot_arrival_id : session.contractor_arrival_id)?.toString(),
            decision,
            rejection_reason: decision === 'REJECTED' ? rejectionReasonTrimmed : null,
            completion_client_event_id: clientEventId,
            quantity_value: quantityNum.toFixed(2),
            quantity_unit: quantityUnitNorm,
            actual_lr: resolvedCore.lr,
            actual_lr_test_code: resolvedCore.lrTest.test_code_snapshot,
            actual_fat: resolvedCore.fat,
            actual_fat_test_code: resolvedCore.fatTest.test_code_snapshot,
            density: metrics.density,
            gross_liters: metrics.grossLiters,
            snf: metrics.snf,
            ts: metrics.ts,
            at_13ts_liters: metrics.at13tsLiters,
            calculation_version: metrics.calculationVersion,
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
                  summary: true,
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
  quantity_value?: number | null;
  quantity_unit?: 'KG' | 'LITER' | string | null;
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

  const { reason, quantity_value, quantity_unit, decision, rejection_reason, remarks, results } = payload || {};

  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return { status: 400, error: 'Audit correction reason is required.' };
  }
  const reasonTrimmed = reason.trim();

  // Reject manual modification of calculated metrics (they are system-owned)
  const pAny = payload as any;
  if (
    pAny.density !== undefined ||
    pAny.gross_liters !== undefined ||
    pAny.snf !== undefined ||
    pAny.ts !== undefined ||
    pAny.at_13ts_liters !== undefined ||
    pAny.calculation_version !== undefined
  ) {
    return {
      status: 400,
      error: 'Calculated metrics cannot be directly corrected. They are system-owned and automatically recomputed.',
    };
  }

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

  if (!auth.isSuperAdmin && (session.manager_correction_count ?? 0) >= 5) {
    return { status: 400, error: 'Maximum correction limit (5) reached for this lab session.' };
  }

  let correctedQty: number | undefined;
  if (quantity_value !== undefined) {
    if (quantity_value === null || isNaN(Number(quantity_value)) || Number(quantity_value) <= 0) {
      return { status: 400, error: 'Corrected quantity must be greater than 0.' };
    }
    correctedQty = Number(Number(quantity_value).toFixed(2));
  }

  let correctedUnit: 'KG' | 'LITER' | undefined;
  if (quantity_unit !== undefined) {
    if (!quantity_unit || !['KG', 'LITER'].includes(quantity_unit.toString().trim().toUpperCase())) {
      return { status: 400, error: 'Corrected quantity unit must be either KG or LITER.' };
    }
    correctedUnit = quantity_unit.toString().trim().toUpperCase() as 'KG' | 'LITER';
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

  const normalizedRemarks = remarks !== undefined ? (remarks ? remarks.trim() : null) : session.remarks;

  // Validate results if provided
  const sessionResultsMap = new Map(session.results.map((r) => [r.test_id.toString(), r]));
  if (Array.isArray(results)) {
    const seenCorrectionTids = new Set<string>();
    for (const item of results) {
      if (!item || item.test_id === undefined || item.test_id === null) {
        return { status: 400, error: 'Every result entry must specify test_id.' };
      }
      const testIdStr = String(item.test_id).trim();
      if (seenCorrectionTids.has(testIdStr)) {
        return { status: 400, error: `Duplicate test_id "${testIdStr}" in correction payload.` };
      }
      seenCorrectionTids.add(testIdStr);

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

  // Detect whether any operational value actually changed (No-op detection)
  let hasChanges = false;
  if (correctedQty !== undefined) {
    const currentQty = session.quantity_value !== null ? Number(Number(session.quantity_value).toFixed(2)) : null;
    if (correctedQty !== currentQty) {
      hasChanges = true;
    }
  }
  if (correctedUnit !== undefined) {
    const currentUnit = session.quantity_unit ? session.quantity_unit.toString().trim().toUpperCase() : null;
    if (correctedUnit !== currentUnit) {
      hasChanges = true;
    }
  }
  if (decision !== undefined && decision !== session.decision) {
    hasChanges = true;
  }
  if (effectiveRejectionReason !== (session.rejection_reason ?? null)) {
    hasChanges = true;
  }
  if (remarks !== undefined && normalizedRemarks !== (session.remarks ?? null)) {
    hasChanges = true;
  }
  if (Array.isArray(results)) {
    for (const item of results) {
      const testIdStr = String(item.test_id).trim();
      const snap = sessionResultsMap.get(testIdStr);
      if (!snap) continue;
      const resType = snap.result_type_snapshot;
      if (resType === 'CALCULATED') continue;

      if (resType === 'NUMERIC') {
        if (item.numeric_value !== undefined) {
          const oldNum = snap.numeric_value !== null ? Number(Number(snap.numeric_value).toFixed(4)) : null;
          const newNum = item.numeric_value !== null ? Number(Number(item.numeric_value).toFixed(4)) : null;
          if (oldNum !== newNum) {
            hasChanges = true;
          }
        }
      } else if (resType === 'TEXT') {
        if (item.text_value !== undefined) {
          const oldTxt = snap.text_value ? snap.text_value.trim() : null;
          const newTxt = item.text_value ? item.text_value.trim() : null;
          if (oldTxt !== newTxt) {
            hasChanges = true;
          }
        }
      } else {
        if (item.text_value !== undefined) {
          const oldTxt = snap.text_value ? snap.text_value.trim().toUpperCase() : null;
          const newTxt = item.text_value ? item.text_value.trim().toUpperCase() : null;
          if (oldTxt !== newTxt) {
            hasChanges = true;
          }
        }
      }
    }
  }

  if (!hasChanges) {
    return { status: 400, error: 'No changes detected.' };
  }

  // Row-lock correction transaction
  try {
    const correctedSession = await prisma.$transaction(async (tx) => {
      const lockedRows: Array<{ id: bigint; correction_count: number; manager_correction_count: number }> = await tx.$queryRaw`
        SELECT id, correction_count, manager_correction_count FROM zmcc_lab_session WHERE id = ${sessionId} FOR UPDATE
      `;

      if (!lockedRows || lockedRows.length === 0) {
        throw new Error('SESSION_NOT_FOUND');
      }

      const currentTotalCount = lockedRows[0].correction_count;
      const currentManagerCount = lockedRows[0].manager_correction_count ?? 0;

      if (!auth.isSuperAdmin && currentManagerCount >= 5) {
        throw new Error('MAX_CORRECTIONS_REACHED');
      }

      const oldValues: any = {
        decision: session.decision,
        rejection_reason: session.rejection_reason,
        remarks: session.remarks,
        quantity_value: session.quantity_value !== null ? Number(session.quantity_value) : null,
        quantity_unit: session.quantity_unit ?? null,
        density: session.density !== null ? Number(session.density) : null,
        gross_liters: session.gross_liters !== null ? Number(session.gross_liters) : null,
        snf: session.snf !== null ? Number(session.snf) : null,
        ts: session.ts !== null ? Number(session.ts) : null,
        at_13ts_liters: session.at_13ts_liters !== null ? Number(session.at_13ts_liters) : null,
        calculation_version: session.calculation_version ?? null,
        correction_count: currentTotalCount,
        manager_correction_count: currentManagerCount,
      };

      const newTotalCount = currentTotalCount + 1;
      const newManagerCount = auth.isSuperAdmin ? currentManagerCount : currentManagerCount + 1;
      const correctionTimestamp = new Date();

      // Compute effective quantity and unit
      const effectiveQty = correctedQty !== undefined
        ? correctedQty
        : (session.quantity_value !== null ? Number(session.quantity_value) : null);
      const effectiveUnit = correctedUnit !== undefined
        ? correctedUnit
        : (session.quantity_unit as 'KG' | 'LITER' | null);

      // Build updated results map for recalculating metrics
      const mergedResultsMap = new Map(session.results.map((r) => [r.test_id.toString(), { ...r }]));

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

          mergedResultsMap.set(testIdStr, {
            ...snap,
            numeric_value: numVal,
            text_value: txtVal,
          });
        }
      }

      // Recompute metrics if effective quantity, unit, LR, and Fat are present
      let newDensity: Prisma.Decimal | null = session.density;
      let newGrossLiters: Prisma.Decimal | null = session.gross_liters;
      let newSnf: Prisma.Decimal | null = session.snf;
      let newTs: Prisma.Decimal | null = session.ts;
      let newAt13ts: Prisma.Decimal | null = session.at_13ts_liters;
      let newCalcVersion: string | null = session.calculation_version;

      if (effectiveQty && effectiveQty > 0 && effectiveUnit && ['KG', 'LITER'].includes(effectiveUnit)) {
        const resolved = resolveCoreMilkTestResults(Array.from(mergedResultsMap.values()));
        if (resolved.success) {
          const m = computeCanonicalMilkMetrics(effectiveQty, effectiveUnit, resolved.lr, resolved.fat);
          newDensity = new Prisma.Decimal(m.density.toFixed(4));
          newGrossLiters = new Prisma.Decimal(m.grossLiters.toFixed(2));
          newSnf = new Prisma.Decimal(m.snf.toFixed(2));
          newTs = new Prisma.Decimal(m.ts.toFixed(2));
          newAt13ts = new Prisma.Decimal(m.at13tsLiters.toFixed(2));
          newCalcVersion = m.calculationVersion;
        }
      }

      const newValues: any = {
        decision: effectiveDecision,
        rejection_reason: effectiveRejectionReason,
        remarks: normalizedRemarks,
        quantity_value: effectiveQty !== null ? effectiveQty : null,
        quantity_unit: effectiveUnit ?? null,
        density: newDensity !== null ? Number(newDensity) : null,
        gross_liters: newGrossLiters !== null ? Number(newGrossLiters) : null,
        snf: newSnf !== null ? Number(newSnf) : null,
        ts: newTs !== null ? Number(newTs) : null,
        at_13ts_liters: newAt13ts !== null ? Number(newAt13ts) : null,
        calculation_version: newCalcVersion ?? null,
        correction_count: newTotalCount,
        manager_correction_count: newManagerCount,
        correction_reason: reasonTrimmed,
        actor_user_id: auth.actorUserId.toString(),
        is_super_admin: auth.isSuperAdmin,
        timestamp: correctionTimestamp.toISOString(),
      };

      const updated = await tx.zmccLabSession.update({
        where: { id: sessionId },
        data: {
          decision: effectiveDecision,
          rejection_reason: effectiveRejectionReason,
          remarks: normalizedRemarks,
          quantity_value: effectiveQty !== null ? new Prisma.Decimal(effectiveQty.toFixed(2)) : null,
          quantity_unit: effectiveUnit as any,
          density: newDensity,
          gross_liters: newGrossLiters,
          snf: newSnf,
          ts: newTs,
          at_13ts_liters: newAt13ts,
          calculation_version: newCalcVersion,
          correction_count: newTotalCount,
          manager_correction_count: newManagerCount,
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
                  summary: true,
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
      return { status: 400, error: 'Maximum correction limit (5) reached for this lab session.' };
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
                summary: true,
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
