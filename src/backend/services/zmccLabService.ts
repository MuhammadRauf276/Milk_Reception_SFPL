import { prisma } from '@core/db';
import { clearDraftsForPortion, type DraftDb } from '@/backend/services/formDraftService';
import { writeAuditLog } from '@/backend/core/audit';
import { isCorrectionAuthority } from '@/backend/core/roles/capabilities';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { asRoleFields, primaryActorFields, resolveActingContext } from '@/backend/core/acting-context';
import {
  MAX_LAB_PORTIONS,
  buildLabPortionDecision,
  summarizePortions,
  type LabPoint,
  type LabPolicySnapshot,
  type LabPortionView,
  type LabTestMode,
  labPolicyToEffectiveTests,
} from '@/backend/services/zmcc/labPortionDecision';
import {
  auditActorOf,
  labPointForArrival,
  loadLabPolicy,
  loadPortionPhotos,
  rollUpLabSessionTx,
  toPortionView,
  type LabSessionRollUp,
} from '@/backend/services/zmcc/labPortionReviewService';
import type { PersonDecision } from '@/types/stage1-decision';
import { recordRejectedMilkForDisposition } from '@/backend/services/rejectedMilkDispositionService';
import { ACTING_AS_HEADER } from '@/backend/core/route-guards';
import type { ActingContext } from '@/types/acting';
import {
  Prisma,
  QuantityUnit,
  type LocalSupplierRmrIssuance,
  type MotJourney,
  type MotJourneySummary,
  type MotProfile,
  type MotVehicle,
  type ProcurementSource,
  type ZmccLabResult,
  type ZmccLabSession,
  type ZmccLocalSupplier,
  type ZmccLocalSupplierArrival,
  type ZmccMotArrival,
  type ZmccRoute,
} from '@prisma/client';
import type { SourceRef, UserRef } from '@/backend/core/serializable';
import { getCurrentUser } from '@core/auth';
import { User, Role } from '@core/types';
import { validateCategoricalOption } from '@/lib/lab-rules';
import { isValidDateOnly } from '@/lib/datetime-utils';
import { computeCanonicalMilkMetrics } from '@/backend/utils/milkFormulas';
import { resolveCoreMilkTestResults, validateCoreMilkTestCandidates } from '@/backend/utils/milkTestResolvers';
import { loadSystemRoles, type PolicyDb } from '@/backend/services/testPointPolicyService';
import { QualityRuleService, type QualityResultEvaluation } from '@/backend/services/qualityRuleService';
import { TestingPoint } from '@/types/milk-test-policy';
import { getTankPhysicalStock, serializeTankReceipt } from '@/backend/services/zmccTankService';
import { clearHandledNotifications, createNotificationsForEvent } from '@/backend/services/notificationService';
import { getErrorCode, getErrorMessage } from '@/lib/errors';
import { jsonRecord, toJsonInput } from '@/lib/json';
import type { LabTestResultOption } from '@/lib/validations/labTest';

export interface ZmccLabAuthContext {
  user: User;
  actorUserId: bigint;
  role: Role;
  isSuperAdmin: boolean;
  isDataExecutive: boolean;
  isZmccManager: boolean;
  isMpdHead: boolean;
  isZmccLabAttendant: boolean;
  /** Own ZMCC for source-scoped actors; null = whole system (Super Admin, Data Executive, MPD Head). */
  effectiveZmccId: bigint | null;
  /** Who is acting as which role (delegation record for *_as_role / *_is_delegated). */
  acting: ActingContext;
  /** "If you can approve it, you can decide it": Zonal Manager or above, never Data Executive. */
  deciderCanApprove: boolean;
}

export type ZmccLabAction =
  | 'READ_LAB'
  | 'START_OR_RESUME_SESSION'
  | 'UPDATE_DRAFT'
  | 'COMPLETE_SESSION'
  | 'CORRECT_SESSION'
  | 'ISSUE_LOCAL_SUPPLIER_RMR'
  | 'SETUP_PORTIONS'
  | 'DECIDE_PORTION';

export interface ServiceResult<T> {
  status: number;
  data?: T;
  error?: string;
}

// Lab work is the Lab Attendant's; every role above it (Zonal Manager, MPD Head, Super Admin) may do it by delegation.
const LAB_WORK_ROLES = ['ZMCC_LAB_ATTENDANT'] as const;
const LAB_READ_ROLES = ['ZMCC_LAB_ATTENDANT', 'DATA_EXECUTIVE'] as const;

const SCOPE_MESSAGES: Record<string, string> = {
  OUTSIDE_SCOPE: 'Forbidden. This record is outside your area.',
  SOURCE_TYPE_MISMATCH: 'Forbidden. This record is for a different kind of source.',
  NO_SCOPE_BOUND: 'Forbidden. User must be assigned to an active ZMCC procurement source.',
  CANNOT_ACT_AS: 'Forbidden. You cannot work as this role.',
};

export async function resolveZmccLabAuth(
  reqOrUser?: Request | User,
  action: ZmccLabAction = 'READ_LAB'
): Promise<{ auth?: ZmccLabAuthContext; errorResponse?: { error: string; status: number } }> {
  let authUser: User | null = null;
  const isRequest = typeof Request !== 'undefined' && reqOrUser instanceof Request;
  if (reqOrUser && !isRequest && 'role' in reqOrUser && 'id' in reqOrUser) {
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
  const isDataExecutive = role === 'DATA_EXECUTIVE';
  const isZmccManager = role === 'ZMCC_MANAGER';
  const isMpdHead = role === 'HEAD_OF_MPD';
  const isZmccLabAttendant = role === 'ZMCC_LAB_ATTENDANT';

  const user: User = {
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
  };

  // Permission checks by action, through the acting context (delegation to ancestors, own ZMCC scope).
  const requestedAs = isRequest ? (reqOrUser as Request).headers.get(ACTING_AS_HEADER) : null;
  let allowed: readonly string[];
  let delegation: 'ancestors' | 'none' = 'ancestors';
  let forbiddenMessage: string;
  if (action === 'CORRECT_SESSION') {
    // CORRECT is non-delegable: Data Executive and Super Admin only.
    allowed = ['DATA_EXECUTIVE'];
    delegation = 'none';
    forbiddenMessage = 'Forbidden. Only Data Executive or Super Admin may correct finalized lab records.';
  } else if (action === 'READ_LAB') {
    allowed = LAB_READ_ROLES;
    forbiddenMessage = 'Forbidden. You do not have permission to access ZMCC laboratory data.';
  } else if (action === 'ISSUE_LOCAL_SUPPLIER_RMR') {
    allowed = LAB_WORK_ROLES;
    forbiddenMessage = 'Forbidden. Only the ZMCC Lab Attendant (or a superior) may issue Local Supplier RMRs.';
  } else {
    allowed = LAB_WORK_ROLES;
    forbiddenMessage = 'Forbidden. Only the ZMCC Lab Attendant (or a superior) may do laboratory testing.';
  }

  const resolved = resolveActingContext(user, allowed, { delegation, requestedAs });
  if (!resolved.ok) {
    if (resolved.code === 'FORBIDDEN') return { errorResponse: { error: forbiddenMessage, status: 403 } };
    return { errorResponse: { error: SCOPE_MESSAGES[resolved.code] ?? forbiddenMessage, status: 403 } };
  }
  const acting = resolved.ctx;
  if (action === 'CORRECT_SESSION' && !isCorrectionAuthority(role)) {
    return { errorResponse: { error: forbiddenMessage, status: 403 } };
  }

  let effectiveZmccId: bigint | null = null;
  if (acting.scope.kind === 'SOURCE') {
    if (acting.scope.sourceType !== 'ZMCC') {
      return { errorResponse: { error: 'Forbidden. Assigned procurement source is not a ZMCC.', status: 403 } };
    }
    effectiveZmccId = acting.scope.sourceId;
  } else if (acting.scope.kind === 'SYSTEM') {
    if (isRequest) {
      try {
        const req = reqOrUser as Request;
        const url = new URL(req.url);
        const reqZmcc =
          url.searchParams.get('zmccId') ||
          url.searchParams.get('zmcc_id') ||
          req.headers.get('x-acting-source-id');

        if (reqZmcc && /^\d+$/.test(reqZmcc.trim())) {
          const validSource = await prisma.procurementSource.findFirst({
            where: { id: BigInt(reqZmcc.trim()), is_active: true, source_type: 'ZMCC' },
            select: { id: true },
          });
          if (validSource) {
            effectiveZmccId = validSource.id;
          } else {
            return { errorResponse: { error: 'Invalid or inactive ZMCC source requested.', status: 400 } };
          }
        }
      } catch (_err) {
        // Graceful fallback
      }
    }
  } else {
    return { errorResponse: { error: forbiddenMessage, status: 403 } };
  }

  return {
    auth: {
      user,
      actorUserId,
      role,
      isSuperAdmin,
      isDataExecutive,
      isZmccManager,
      isMpdHead,
      isZmccLabAttendant,
      effectiveZmccId,
      acting,
      deciderCanApprove: canActAs(role, 'ZMCC_MANAGER'),
    },
  };
}

export interface IssueLocalSupplierRmrPayload {
  series: string;
  book_number: string;
  receipt_number: string;
  idempotency_key: string;
}

function serializeLocalSupplierRmr(issuance: LocalSupplierRmrIssuance) {
  return {
    id: issuance.id.toString(), local_supplier_arrival_id: issuance.local_supplier_arrival_id.toString(),
    final_lab_session_id: issuance.final_lab_session_id.toString(), tank_receipt_id: issuance.tank_receipt_id.toString(),
    zmcc_id: issuance.zmcc_id.toString(), local_supplier_id: issuance.local_supplier_id.toString(), year: issuance.rmr_year,
    series: issuance.series, book_number: issuance.book_number, receipt_number: issuance.receipt_number,
    printable_reference: `${issuance.series}-${issuance.rmr_year}-${issuance.book_number}-${issuance.receipt_number}`,
    accepted_quantity_value: Number(issuance.accepted_quantity_value), accepted_quantity_unit: issuance.accepted_quantity_unit,
    status: issuance.status, issued_at: issuance.issued_at instanceof Date ? issuance.issued_at.toISOString() : issuance.issued_at,
  };
}

export async function issueLocalSupplierRmr(
  reqOrUser: Request | User, arrivalIdParam: string | number | bigint, payload: IssueLocalSupplierRmrPayload
): Promise<ServiceResult<unknown>> {
  const { auth, errorResponse } = await resolveZmccLabAuth(reqOrUser, 'ISSUE_LOCAL_SUPPLIER_RMR');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };
  let arrivalId: bigint;
  try { arrivalId = BigInt(String(arrivalIdParam).trim()); } catch { return { status: 400, error: 'Invalid Local Supplier arrival ID.' }; }
  const normal = (value: unknown, label: string, max: number) => {
    const result = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!result || result.length > max || !/^[A-Z0-9][A-Z0-9/_-]*$/.test(result)) throw new Error(`${label} has an invalid format.`);
    return result;
  };
  let series: string, bookNumber: string, receiptNumber: string, idempotencyKey: string;
  try {
    series = normal(payload?.series, 'Series', 30); bookNumber = normal(payload?.book_number, 'Book number', 50);
    receiptNumber = normal(payload?.receipt_number, 'Receipt number', 50); idempotencyKey = normal(payload?.idempotency_key, 'Idempotency key', 255);
  } catch (error) { return { status: 400, error: getErrorMessage(error) }; }
  try {
    const issuance = await prisma.$transaction(async (tx) => {
      const arrival = await tx.zmccLocalSupplierArrival.findUnique({
        where: { id: arrivalId }, include: { lab_session: { include: { tank_receipt: true } }, rmr_issuance: true },
      });
      if (!arrival) throw new Error('ARRIVAL_NOT_FOUND');
      if (auth.effectiveZmccId !== null && arrival.zmcc_id !== auth.effectiveZmccId) throw new Error('FORBIDDEN_SOURCE');
      const session = arrival.lab_session;
      if (!session || (session.final_decision || session.decision) !== 'ACCEPTED' || !session.tank_receipt || !session.quantity_value || !session.quantity_unit) throw new Error('NOT_FINALLY_ACCEPTED');
      const byKey = await tx.localSupplierRmrIssuance.findUnique({ where: { idempotency_key: idempotencyKey } });
      if (byKey) {
        if (byKey.local_supplier_arrival_id === arrivalId && byKey.series === series && byKey.book_number === bookNumber && byKey.receipt_number === receiptNumber) return byKey;
        throw new Error('IDEMPOTENCY_CONFLICT');
      }
      if (arrival.rmr_issuance) throw new Error('RMR_ALREADY_ISSUED');
      const rmrYear = new Date().getFullYear();
      const lockKey = `LOCAL_SUPPLIER_RMR:${arrival.zmcc_id}:${rmrYear}:${series}:${bookNumber}:${receiptNumber}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const duplicate = await tx.localSupplierRmrIssuance.findFirst({ where: { zmcc_id: arrival.zmcc_id, rmr_year: rmrYear, series, book_number: bookNumber, receipt_number: receiptNumber } });
      if (duplicate) throw new Error('PAPER_NUMBER_CONFLICT');
      const created = await tx.localSupplierRmrIssuance.create({ data: {
        local_supplier_arrival_id: arrivalId, final_lab_session_id: session.id, tank_receipt_id: session.tank_receipt.id,
        zmcc_id: arrival.zmcc_id, local_supplier_id: arrival.local_supplier_id, rmr_year: rmrYear, series,
        book_number: bookNumber, receipt_number: receiptNumber, accepted_quantity_value: session.quantity_value,
        accepted_quantity_unit: session.quantity_unit, issued_by_user_id: auth.actorUserId, idempotency_key: idempotencyKey,
      }});
      await writeAuditLog(tx, { tableName: 'local_supplier_rmr_issuance', recordId: created.id, action: 'LOCAL_SUPPLIER_RMR_ISSUED', oldValues: null,
        newValues: { local_supplier_arrival_id: arrivalId.toString(), final_lab_session_id: session.id.toString(), tank_receipt_id: session.tank_receipt.id.toString(), year: rmrYear, series, book_number: bookNumber, receipt_number: receiptNumber, accepted_quantity_value: Number(session.quantity_value), accepted_quantity_unit: session.quantity_unit }, actor: { userId: auth.actorUserId, actorRole: auth.role } });
      return created;
    });
    return { status: 201, data: serializeLocalSupplierRmr(issuance) };
  } catch (error) {
    const messages: Record<string, [number, string]> = {
      ARRIVAL_NOT_FOUND: [404, 'Local Supplier arrival not found.'], FORBIDDEN_SOURCE: [403, 'Forbidden. Arrival belongs to another ZMCC.'],
      NOT_FINALLY_ACCEPTED: [400, 'RMR can only be issued after final acceptance and successful tank receipt.'], RMR_ALREADY_ISSUED: [409, 'A Local Supplier RMR is already issued for this arrival.'],
      IDEMPOTENCY_CONFLICT: [409, 'Idempotency key was already used for a different RMR command.'], PAPER_NUMBER_CONFLICT: [409, 'This RMR paper number is already used in this ZMCC annual series.'],
    };
    if (messages[getErrorMessage(error)]) return { status: messages[getErrorMessage(error)][0], error: messages[getErrorMessage(error)][1] };
    if (error instanceof Prisma.PrismaClientKnownRequestError && getErrorCode(error) === 'P2002') return { status: 409, error: 'RMR issuance conflicted with an existing paper identity or arrival.' };
    console.error('issueLocalSupplierRmr error:', error); return { status: 500, error: 'Failed to issue Local Supplier RMR.' };
  }
}

export function serializeLabResult(res: ZmccLabResult) {
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
    applied_rule_id: res.applied_rule_id ? res.applied_rule_id.toString() : null,
    applied_rule_version: res.applied_rule_version ?? null,
    recorded_at: res.recorded_at instanceof Date ? res.recorded_at.toISOString() : res.recorded_at,
    created_at: res.created_at instanceof Date ? res.created_at.toISOString() : res.created_at,
    updated_at: res.updated_at instanceof Date ? res.updated_at.toISOString() : res.updated_at,
  };
}

export async function createCanonicalTankReceiptTx(
  tx: Prisma.TransactionClient,
  params: {
    sessionId: bigint;
    zmccId: bigint;
    targetTankId: bigint;
    arrivalType: string;
    quantityNum: number;
    quantityUnitNorm: string;
    metrics: {
      density: number;
      grossLiters: number;
      snf: number;
      ts: number;
      at13tsLiters: number;
      calculationVersion: string;
    };
    lr: number;
    fat: number;
    actorUserId: bigint;
    actorRole?: string | null;
    receivedAt: Date;
  }
) {
  const {
    sessionId,
    zmccId,
    targetTankId,
    arrivalType,
    quantityNum,
    quantityUnitNorm,
    metrics,
    lr,
    fat,
    actorUserId,
    actorRole,
    receivedAt,
  } = params;

  // Lock target tank
  const lockedTankRows: Array<{ id: bigint; zmcc_id: bigint; capacity_liters: Prisma.Decimal; is_active: boolean }> =
    await tx.$queryRaw`
      SELECT id, zmcc_id, capacity_liters, is_active FROM zmcc_tank WHERE id = ${targetTankId} FOR UPDATE
    `;
  if (!lockedTankRows || lockedTankRows.length === 0) {
    throw new Error('TANK_NOT_FOUND');
  }
  if (lockedTankRows[0].zmcc_id !== zmccId) {
    throw new Error('TANK_WRONG_ZMCC');
  }
  if (!lockedTankRows[0].is_active) {
    throw new Error('TANK_INACTIVE:Destination ZMCC tank is inactive.');
  }

  const tankCapacity = Number(lockedTankRows[0].capacity_liters);
  const currentStock = await getTankPhysicalStock(targetTankId, tx);
  const availableCapacity = Math.max(0, tankCapacity - currentStock);

  if (metrics.grossLiters > availableCapacity) {
    const availStr = availableCapacity.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const reqStr = metrics.grossLiters.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    throw new Error(`INSUFFICIENT_CAPACITY:Tank capacity is insufficient. ${availStr} L available; ${reqStr} L required.`);
  }

  const existingReceipt = await tx.zmccTankReceipt.findUnique({
    where: { lab_session_id: sessionId },
    include: { tank: true, receiver: true },
  });
  if (existingReceipt) {
    return existingReceipt;
  }

  const tankReceipt = await tx.zmccTankReceipt.create({
    data: {
      lab_session_id: sessionId,
      zmcc_id: zmccId,
      tank_id: targetTankId,
      arrival_type: arrivalType,
      quantity_value: new Prisma.Decimal(quantityNum.toFixed(2)),
      quantity_unit: quantityUnitNorm as QuantityUnit,
      density: new Prisma.Decimal(metrics.density.toFixed(4)),
      gross_liters: new Prisma.Decimal(metrics.grossLiters.toFixed(2)),
      lr: new Prisma.Decimal(lr.toFixed(2)),
      fat: new Prisma.Decimal(fat.toFixed(2)),
      snf: new Prisma.Decimal(metrics.snf.toFixed(2)),
      ts: new Prisma.Decimal(metrics.ts.toFixed(2)),
      at_13ts_liters: new Prisma.Decimal(metrics.at13tsLiters.toFixed(2)),
      calculation_version: metrics.calculationVersion,
      received_at: receivedAt,
      received_by_user_id: actorUserId,
    },
    include: {
      tank: true,
      receiver: true,
    },
  });

  await tx.zmccTankInventoryTransaction.create({
    data: {
      tank_id: targetTankId,
      zmcc_id: zmccId,
      transaction_type: 'RECEIPT',
      quantity_liters: new Prisma.Decimal(metrics.grossLiters.toFixed(2)),
      at_13ts_liters: new Prisma.Decimal(metrics.at13tsLiters.toFixed(2)),
      tank_receipt_id: tankReceipt.id,
      reference_type: 'ZMCC_LAB_SESSION',
      reference_id: sessionId.toString(),
      idempotency_key: `ZMCC_TANK_RECEIPT:LAB_SESSION:${sessionId}`,
      operational_timestamp: receivedAt,
      performed_by_user_id: actorUserId,
      notes: `Tank receipt for ${arrivalType} arrival (Session #${sessionId})`,
    },
  });

  await writeAuditLog(tx, {
    tableName: 'zmcc_tank_receipt',
    recordId: tankReceipt.id,
    action: 'ZMCC_TANK_RECEIPT_CREATED',
    oldValues: null,
    newValues: {
      lab_session_id: sessionId.toString(),
      arrival_type: arrivalType,
      zmcc_id: zmccId.toString(),
      tank_id: targetTankId.toString(),
      quantity_value: quantityNum.toFixed(2),
      quantity_unit: quantityUnitNorm,
      gross_liters: metrics.grossLiters,
      lr,
      fat,
      at_13ts_liters: metrics.at13tsLiters,
      calculation_version: metrics.calculationVersion,
    },
    actor: { userId: actorUserId, actorRole: actorRole ?? null },
  });

  return tankReceipt;
}

/** A lab session plus whichever relations the query included (all optional). */
export type SerializableLabSession = ZmccLabSession & {
  zmcc?: (SourceRef & Pick<ProcurementSource, 'source_type'>) | null;
  starter?: UserRef | null;
  completer?: UserRef | null;
  last_corrector?: UserRef | null;
  mot_arrival?:
    | (ZmccMotArrival & {
        journey?:
          | (MotJourney & {
              route?: ZmccRoute | null;
              mot_vehicle?: MotVehicle | null;
              mot_profile?: MotProfile | null;
              summary?: MotJourneySummary | null;
            })
          | null;
      })
    | null;
  local_supplier_arrival?: (ZmccLocalSupplierArrival & { local_supplier?: ZmccLocalSupplier | null }) | null;
  tank_receipt?: Parameters<typeof serializeTankReceipt>[0] | null;
  results?: ZmccLabResult[];
};

export function serializeLabSession(session: SerializableLabSession) {
  return {
    id: session.id.toString(),
    zmcc_id: session.zmcc_id.toString(),
    arrival_type: session.arrival_type,
    mot_arrival_id: session.mot_arrival_id ? session.mot_arrival_id.toString() : null,
    local_supplier_arrival_id: session.local_supplier_arrival_id ? session.local_supplier_arrival_id.toString() : null,
    status: session.status,
    started_by_user_id: session.started_by_user_id.toString(),
    started_at: session.started_at instanceof Date ? session.started_at.toISOString() : session.started_at,
    completed_by_user_id: session.completed_by_user_id ? session.completed_by_user_id.toString() : null,
    completed_at: session.completed_at instanceof Date ? session.completed_at.toISOString() : session.completed_at,
    decision: session.decision,
    attendant_recommendation: session.attendant_recommendation || null,
    attendant_recommended_by_user_id: session.attendant_recommended_by_user_id ? session.attendant_recommended_by_user_id.toString() : null,
    attendant_recommended_at: session.attendant_recommended_at instanceof Date ? session.attendant_recommended_at.toISOString() : session.attendant_recommended_at,
    final_decision: session.final_decision || null,
    final_decided_by_user_id: session.final_decided_by_user_id ? session.final_decided_by_user_id.toString() : null,
    final_decided_at: session.final_decided_at instanceof Date ? session.final_decided_at.toISOString() : session.final_decided_at,
    final_decision_reason: session.final_decision_reason || null,
    system_quality_outcome: session.system_quality_outcome || null,
    manager_review_status: session.manager_review_status || null,
    manager_requested_decision: session.manager_requested_decision || null,
    manager_review_requested_by_user_id: session.manager_review_requested_by_user_id ? session.manager_review_requested_by_user_id.toString() : null,
    manager_review_requested_at: session.manager_review_requested_at instanceof Date ? session.manager_review_requested_at.toISOString() : session.manager_review_requested_at,
    manager_reviewed_by_user_id: session.manager_reviewed_by_user_id ? session.manager_reviewed_by_user_id.toString() : null,
    manager_reviewed_at: session.manager_reviewed_at instanceof Date ? session.manager_reviewed_at.toISOString() : session.manager_reviewed_at,
    manager_review_reason: session.manager_review_reason || null,
    original_decision: session.original_decision || null,
    corrected_decision: session.corrected_decision || null,
    correction_reason: session.correction_reason || null,
    // Aliases of the last-correction columns (the model has no separate corrected_by/corrected_at).
    corrected_by: session.last_corrected_by_user_id ? session.last_corrected_by_user_id.toString() : null,
    corrected_at: session.last_corrected_at ? session.last_corrected_at.toISOString() : null,
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
          exit_timestamp: session.mot_arrival.exit_timestamp instanceof Date ? session.mot_arrival.exit_timestamp.toISOString() : (session.mot_arrival.exit_timestamp ?? null),
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
    local_supplier_arrival: session.local_supplier_arrival
      ? {
          id: session.local_supplier_arrival.id.toString(),
          local_supplier_id: session.local_supplier_arrival.local_supplier_id.toString(),
          rmr_number: session.local_supplier_arrival.rmr_number,
          vehicle_number: session.local_supplier_arrival.vehicle_number,
          zmcc_token: session.local_supplier_arrival.zmcc_token,
          arrival_timestamp: session.local_supplier_arrival.arrival_timestamp instanceof Date ? session.local_supplier_arrival.arrival_timestamp.toISOString() : session.local_supplier_arrival.arrival_timestamp,
          arrival_date: session.local_supplier_arrival.arrival_date instanceof Date ? session.local_supplier_arrival.arrival_date.toISOString().split('T')[0] : session.local_supplier_arrival.arrival_date,
          exit_timestamp: session.local_supplier_arrival.exit_timestamp instanceof Date ? session.local_supplier_arrival.exit_timestamp.toISOString() : (session.local_supplier_arrival.exit_timestamp ?? null),
          local_supplier: session.local_supplier_arrival.local_supplier
            ? {
                id: session.local_supplier_arrival.local_supplier.id.toString(),
                local_supplier_code: session.local_supplier_arrival.local_supplier.local_supplier_code,
                name: session.local_supplier_arrival.local_supplier.name,
              }
            : undefined,
        }
      : undefined,
    tank_receipt: session.tank_receipt ? serializeTankReceipt(session.tank_receipt) : null,
    results: session.results ? session.results.map(serializeLabResult) : [],
  };
}

export async function getArrivalsQueue(
  reqOrUser: Request | User
): Promise<ServiceResult<unknown>> {
  const { auth, errorResponse } = await resolveZmccLabAuth(reqOrUser, 'READ_LAB');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const effectiveZmccId = auth.effectiveZmccId;

  // MOT arrivals condition:
  // 1. zmcc_id matches (if scoped)
  // 2. lab_session is null OR lab_session.status = 'IN_PROGRESS'
  // 3. the vehicle has reached the ZMCC (COMPLETED on journeys from before ARRIVED existed)
  const motWhere: Prisma.ZmccMotArrivalWhereInput = {
    ...(effectiveZmccId ? { zmcc_id: effectiveZmccId } : {}),
    journey: { status: { in: ['ARRIVED', 'COMPLETED'] } },
    OR: [
      { lab_session: null },
      { lab_session: { status: 'IN_PROGRESS' } },
    ],
  };

  // HC arrivals condition:
  // 1. zmcc_id matches (if scoped)
  // 2. lab_session is null OR lab_session.status = 'IN_PROGRESS'
  const localSupplierWhere: Prisma.ZmccLocalSupplierArrivalWhereInput = {
    ...(effectiveZmccId ? { zmcc_id: effectiveZmccId } : {}),
    OR: [
      { lab_session: null },
      { lab_session: { status: 'IN_PROGRESS' } },
    ],
  };

  const [motArrivals, localSupplierArrivals] = await Promise.all([
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
        lab_session: {
          include: { portions: true },
        },
      },
      orderBy: { arrival_timestamp: 'asc' },
    }),
    prisma.zmccLocalSupplierArrival.findMany({
      where: localSupplierWhere,
      include: {
        zmcc: true,
        local_supplier: true,
        recorded_by: true,
        lab_session: {
          include: { portions: true },
        },
      },
      orderBy: { arrival_timestamp: 'asc' },
    }),
  ]);

  const queueItems: Array<Record<string, unknown> & { arrival_timestamp: Date | string }> = [];

  for (const m of motArrivals) {
    const lab = m.lab_session;
    if (lab) {
      const hasPortions = Array.isArray(lab.portions) && lab.portions.length > 0;
      const allDecided = hasPortions && lab.portions.every((p) => p.final_decision !== 'PENDING');
      if (lab.status === 'COMPLETED' || allDecided) {
        if (lab.status === 'IN_PROGRESS' && allDecided) {
          rollUpLabSessionTx(prisma, lab.id, auth.acting).catch((e) =>
            console.error('Self-heal rollup error for session', lab.id, e)
          );
        }
        continue;
      }
    }
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

  for (const ls of localSupplierArrivals) {
    const lab = ls.lab_session;
    if (lab) {
      const hasPortions = Array.isArray(lab.portions) && lab.portions.length > 0;
      const allDecided = hasPortions && lab.portions.every((p) => p.final_decision !== 'PENDING');
      if (lab.status === 'COMPLETED' || allDecided) {
        if (lab.status === 'IN_PROGRESS' && allDecided) {
          rollUpLabSessionTx(prisma, lab.id, auth.acting).catch((e) =>
            console.error('Self-heal rollup error for session', lab.id, e)
          );
        }
        continue;
      }
    }
    queueItems.push({
      queue_type: 'HC',
      arrival_id: ls.id.toString(),
      zmcc_id: ls.zmcc_id.toString(),
      zmcc_code: ls.zmcc.code,
      zmcc_name: ls.zmcc.name,
      zmcc_token: ls.zmcc_token,
      local_supplier_id: ls.local_supplier_id.toString(),
      local_supplier_code: ls.local_supplier.local_supplier_code,
      local_supplier_name: ls.local_supplier.name,
      rmr_number: ls.rmr_number,
      vehicle_number: ls.vehicle_number,
      arrival_timestamp: ls.arrival_timestamp.toISOString(),
      arrival_date: ls.arrival_date.toISOString().split('T')[0],
      lab_session_id: ls.lab_session ? ls.lab_session.id.toString() : null,
      lab_session_status: ls.lab_session ? ls.lab_session.status : null,
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
  arrival_type: 'MOT' | 'HC';
  arrival_id: string | number | bigint;
}

export async function startOrResumeSession(
  reqOrUser: Request | User,
  payload: StartOrResumePayload
): Promise<ServiceResult<unknown>> {
  const { auth, errorResponse } = await resolveZmccLabAuth(reqOrUser, 'START_OR_RESUME_SESSION');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const { arrival_type, arrival_id } = payload;
  if (!arrival_type || !['MOT', 'HC'].includes(arrival_type)) {
    return { status: 400, error: 'arrival_type must be MOT or HC.' };
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

    if (auth.effectiveZmccId !== null && arrival.zmcc_id !== auth.effectiveZmccId) {
      return { status: 403, error: 'Forbidden. Arrival record belongs to another ZMCC.' };
    }

    if (arrival.journey.status !== 'ARRIVED' && arrival.journey.status !== 'COMPLETED') {
      return { status: 400, error: 'Cannot start lab session before the MOT journey reaches the ZMCC.' };
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
    const arrival = await prisma.zmccLocalSupplierArrival.findUnique({
      where: { id: arrivalIdBigInt },
      include: {
        local_supplier: true,
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
      return { status: 404, error: 'HC Arrival not found.' };
    }

    if (auth.effectiveZmccId !== null && arrival.zmcc_id !== auth.effectiveZmccId) {
      return { status: 403, error: 'Forbidden. Arrival record belongs to another ZMCC.' };
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
  const testingPoint: TestingPoint = arrival_type === 'MOT' ? 'ZMCC_LAB_MC' : 'ZMCC_LAB_HC';
  // Matrix-first, the same source the portion decision uses (loadLabPolicy -> resolveStageCells): a test turned OFF or ON
  // only in the Master Matrix is handled identically at session start and at decision time.
  const effectiveTests = labPolicyToEffectiveTests(await loadLabPolicy(testingPoint));
  const effectiveRulePoint = testingPoint;

  if (!effectiveTests || effectiveTests.length === 0) {
    return { status: 400, error: `No active milk test policy is configured for ${testingPoint}.` };
  }

  // A required test without exactly one effective RELEASE rule must never enter
  // an operational session. This avoids collecting evidence that cannot later
  // receive a valid final decision.
  const activeRules = await QualityRuleService.resolveActiveRulesForTestingPoint(effectiveRulePoint);
  const invalidRequiredTest = effectiveTests.find((test) => {
    if (!test.isRequired || test.resultType === 'CALCULATED') return false;
    const rule = activeRules.get(test.id);
    return !rule || rule.isConfigurationError || rule.rule_category !== 'RELEASE';
  });
  if (invalidRequiredTest) {
    return {
      status: 422,
      error: `Required test ${invalidRequiredTest.testCode} has no valid active RELEASE rule for ${effectiveRulePoint}. QA Head configuration is required.`,
    };
  }

  // Pre-flight validate that policy contains exactly one LR and one Fat candidate
  const candidateValidation = validateCoreMilkTestCandidates(
    effectiveTests.map((t) => ({ ...t, testId: t.id })),
    await loadSystemRoles(prisma as unknown as PolicyDb)
  );
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
        where: arrival_type === 'MOT'
          ? { mot_arrival_id: arrivalIdBigInt }
          : { local_supplier_arrival_id: arrivalIdBigInt },
        include: {
          zmcc: true,
          starter: true,
          completer: true,
          mot_arrival: { include: { journey: { include: { route: true, mot_vehicle: true, mot_profile: true, summary: true } } } },
          local_supplier_arrival: { include: { local_supplier: true } },
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
          local_supplier_arrival_id: arrival_type === 'HC' ? arrivalIdBigInt : null,
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
          mot_arrival: { include: { journey: { include: { route: true, mot_vehicle: true, mot_profile: true, summary: true } } } },
          local_supplier_arrival: { include: { local_supplier: true } },
          results: {
            orderBy: { display_order_snapshot: 'asc' },
          },
        },
      });

      // Automatically initialize Portion 1 for immediate testing
      await tx.zmccLabPortion.create({
        data: {
          lab_session_id: newSession.id,
          portion_number: 1,
          status: 'TESTING',
          final_decision: 'PENDING',
          created_by_user_id: auth.actorUserId,
          ...primaryActorFields(auth.acting),
        },
      });

      return newSession;
    });

    return {
      status: 201,
      data: serializeLabSession(session),
    };
  } catch (err) {
    // Check if unique constraint violated (concurrent start)
    if (err instanceof Prisma.PrismaClientKnownRequestError && getErrorCode(err) === 'P2002') {
      const existing = await prisma.zmccLabSession.findFirst({
        where: arrival_type === 'MOT'
          ? { mot_arrival_id: arrivalIdBigInt }
          : { local_supplier_arrival_id: arrivalIdBigInt },
        include: {
          zmcc: true,
          starter: true,
          completer: true,
          last_corrector: true,
          mot_arrival: { include: { journey: { include: { route: true, mot_vehicle: true, mot_profile: true, summary: true } } } },
          local_supplier_arrival: { include: { local_supplier: true } },
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
): Promise<ServiceResult<unknown>> {
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
      local_supplier_arrival: {
        include: {
          local_supplier: true,
        },
      },
      tank_receipt: {
        include: {
          tank: true,
          receiver: true,
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

  if (auth.effectiveZmccId !== null && session.zmcc_id !== auth.effectiveZmccId) {
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
): Promise<ServiceResult<unknown>> {
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

  if (auth.effectiveZmccId !== null && session.zmcc_id !== auth.effectiveZmccId) {
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
        const options = existing.result_options_snapshot as LabTestResultOption[] | null;
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
    const testingPoint = session.arrival_type === 'MOT'
      ? 'ZMCC_LAB_MC'
      : 'ZMCC_LAB_HC';

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
          const rule = await QualityRuleService.resolveActiveRule(existing.test_id, testingPoint, session.started_at || new Date(), tx);
          const evaluation = QualityRuleService.evaluateQualityResult({
            rule,
            numericValue: num,
            resultType: existing.result_type_snapshot,
            resultOptions: existing.result_options_snapshot,
          });
          isPassed = evaluation.isPassed;
          evalStatus = evaluation.evaluationStatus;
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
          const rule = await QualityRuleService.resolveActiveRule(existing.test_id, testingPoint, session.started_at || new Date(), tx);
          const evaluation = QualityRuleService.evaluateQualityResult({
            rule,
            textValue: txtVal,
            resultType: existing.result_type_snapshot,
            resultOptions: existing.result_options_snapshot,
          });
          isPassed = evaluation.isPassed;
          evalStatus = evaluation.evaluationStatus;
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
      const resolved = resolveCoreMilkTestResults(
        Array.from(updatedDraftResultsMap.values()),
        await loadSystemRoles(tx as unknown as PolicyDb)
      );
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

    const sessionUpdateData: Prisma.ZmccLabSessionUpdateInput = {};
    if (payload.quantity_value !== undefined) {
      sessionUpdateData.quantity_value = payload.quantity_value !== null ? new Prisma.Decimal(effectiveQty!.toFixed(2)) : null;
    }
    if (normalizedDraftUnit !== undefined) {
      sessionUpdateData.quantity_unit = normalizedDraftUnit as QuantityUnit;
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
  exceptionReason?: string | null;
  exception_reason?: string | null;
  remarks?: string | null;
  tank_id?: string | number | bigint | null;
  results: Array<{
    test_id: string | number | bigint;
    numeric_value?: number | null;
    text_value?: string | null;
  }>;
}

function matchesPersistedSessionCompletion(
  persistedSession: ZmccLabSession & { results: ZmccLabResult[]; tank_receipt?: { tank_id: bigint } | null },
  targetSessionId: bigint,
  payload: CompleteSessionPayload
): boolean {
  // 1. Session identity
  if (persistedSession.id.toString() !== targetSessionId.toString()) {
    return false;
  }

  // 2. Decision
  const persistedAttendantDecision = persistedSession.attendant_recommendation || persistedSession.decision;
  if (persistedAttendantDecision !== payload.decision) {
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

  // 7. Tank identity for ACCEPTED sessions if tank_id was explicitly provided
  if (payload.decision === 'ACCEPTED' && payload.tank_id !== undefined && payload.tank_id !== null && String(payload.tank_id).trim() !== '') {
    const submittedTankId = String(payload.tank_id).trim();
    const persistedTankId = persistedSession.tank_receipt ? persistedSession.tank_receipt.tank_id.toString() : null;
    if (persistedTankId && persistedTankId !== submittedTankId) {
      return false;
    }
  }

  // 8. Complete submitted test-result set
  if (!Array.isArray(payload.results) || !Array.isArray(persistedSession.results)) {
    return false;
  }

  const persistedMap = new Map<string, ZmccLabResult>(persistedSession.results.map((r) => [r.test_id.toString(), r]));

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
): Promise<ServiceResult<unknown>> {
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
  // Clients must not submit server-computed metrics; inspect the raw payload for them.
  const pAny = payload as unknown as Record<string, unknown>;
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
  if (payload.quantity_value === undefined || payload.quantity_value === null || (payload.quantity_value as unknown) === '') {
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
      local_supplier_arrival: {
        include: {
          local_supplier: true,
        },
      },
      tank_receipt: {
        include: {
          tank: true,
          receiver: true,
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
      local_supplier_arrival: true,
    },
  });

  if (!session) {
    return { status: 404, error: 'ZMCC Lab session not found.' };
  }

  if (auth.effectiveZmccId !== null && session.zmcc_id !== auth.effectiveZmccId) {
    return { status: 403, error: 'Forbidden. Lab session belongs to another ZMCC.' };
  }

  if (session.status === 'COMPLETED') {
    return { status: 409, error: 'ZMCC Lab session is already completed.' };
  }

  if (!decision || !['ACCEPTED', 'REJECTED'].includes(decision)) {
    return { status: 400, error: 'Lab Attendant decision must be ACCEPTED or REJECTED.' };
  }

  const rejectionReasonTrimmed = (payload.exceptionReason || payload.exception_reason || rejection_reason || '').trim();

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
        const options = snap.result_options_snapshot as LabTestResultOption[] | null;
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

  const resolvedCore = resolveCoreMilkTestResults(mergedSnapshots, await loadSystemRoles(prisma as unknown as PolicyDb));
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
  } catch (err) {
    return { status: 400, error: getErrorMessage(err) || 'Failed to compute canonical milk metrics.' };
  }

  // An acceptance needs the one active destination tank. An exception is still
  // checked now, but stock is not posted until the manager approves it.
  let targetTankId: bigint | null = null;
  if (decision === 'ACCEPTED') {
    const activeTanks = await prisma.zmccTank.findMany({
      where: { zmcc_id: session.zmcc_id, is_active: true },
      orderBy: { id: 'asc' },
    });

    if (payload.tank_id !== undefined && payload.tank_id !== null && String(payload.tank_id).trim() !== '') {
      try {
        const suppliedTankId = BigInt(String(payload.tank_id).trim());
        const suppliedTank = await prisma.zmccTank.findUnique({ where: { id: suppliedTankId } });
        if (!suppliedTank) {
          return { status: 404, error: 'Selected ZMCC tank not found.' };
        }
        if (suppliedTank.zmcc_id !== session.zmcc_id) {
          return { status: 403, error: 'Forbidden. Destination tank belongs to another ZMCC.' };
        }
        if (!suppliedTank.is_active) {
          return { status: 400, error: 'Destination ZMCC tank is inactive.' };
        }
      } catch {
        return { status: 400, error: 'Invalid tank_id format.' };
      }
    }

    if (activeTanks.length === 0) {
      return { status: 400, error: 'No active ZMCC tank is configured.' };
    }
    if (activeTanks.length > 1) {
      return {
        status: 400,
        error: 'Configuration error: Multiple active tanks exist for this ZMCC. Exactly one active tank is permitted.',
      };
    }

    const soleTank = activeTanks[0];
    targetTankId = soleTank.id;

    if (payload.tank_id !== undefined && payload.tank_id !== null && String(payload.tank_id).trim() !== '') {
      try {
        const suppliedTankId = BigInt(String(payload.tank_id).trim());
        if (suppliedTankId !== soleTank.id) {
          return { status: 400, error: 'Selected tank does not match the active ZMCC tank.' };
        }
      } catch {
        return { status: 400, error: 'Invalid tank_id format.' };
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

      // Determine testing point
      const testingPoint = session.arrival_type === 'MOT'
        ? 'ZMCC_LAB_MC'
      : 'ZMCC_LAB_HC';

      const evaluations: Array<QualityResultEvaluation & { isRequired: boolean }> = [];

      // Update all submitted test results
      for (const item of results) {
        const testIdStr = String(item.test_id).trim();
        const existing = sessionResultsMap.get(testIdStr);
        if (!existing) continue;
        const resType = existing.result_type_snapshot;

        let numVal: Prisma.Decimal | null = null;
        let txtVal: string | null = null;

        if (resType === 'CALCULATED') {
          continue;
        } else if (resType === 'NUMERIC') {
          if (item.numeric_value !== undefined && item.numeric_value !== null) {
            const n = Number(item.numeric_value);
            numVal = new Prisma.Decimal(n.toFixed(4));
          }
        } else {
          if (item.text_value && item.text_value.trim()) {
            txtVal = item.text_value.trim();
          }
        }

        const activeRule = await QualityRuleService.resolveActiveRule(
          existing.test_id,
          testingPoint,
          session.started_at || new Date(),
          tx
        );

        const evalResult = QualityRuleService.evaluateQualityResult({
          rule: activeRule,
          numericValue: numVal !== null ? Number(numVal) : null,
          textValue: txtVal,
          resultType: existing.result_type_snapshot,
          resultOptions: existing.result_options_snapshot,
        });

        evaluations.push({
          ...evalResult,
          isRequired: existing.is_required_snapshot,
        });

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
            is_passed: evalResult.isPassed,
            evaluation_status: evalResult.evaluationStatus,
            applied_rule_id: evalResult.appliedRuleId,
            applied_rule_version: evalResult.appliedRuleVersion,
            evaluation_snapshot: toJsonInput(evalResult.evaluationSnapshot),
            recorded_at: new Date(),
          },
        });
      }

      const systemQualityOutcome = QualityRuleService.aggregateSystemQualityOutcome(evaluations);

      // Fail closed on RULE_CONFIGURATION_ERROR or NO_ACTIVE_RULE: Acceptance, receipt creation, and stock movement are strictly blocked
      if (
        (systemQualityOutcome === 'RULE_CONFIGURATION_ERROR' ||
          evaluations.some((e) => e.evaluationStatus === 'RULE_CONFIGURATION_ERROR'))
      ) {
        throw new Error(
          'RULE_CONFIGURATION_ERROR:Laboratory rule configuration error detected. QA completion cannot accept milk under invalid rule configuration.'
        );
      }
      if (systemQualityOutcome === 'NO_ACTIVE_RULE') {
        throw new Error(
          'NO_ACTIVE_RULE:Cannot accept milk: required laboratory release rule is missing. QA Head configuration required.'
        );
      }

      const systemRecommendation = ['PASS', 'WARNING', 'NEUTRAL'].includes(systemQualityOutcome)
        ? 'ACCEPTED'
        : 'REJECTED';
      const isAttendantException = decision !== systemRecommendation;
      if (isAttendantException && !rejectionReasonTrimmed) {
        throw new Error('ATTENDANT_EXCEPTION_REASON_REQUIRED:A reason is required when the Lab Attendant decision differs from the system result.');
      }

      // The attendant decides normal cases. Only a disagreement is held for
      // ZMCC Manager review, preserving both the system evidence and human choice.
      const effectiveDecision: string | null = isAttendantException ? 'PENDING' : decision;
      const effectiveFinalDecision: string | null = isAttendantException ? null : decision;
      const effectiveManagerReviewStatus = isAttendantException ? 'PENDING' : 'NONE';
      const effectiveManagerRequestedDecision = isAttendantException ? decision : null;
      const effectiveReviewRequestedBy: bigint | null = isAttendantException ? auth.actorUserId : null;
      const effectiveReviewRequestedAt: Date | null = isAttendantException ? new Date() : null;
      const completedAt = new Date();

      const updated = await tx.zmccLabSession.update({
        where: { id: sessionId },
        data: {
          status: 'COMPLETED',
          completed_by_user_id: auth.actorUserId,
          completed_at: completedAt,
          decision: effectiveDecision,
          attendant_recommendation: decision,
          attendant_recommended_by_user_id: auth.actorUserId,
          attendant_recommended_at: completedAt,
          final_decision: effectiveFinalDecision,
          final_decided_by_user_id: effectiveFinalDecision ? auth.actorUserId : null,
          final_decided_at: effectiveFinalDecision ? completedAt : null,
          final_decision_reason: isAttendantException ? null : (decision === 'REJECTED' ? rejectionReasonTrimmed || null : null),
          system_quality_outcome: systemQualityOutcome,
          manager_review_status: effectiveManagerReviewStatus,
          manager_requested_decision: effectiveManagerRequestedDecision,
          manager_review_requested_by_user_id: effectiveReviewRequestedBy,
          manager_review_requested_at: effectiveReviewRequestedAt,
          // Retains the attendant's exception rationale even when their chosen
          // outcome is ACCEPTED and manager review is pending.
          rejection_reason: rejectionReasonTrimmed || null,
          remarks: remarks ? remarks.trim() : null,
          completion_client_event_id: clientEventId,
          quantity_value: new Prisma.Decimal(quantityNum.toFixed(2)),
          quantity_unit: quantityUnitNorm as QuantityUnit,
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
          tank_receipt: {
            include: {
              tank: true,
              receiver: true,
            },
          },
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
          local_supplier_arrival: {
            include: {
              local_supplier: true,
            },
          },
          results: {
            orderBy: { display_order_snapshot: 'asc' },
          },
        },
      });

      let completedWithReceipt: SerializableLabSession = updated;
      if (effectiveFinalDecision === 'ACCEPTED' && targetTankId) {
        const tankReceipt = await createCanonicalTankReceiptTx(tx, {
          sessionId,
          zmccId: session.zmcc_id,
          targetTankId,
          arrivalType: session.arrival_type,
          quantityNum,
          quantityUnitNorm,
          metrics,
          lr: resolvedCore.lr,
          fat: resolvedCore.fat,
          actorUserId: auth.actorUserId,
          actorRole: auth.role,
          receivedAt: updated.completed_at || new Date(),
        });
        completedWithReceipt = { ...updated, tank_receipt: tankReceipt };
      }

      await writeAuditLog(tx, {
        tableName: 'zmcc_lab_session',
        recordId: sessionId,
        action: 'ZMCC_LAB_SESSION_COMPLETED',
        oldValues: { status: 'IN_PROGRESS' },
        newValues: {
          status: 'COMPLETED',
          arrival_type: session.arrival_type,
          arrival_id: (session.arrival_type === 'MOT' ? session.mot_arrival_id : session.local_supplier_arrival_id)?.toString(),
          attendant_decision: decision,
          system_quality_outcome: systemQualityOutcome,
          final_decision: effectiveFinalDecision,
          manager_review_status: effectiveManagerReviewStatus,
          exception_reason: isAttendantException ? rejectionReasonTrimmed : null,
          rejection_reason: decision === 'REJECTED' ? rejectionReasonTrimmed || null : null,
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
        actor: { userId: auth.actorUserId, actorRole: auth.role },
      });

      if (isAttendantException) {
        await createNotificationsForEvent(tx, {
          eventKey: 'ZMCC_LAB_EXCEPTION_PENDING', sourceId: sessionId.toString(), sourceZmccId: session.zmcc_id,
          title: 'ZMCC lab exception needs review',
          body: `A ${session.arrival_type.toLowerCase()} milk decision differs from the system recommendation.`,
          deepLink: '/mpd/zmcc-manager?tab=HISTORY&view=LAB_CORRECTIONS', dedupeSuffix: `${sessionId}:${clientEventId}`,
        });
      }

      return completedWithReceipt;
    });

    return {
      status: 200,
      data: serializeLabSession(completedSession),
    };
  } catch (err) {
    if (getErrorMessage(err) && getErrorMessage(err).startsWith('ATTENDANT_EXCEPTION_REASON_REQUIRED:')) {
      return { status: 400, error: getErrorMessage(err).replace('ATTENDANT_EXCEPTION_REASON_REQUIRED:', '') };
    }
    if (getErrorMessage(err) && getErrorMessage(err).startsWith('RULE_CONFIGURATION_ERROR:')) {
      const msg = getErrorMessage(err).replace('RULE_CONFIGURATION_ERROR:', '');
      return { status: 400, error: msg };
    }
    if (getErrorMessage(err) && getErrorMessage(err).startsWith('INSUFFICIENT_CAPACITY:')) {
      const msg = getErrorMessage(err).replace('INSUFFICIENT_CAPACITY:', '');
      return { status: 400, error: msg };
    }
    if (getErrorMessage(err) && getErrorMessage(err).startsWith('TANK_INACTIVE:')) {
      const msg = getErrorMessage(err).replace('TANK_INACTIVE:', '');
      return { status: 400, error: msg };
    }
    if (getErrorMessage(err) === 'TANK_WRONG_ZMCC') {
      return { status: 403, error: 'Forbidden. Selected tank belongs to another ZMCC.' };
    }
    if (getErrorMessage(err) === 'TANK_NOT_FOUND') {
      return { status: 404, error: 'Selected destination tank not found.' };
    }
    if (getErrorMessage(err) === 'REPLAY_MATCH_CHECK' || getErrorMessage(err) === 'SESSION_ALREADY_COMPLETED') {
      const completedExisting = await prisma.zmccLabSession.findUnique({
        where: { id: sessionId },
        include: {
          zmcc: true,
          starter: true,
          completer: true,
          last_corrector: true,
          tank_receipt: {
            include: {
              tank: true,
              receiver: true,
            },
          },
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
          local_supplier_arrival: {
            include: {
              local_supplier: true,
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
    if (err instanceof Prisma.PrismaClientKnownRequestError && getErrorCode(err) === 'P2002') {
      const owningSession = await prisma.zmccLabSession.findUnique({
        where: { completion_client_event_id: clientEventId },
        include: {
          zmcc: true,
          starter: true,
          completer: true,
          last_corrector: true,
          tank_receipt: {
            include: {
              tank: true,
              receiver: true,
            },
          },
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
          local_supplier_arrival: {
            include: {
              local_supplier: true,
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
  idempotency_key?: string;
  reason?: string;
  correction_reason?: string;
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
): Promise<ServiceResult<unknown>> {
  const { auth, errorResponse } = await resolveZmccLabAuth(reqOrUser, 'CORRECT_SESSION');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  let sessionId: bigint;
  try {
    sessionId = BigInt(String(sessionIdParam).trim());
  } catch {
    return { status: 400, error: 'Invalid session ID format.' };
  }

  const { reason, correction_reason, quantity_value, quantity_unit, decision, rejection_reason, remarks, results } = payload || {};

  const rawReason = (remarks !== undefined && remarks !== null && String(remarks).trim() !== '')
    ? String(remarks).trim()
    : ((reason !== undefined && reason !== null && String(reason).trim() !== '')
      ? String(reason).trim()
      : ((correction_reason !== undefined && correction_reason !== null && String(correction_reason).trim() !== '')
        ? String(correction_reason).trim()
        : ''));

  if (!rawReason) {
    return { status: 400, error: 'Substantive remarks / reason are required.' };
  }
  const reasonTrimmed = rawReason;

  // Reject manual modification of calculated metrics (they are system-owned)
  // Clients must not submit server-computed metrics; inspect the raw payload for them.
  const pAny = payload as unknown as Record<string, unknown>;
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
      tank_receipt: {
        include: {
          tank: true,
          receiver: true,
        },
      },
    },
  });

  if (!session) {
    return { status: 404, error: 'ZMCC Lab session not found.' };
  }

  if (auth.effectiveZmccId !== null && session.zmcc_id !== auth.effectiveZmccId) {
    return { status: 403, error: 'Forbidden. Lab session belongs to another ZMCC.' };
  }

  if (session.status !== 'COMPLETED') {
    return { status: 400, error: 'Only COMPLETED lab sessions can be corrected.' };
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

  const isPendingReview = session.decision === 'PENDING' || session.manager_review_status === 'PENDING';
  const isRejectedSession = session.decision === 'REJECTED';

  if (!isPendingReview && !isCorrectionAuthority(auth.role)) {
    return { status: 403, error: 'Forbidden. Only Super Admin or Data Executive may edit saved records.' };
  }

  // Quality exception decisions for OUT_OF_SPEC must be resolved by the ZMCC Manager for this ZMCC, not Super Admin.
  if (isPendingReview && !isCorrectionAuthority(auth.role)) {
    return {
      status: 403,
      error: 'Forbidden. OUT_OF_SPEC quality exception review must be resolved by a Data Executive or Super Admin.',
    };
  }

  // Fail closed if approving exception while rule configuration is invalid or missing
  if (decision === 'ACCEPTED') {
    if (session.system_quality_outcome === 'RULE_CONFIGURATION_ERROR' || session.system_quality_outcome === 'NO_ACTIVE_RULE') {
      return {
        status: 422,
        error: 'Cannot approve exception: Laboratory rule configuration error exists or missing required release rule. Must be resolved by QA Head.',
      };
    }
  }

  const idempotencyKey = payload.idempotency_key ? String(payload.idempotency_key).trim() : undefined;
  if (idempotencyKey) {
    const priorAudit = await prisma.auditLog.findFirst({
      where: {
        table_name: 'zmcc_lab_session',
        record_id: sessionId,
        action: {
          in: [
            'ZMCC_MANAGER_EXCEPTION_APPROVED',
            'ZMCC_MANAGER_EXCEPTION_REJECTED',
            'ZMCC_LAB_SESSION_CORRECTED',
            'ZMCC_MANAGER_REVIEW_AFTER_EXIT',
          ],
        },
      },
      orderBy: { id: 'desc' },
    });
    if (priorAudit && jsonRecord(priorAudit.new_values).idempotency_key === idempotencyKey) {
      const priorDecision = jsonRecord(priorAudit.new_values).decision || jsonRecord(priorAudit.new_values).requested_manager_decision;
      const priorReason = jsonRecord(priorAudit.new_values).reason || jsonRecord(priorAudit.new_values).correction_reason;
      if ((decision && priorDecision && priorDecision !== decision) || (priorReason && priorReason !== reasonTrimmed)) {
        return { status: 409, error: 'Conflict: Idempotency key reused with different decision or reason.' };
      }
      return { status: 200, data: serializeLabSession(session) };
    }
  }

  // Idempotency checks
  if (session.manager_review_status === 'REVIEWED_EXITED') {
    if (session.manager_review_reason && session.manager_review_reason !== reasonTrimmed) {
      return { status: 409, error: 'Conflict: Review after exit was already recorded with a different reason.' };
    }
    return { status: 200, data: serializeLabSession(session) };
  }
  if (session.manager_review_status === 'APPROVED' && decision === 'ACCEPTED') {
    if (session.manager_review_reason && session.manager_review_reason !== reasonTrimmed) {
      return { status: 409, error: 'Conflict: Exception decision was already recorded with a different reason.' };
    }
    return { status: 200, data: serializeLabSession(session) };
  }
  if (session.manager_review_status === 'REJECTED' && decision === 'REJECTED') {
    if (session.manager_review_reason && session.manager_review_reason !== reasonTrimmed) {
      return { status: 409, error: 'Conflict: Exception decision was already recorded with a different reason.' };
    }
    return { status: 200, data: serializeLabSession(session) };
  }
  if (session.manager_review_status === 'APPROVED' && decision === 'REJECTED') {
    return { status: 409, error: 'Conflict: Exception was already approved and received.' };
  }

  // If accepting, verify physical reality: check if the arrival has already exited
  if (decision === 'ACCEPTED') {
    let hasExited = false;
    let exitTimestamp: Date | null = null;
    if (session.arrival_type === 'MOT' && session.mot_arrival_id) {
      const arr = await prisma.zmccMotArrival.findUnique({ where: { id: session.mot_arrival_id } });
      if (arr?.exit_timestamp) {
        hasExited = true;
        exitTimestamp = arr.exit_timestamp;
      }
    } else if (session.arrival_type === 'HC' && session.local_supplier_arrival_id) {
      const arr = await prisma.zmccLocalSupplierArrival.findUnique({ where: { id: session.local_supplier_arrival_id } });
      if (arr?.exit_timestamp) {
        hasExited = true;
        exitTimestamp = arr.exit_timestamp;
      }
    }

    if (hasExited) {
      // Physical reality preserved: arrival has already exited the facility.
      // Record an audit-only review without altering decision to ACCEPTED and without creating tank stock.
      const now = new Date();
      const updated = await prisma.$transaction(async (tx) => {
        await clearHandledNotifications(tx, ['ZMCC_LAB_EXCEPTION_PENDING'], sessionId);
        const sessionAfter = await tx.zmccLabSession.update({
          where: { id: sessionId },
          data: {
            manager_review_status: 'REVIEWED_EXITED',
            manager_reviewed_by_user_id: auth.actorUserId,
            manager_reviewed_at: now,
            manager_review_reason: reasonTrimmed,
            manager_requested_decision: 'ACCEPTED',
          },
          include: {
            zmcc: true,
            starter: true,
            completer: true,
            last_corrector: true,
            tank_receipt: {
              include: {
                tank: true,
                receiver: true,
              },
            },
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
            local_supplier_arrival: {
              include: {
                local_supplier: true,
              },
            },
            results: {
              orderBy: { display_order_snapshot: 'asc' },
            },
          },
        });

        await writeAuditLog(tx, {
          tableName: 'zmcc_lab_session',
          recordId: sessionId,
          action: 'ZMCC_MANAGER_REVIEW_AFTER_EXIT',
          oldValues: {
            session_id: sessionId.toString(),
            effective_decision: session.decision,
            original_decision: session.original_decision || session.decision,
            exception_classification: session.corrected_decision,
            manager_review_status: session.manager_review_status,
            current_status: session.status,
            system_quality_outcome: session.system_quality_outcome,
            physical_exit_state: true,
            exit_timestamp: exitTimestamp ? exitTimestamp.toISOString() : null,
            existing_receipt_or_stock_linkage: session.tank_receipt ? session.tank_receipt.id.toString() : null,
          },
          newValues: {
            session_id: sessionId.toString(),
            review_only: true,
            requested_manager_decision: 'ACCEPTED',
            effective_decision: session.decision,
            exception_classification: session.corrected_decision,
            review_status: 'REVIEWED_EXITED',
            reason: reasonTrimmed,
            actor: auth.actorUserId.toString(),
            timestamp: now.toISOString(),
            physical_mutation_performed: false,
            arrival_type: session.arrival_type,
            arrival_exited: true,
            exit_timestamp: exitTimestamp ? exitTimestamp.toISOString() : null,
          },
          actor: { userId: auth.actorUserId, actorRole: auth.role },
        });

        return sessionAfter;
      });

      return { status: 200, data: serializeLabSession(updated) };
    }
  }

  // Reject invalid transition from ACCEPTED (with milk received) to REJECTED
  if (decision === 'REJECTED' && session.decision === 'ACCEPTED') {
    if (session.tank_receipt) {
      return {
        status: 400,
        error: 'Decision cannot be changed after milk has been received into a ZMCC tank.',
      };
    }
  }

  let effectiveDecision = decision || session.decision;
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
          const options = snap.result_options_snapshot as LabTestResultOption[] | null;
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
  if (isPendingReview || (isRejectedSession && decision !== undefined)) {
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
      await clearHandledNotifications(tx, ['ZMCC_LAB_EXCEPTION_PENDING'], sessionId);
      const lockedRows: Array<{ id: bigint; correction_count: number; manager_correction_count: number }> = await tx.$queryRaw`
        SELECT id, correction_count, manager_correction_count FROM zmcc_lab_session WHERE id = ${sessionId} FOR UPDATE
      `;

      if (!lockedRows || lockedRows.length === 0) {
        throw new Error('SESSION_NOT_FOUND');
      }

      const currentTotalCount = lockedRows[0].correction_count;
      const currentManagerCount = lockedRows[0].manager_correction_count ?? 0;

      if (!isPendingReview && !isCorrectionAuthority(auth.role)) {
        throw new Error('ONLY_CORRECTION_AUTHORITY_ALLOWED');
      }

      const oldValues: Record<string, unknown> = {
        session_id: sessionId.toString(),
        effective_decision: session.decision,
        original_decision: session.original_decision ?? (isPendingReview ? null : session.decision),
        exception_classification: session.corrected_decision,
        manager_review_status: session.manager_review_status,
        current_status: session.status,
        system_quality_outcome: session.system_quality_outcome,
        physical_exit_state: false,
        exit_timestamp: null,
        existing_receipt_or_stock_linkage: session.tank_receipt ? session.tank_receipt.id.toString() : null,
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

      const newTotalCount = isPendingReview ? currentTotalCount : currentTotalCount + 1;
      const newManagerCount = currentManagerCount;
      const correctionTimestamp = new Date();

      // Compute effective quantity and unit
      const effectiveQty = correctedQty !== undefined
        ? correctedQty
        : (session.quantity_value !== null ? Number(session.quantity_value) : null);
      const effectiveUnit = correctedUnit !== undefined
        ? correctedUnit
        : (session.quantity_unit as 'KG' | 'LITER' | null);

      // Determine testing point and event timestamp
      const testingPoint = session.arrival_type === 'MOT'
        ? 'ZMCC_LAB_MC'
      : 'ZMCC_LAB_HC';

      const eventTimestamp = session.started_at || session.completed_at || correctionTimestamp;
      const allEvaluations: Array<QualityResultEvaluation & { isRequired: boolean }> = [];

      // Build updated results map for recalculating metrics
      const mergedResultsMap = new Map(session.results.map((r) => [r.test_id.toString(), { ...r }]));
      const submittedResultsMap = new Map(Array.isArray(results) ? results.map((r) => [String(r.test_id).trim(), r]) : []);

      for (const snap of session.results) {
        const testIdStr = snap.test_id.toString();
        const item = submittedResultsMap.get(testIdStr);
        const resType = snap.result_type_snapshot;

        let numVal: Prisma.Decimal | null = snap.numeric_value;
        let txtVal: string | null = snap.text_value;
        let isChanged = false;

        if (item) {
          if (resType === 'CALCULATED') {
            // calculated cannot be manually modified
          } else if (resType === 'NUMERIC') {
            if (item.numeric_value !== undefined) {
              isChanged = true;
              numVal = item.numeric_value !== null ? new Prisma.Decimal(Number(item.numeric_value).toFixed(4)) : null;
            }
          } else {
            if (item.text_value !== undefined) {
              isChanged = true;
              txtVal = item.text_value !== null && item.text_value.trim() ? item.text_value.trim() : null;
            }
          }
        }

        const activeRule = await QualityRuleService.resolveActiveRule(
          snap.test_id,
          testingPoint,
          snap.recorded_at || eventTimestamp,
          tx
        );

        const evalResult = QualityRuleService.evaluateQualityResult({
          rule: activeRule,
          numericValue: numVal !== null ? Number(numVal) : null,
          textValue: txtVal,
          resultType: snap.result_type_snapshot,
          resultOptions: snap.result_options_snapshot as LabTestResultOption[] | null,
        });

        allEvaluations.push({
          ...evalResult,
          isRequired: snap.is_required_snapshot,
        });

        if (isChanged) {
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
              is_passed: evalResult.isPassed,
              evaluation_status: evalResult.evaluationStatus,
              applied_rule_id: evalResult.appliedRuleId,
              applied_rule_version: evalResult.appliedRuleVersion,
              evaluation_snapshot: toJsonInput(evalResult.evaluationSnapshot),
              recorded_at: correctionTimestamp,
            },
          });
        }

        mergedResultsMap.set(testIdStr, {
          ...snap,
          numeric_value: numVal,
          text_value: txtVal,
          is_passed: evalResult.isPassed,
          evaluation_status: evalResult.evaluationStatus,
          applied_rule_id: evalResult.appliedRuleId,
          applied_rule_version: evalResult.appliedRuleVersion,
        });
      }

      const recomputedSystemQualityOutcome = QualityRuleService.aggregateSystemQualityOutcome(allEvaluations);

      // BLOCKER C: Fail closed if RULE_CONFIGURATION_ERROR or NO_ACTIVE_RULE is detected
      if (
        recomputedSystemQualityOutcome === 'RULE_CONFIGURATION_ERROR' ||
        allEvaluations.some((e) => e.evaluationStatus === 'RULE_CONFIGURATION_ERROR')
      ) {
        if (effectiveDecision === 'ACCEPTED') {
          throw new Error(
            'RULE_CONFIGURATION_ERROR:Cannot approve session with RULE_CONFIGURATION_ERROR. Manager override is only permitted for OUT_OF_SPEC results.'
          );
        }
      }

      if (
        recomputedSystemQualityOutcome === 'NO_ACTIVE_RULE' ||
        allEvaluations.some((e) => e.evaluationStatus === 'NO_ACTIVE_RULE')
      ) {
        if (effectiveDecision === 'ACCEPTED') {
          throw new Error(
            'NO_ACTIVE_RULE:Cannot approve session with NO_ACTIVE_RULE. Missing required laboratory release rule. Must be resolved by QA Head.'
          );
        }
      }

      const isExceptionReview = isPendingReview || (isRejectedSession && decision === 'ACCEPTED');

      // Conflict routing: If corrected system truth is OUT_OF_SPEC for an accepted session without manager approval
      if (!isExceptionReview && effectiveDecision === 'ACCEPTED' && recomputedSystemQualityOutcome === 'OUT_OF_SPEC') {
        effectiveDecision = null;
      }

      // Recompute metrics if effective quantity, unit, LR, and Fat are present
      let newDensity: Prisma.Decimal | null = session.density;
      let newGrossLiters: Prisma.Decimal | null = session.gross_liters;
      let newSnf: Prisma.Decimal | null = session.snf;
      let newTs: Prisma.Decimal | null = session.ts;
      let newAt13ts: Prisma.Decimal | null = session.at_13ts_liters;
      let newCalcVersion: string | null = session.calculation_version;

      if (effectiveQty && effectiveQty > 0 && effectiveUnit && ['KG', 'LITER'].includes(effectiveUnit)) {
        const resolved = resolveCoreMilkTestResults(
          Array.from(mergedResultsMap.values()),
          await loadSystemRoles(tx as unknown as PolicyDb)
        );
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

      let physicalMutationPerformed = false;

      // Check if session has an existing ZmccTankReceipt
      const lockedReceiptRows: Array<{
        id: bigint;
        tank_id: bigint;
        gross_liters: Prisma.Decimal;
        at_13ts_liters: Prisma.Decimal;
      }> = await tx.$queryRaw`
        SELECT id, tank_id, gross_liters, at_13ts_liters FROM zmcc_tank_receipt WHERE lab_session_id = ${sessionId} FOR UPDATE
      `;

      if (lockedReceiptRows && lockedReceiptRows.length > 0) {
        const receiptRow = lockedReceiptRows[0];
        const oldReceiptGross = Number(receiptRow.gross_liters);
        const oldReceiptAt13 = Number(receiptRow.at_13ts_liters || 0);
        const newGrossNum = newGrossLiters !== null ? Number(newGrossLiters) : oldReceiptGross;
        const newAt13Num = newAt13ts !== null ? Number(newAt13ts) : oldReceiptAt13;
        const deltaGross = Number((newGrossNum - oldReceiptGross).toFixed(2));
        const deltaAt13 = Number((newAt13Num - oldReceiptAt13).toFixed(2));

        // Lock destination tank row FOR UPDATE
        const lockedTankRows: Array<{ id: bigint; capacity_liters: Prisma.Decimal }> = await tx.$queryRaw`
          SELECT id, capacity_liters FROM zmcc_tank WHERE id = ${receiptRow.tank_id} FOR UPDATE
        `;
        if (!lockedTankRows || lockedTankRows.length === 0) {
          throw new Error('TANK_NOT_FOUND');
        }

        const tankCap = Number(lockedTankRows[0].capacity_liters);
        const currentStock = await getTankPhysicalStock(receiptRow.tank_id, tx);

        if (deltaGross > 0) {
          const available = Math.max(0, tankCap - currentStock);
          if (deltaGross > available) {
            const availStr = available.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
            const deltaStr = deltaGross.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
            throw new Error(`INSUFFICIENT_CAPACITY:Tank capacity is insufficient for correction. ${availStr} L available; ${deltaStr} L required.`);
          }
        } else if (deltaGross < 0) {
          const absGross = Math.abs(deltaGross);
          if (currentStock < absGross) {
            throw new Error(`NEGATIVE_STOCK:Correction would result in negative tank physical stock. Current stock: ${currentStock} L, deduction: ${absGross} L.`);
          }
        }

        const hasPhysicalDelta = Math.abs(deltaGross) >= 0.01;
        const hasCommercialDelta = Math.abs(deltaAt13) >= 0.01;

        if (hasPhysicalDelta) {
          physicalMutationPerformed = true;
          const txType = deltaGross > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
          const invTx = await tx.zmccTankInventoryTransaction.create({
            data: {
              tank_id: receiptRow.tank_id,
              zmcc_id: session.zmcc_id,
              transaction_type: txType,
              quantity_liters: new Prisma.Decimal(Math.abs(deltaGross).toFixed(2)),
              at_13ts_liters: hasCommercialDelta ? new Prisma.Decimal(Math.abs(deltaAt13).toFixed(2)) : new Prisma.Decimal('0.00'),
              tank_receipt_id: receiptRow.id,
              reference_type: 'ZMCC_LAB_SESSION_CORRECTION',
              reference_id: `${sessionId}:${newTotalCount}:PHYSICAL`,
              idempotency_key: `ZMCC_TANK_ADJUSTMENT:LAB_SESSION:${sessionId}:CORR:${newTotalCount}:PHYSICAL`,
              operational_timestamp: correctionTimestamp,
              performed_by_user_id: auth.actorUserId,
              notes: `Correction physical adjustment (${txType}) for session #${sessionId} (${deltaGross > 0 ? '+' : ''}${deltaGross} L${hasCommercialDelta ? `, @13: ${deltaAt13 > 0 ? '+' : ''}${deltaAt13} L` : ''})`,
            },
          });

          await writeAuditLog(tx, {
            tableName: 'zmcc_tank_inventory_transaction',
            recordId: invTx.id,
            action: `ZMCC_TANK_INVENTORY_${txType}`,
            oldValues: null,
            newValues: {
              tank_id: receiptRow.tank_id.toString(),
              zmcc_id: session.zmcc_id.toString(),
              transaction_type: txType,
              quantity_liters: Math.abs(deltaGross).toFixed(2),
              at_13ts_liters: hasCommercialDelta ? Math.abs(deltaAt13).toFixed(2) : '0.00',
              tank_receipt_id: receiptRow.id.toString(),
              lab_session_id: sessionId.toString(),
              correction_count: newTotalCount,
            },
            actor: { userId: auth.actorUserId, actorRole: auth.role },
          });
        }

        // Update ZmccTankReceipt quality & metric snapshot
        const resolvedCoreAfter = resolveCoreMilkTestResults(
          Array.from(mergedResultsMap.values()),
          await loadSystemRoles(tx as unknown as PolicyDb)
        );
        await tx.zmccTankReceipt.update({
          where: { id: receiptRow.id },
          data: {
            quantity_value: effectiveQty !== null ? new Prisma.Decimal(effectiveQty.toFixed(2)) : undefined,
            quantity_unit: (effectiveUnit as QuantityUnit | null) || undefined,
            density: newDensity || undefined,
            gross_liters: newGrossLiters || undefined,
            lr: resolvedCoreAfter.success ? new Prisma.Decimal(resolvedCoreAfter.lr.toFixed(2)) : undefined,
            fat: resolvedCoreAfter.success ? new Prisma.Decimal(resolvedCoreAfter.fat.toFixed(2)) : undefined,
            snf: newSnf || undefined,
            ts: newTs || undefined,
            at_13ts_liters: newAt13ts || undefined,
            calculation_version: newCalcVersion || undefined,
            correction_count: newTotalCount,
            manager_correction_count: newManagerCount,
            last_corrected_by_user_id: auth.actorUserId,
            last_corrected_at: correctionTimestamp,
          },
        });
      } else if (isExceptionReview && effectiveDecision === 'ACCEPTED') {
        // Pending or rejected exception approved by manager on-site -> create canonical tank receipt
        // Enforce exact-one-active-tank behavior (Item B)
        const activeTanks = await tx.zmccTank.findMany({
          where: { zmcc_id: session.zmcc_id, is_active: true },
          orderBy: { id: 'asc' },
        });
        if (activeTanks.length === 0) {
          throw new Error('NO_ACTIVE_TANK:No active ZMCC tank is configured.');
        }
        if (activeTanks.length > 1) {
          throw new Error('MULTIPLE_ACTIVE_TANKS:Configuration error: Multiple active tanks exist for this ZMCC. Exactly one active tank is permitted.');
        }
        const targetTankId = activeTanks[0].id;

        // Never fabricate fake LR/Fat fallbacks (Item B)
        const resolvedCorePending = resolveCoreMilkTestResults(
          Array.from(mergedResultsMap.values()),
          await loadSystemRoles(tx as unknown as PolicyDb)
        );
        if (!resolvedCorePending.success) {
          throw new Error(`MISSING_CORE_TESTS:${resolvedCorePending.error || 'Authoritative LR and Fat test results are missing or ambiguous. Cannot create tank receipt.'}`);
        }

        const unitToUse = (effectiveUnit || session.quantity_unit || 'LITER') as string;
        const pendingMetrics = computeCanonicalMilkMetrics(
          effectiveQty || Number(session.quantity_value),
          unitToUse,
          resolvedCorePending.lr,
          resolvedCorePending.fat
        );
        await createCanonicalTankReceiptTx(tx, {
          sessionId,
          zmccId: session.zmcc_id,
          targetTankId,
          arrivalType: session.arrival_type,
          quantityNum: effectiveQty || Number(session.quantity_value),
          quantityUnitNorm: unitToUse,
          metrics: pendingMetrics,
          lr: resolvedCorePending.lr,
          fat: resolvedCorePending.fat,
          actorUserId: auth.actorUserId,
          actorRole: auth.role,
          receivedAt: correctionTimestamp,
        });
        physicalMutationPerformed = true;
      }

      // Determine exception classification and review status per Item L
      const finalExceptionClassification = isExceptionReview && effectiveDecision === 'ACCEPTED'
        ? 'ACCEPTED_EXCEPTION'
        : (effectiveDecision === 'REJECTED' ? 'REJECTED' : effectiveDecision);

      const finalManagerReviewStatus = isExceptionReview
        ? (effectiveDecision === 'ACCEPTED' ? 'APPROVED' : 'REJECTED')
        : session.manager_review_status;

      const newValues: Record<string, unknown> = {
        session_id: sessionId.toString(),
        requested_manager_decision: decision || effectiveDecision,
        effective_decision: effectiveDecision,
        exception_classification: finalExceptionClassification,
        review_status: finalManagerReviewStatus,
        reason: reasonTrimmed,
        actor: auth.actorUserId.toString(),
        timestamp: correctionTimestamp.toISOString(),
        physical_mutation_performed: physicalMutationPerformed,
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
        is_mpd_head: auth.isMpdHead,
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      };

      const updated = await tx.zmccLabSession.update({
        where: { id: sessionId },
        data: {
          decision: effectiveDecision,
          final_decision: effectiveDecision,
          final_decided_by_user_id: isExceptionReview ? auth.actorUserId : session.final_decided_by_user_id,
          final_decided_at: isExceptionReview ? correctionTimestamp : session.final_decided_at,
          final_decision_reason: isExceptionReview ? reasonTrimmed : session.final_decision_reason,
          system_quality_outcome: recomputedSystemQualityOutcome,
          manager_review_status: finalManagerReviewStatus,
          manager_reviewed_by_user_id: isExceptionReview ? auth.actorUserId : session.manager_reviewed_by_user_id,
          manager_reviewed_at: isExceptionReview ? correctionTimestamp : session.manager_reviewed_at,
          manager_review_reason: isExceptionReview ? reasonTrimmed : session.manager_review_reason,
          original_decision: session.original_decision ?? (isPendingReview ? null : session.decision),
          corrected_decision: finalExceptionClassification,
          correction_reason: reasonTrimmed,
          rejection_reason: effectiveRejectionReason,
          remarks: normalizedRemarks,
          quantity_value: effectiveQty !== null ? new Prisma.Decimal(effectiveQty.toFixed(2)) : null,
          quantity_unit: effectiveUnit as QuantityUnit,
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
          tank_receipt: {
            include: {
              tank: true,
              receiver: true,
            },
          },
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
          local_supplier_arrival: {
            include: {
              local_supplier: true,
            },
          },
          results: {
            orderBy: { display_order_snapshot: 'asc' },
          },
        },
      });

      const auditAction = isExceptionReview
        ? (effectiveDecision === 'ACCEPTED' ? 'ZMCC_MANAGER_EXCEPTION_APPROVED' : 'ZMCC_MANAGER_EXCEPTION_REJECTED')
        : 'ZMCC_LAB_SESSION_CORRECTED';

      await writeAuditLog(tx, {
        tableName: 'zmcc_lab_session',
        recordId: sessionId,
        action: auditAction,
        oldValues: toJsonInput(oldValues),
        newValues: toJsonInput(newValues),
        actor: { userId: auth.actorUserId, actorRole: auth.role },
      });

      return updated;
    });

    return {
      status: 200,
      data: serializeLabSession(correctedSession),
    };
  } catch (err) {
    if (getErrorMessage(err) && getErrorMessage(err).startsWith('RULE_CONFIGURATION_ERROR:')) {
      return { status: 422, error: getErrorMessage(err).replace('RULE_CONFIGURATION_ERROR:', '') };
    }
    if (getErrorMessage(err) && getErrorMessage(err).startsWith('NO_ACTIVE_RULE:')) {
      return { status: 422, error: getErrorMessage(err).replace('NO_ACTIVE_RULE:', '') };
    }
    if (getErrorMessage(err) && getErrorMessage(err).startsWith('NO_ACTIVE_TANK:')) {
      return { status: 400, error: getErrorMessage(err).replace('NO_ACTIVE_TANK:', '') };
    }
    if (getErrorMessage(err) && getErrorMessage(err).startsWith('MULTIPLE_ACTIVE_TANKS:')) {
      return { status: 400, error: getErrorMessage(err).replace('MULTIPLE_ACTIVE_TANKS:', '') };
    }
    if (getErrorMessage(err) && getErrorMessage(err).startsWith('MISSING_CORE_TESTS:')) {
      return { status: 400, error: getErrorMessage(err).replace('MISSING_CORE_TESTS:', '') };
    }
    if (getErrorMessage(err) && getErrorMessage(err).startsWith('INSUFFICIENT_CAPACITY:')) {
      const msg = getErrorMessage(err).replace('INSUFFICIENT_CAPACITY:', '');
      return { status: 400, error: msg };
    }
    if (getErrorMessage(err) && getErrorMessage(err).startsWith('NEGATIVE_STOCK:')) {
      return { status: 400, error: getErrorMessage(err) };
    }
    if (getErrorMessage(err) === 'MAX_CORRECTIONS_REACHED') {
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
): Promise<ServiceResult<unknown>> {
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
      { local_supplier_arrival: { zmcc_token: { contains: s, mode: 'insensitive' } } },
      { local_supplier_arrival: { vehicle_number: { contains: s, mode: 'insensitive' } } },
      { local_supplier_arrival: { rmr_number: { contains: s, mode: 'insensitive' } } },
      { local_supplier_arrival: { local_supplier: { name: { contains: s, mode: 'insensitive' } } } },
    ];
  }

  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 50));
  const skip = (page - 1) * pageSize;

  const [total, aggregate, items] = await Promise.all([
    prisma.zmccLabSession.count({ where }),
    prisma.zmccLabSession.aggregate({
      where,
      _sum: {
        gross_liters: true,
        at_13ts_liters: true,
      },
    }),
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
        local_supplier_arrival: {
          include: {
            local_supplier: true,
          },
        },
        tank_receipt: {
          include: {
            tank: true,
            receiver: true,
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
      summary: {
        totalGrossLiters:
          aggregate._sum.gross_liters != null
            ? Number(aggregate._sum.gross_liters)
            : null,
        totalAt13TsLiters:
          aggregate._sum.at_13ts_liters != null
            ? Number(aggregate._sum.at_13ts_liters)
            : null,
      },
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export const completeLabSession = completeSession;
export const correctLabSession = correctCompletedSession;

// ---------------------------------------------------------------------------------------------
// Phase 4b Stage 2: portions (composite = 1 portion, portion-wise = N portions) and per-portion decisions
// ---------------------------------------------------------------------------------------------

export interface LabPortionsState {
  sessionId: string;
  sessionStatus: string;
  arrivalType: string;
  testMode: LabTestMode;
  point: LabPoint;
  policy: LabPolicySnapshot;
  portions: LabPortionView[];
  canDecideNow: boolean;
  actorUserId: string;
  rollUp: ReturnType<typeof summarizePortions>;
  journeyClosed: boolean;
  closedReason: string | null;
}

function parseId(value: unknown): bigint | null {
  const s = String(value ?? '').trim();
  return /^\d{1,18}$/.test(s) ? BigInt(s) : null;
}

async function buildPortionsState(auth: ZmccLabAuthContext, sessionId: bigint): Promise<ServiceResult<LabPortionsState>> {
  let session = await prisma.zmccLabSession.findUnique({
    where: { id: sessionId },
    include: { portions: { orderBy: { portion_number: 'asc' } } },
  });
  if (!session) return { status: 404, error: 'ZMCC Lab session not found.' };
  if (auth.effectiveZmccId !== null && session.zmcc_id !== auth.effectiveZmccId) {
    return { status: 403, error: 'Forbidden. Lab session belongs to another ZMCC.' };
  }

  // Ensure Portion 1 exists for any in-progress session
  if (session.portions.length === 0 && session.status === 'IN_PROGRESS') {
    await prisma.zmccLabPortion.create({
      data: {
        lab_session_id: session.id,
        portion_number: 1,
        status: 'TESTING',
        final_decision: 'PENDING',
        created_by_user_id: auth.actorUserId,
        ...primaryActorFields(auth.acting),
      },
    });
    session = await prisma.zmccLabSession.findUnique({
      where: { id: sessionId },
      include: { portions: { orderBy: { portion_number: 'asc' } } },
    });
    if (!session) return { status: 404, error: 'ZMCC Lab session not found.' };
  }
  const point = labPointForArrival(session.arrival_type);
  const policy = await loadLabPolicy(point);
  const photos = await loadPortionPhotos(prisma, session.portions.map((p) => p.id));
  const portions = session.portions.map((p) => toPortionView(p, photos.get(p.id.toString()) ?? []));
  return {
    status: 200,
    data: {
      sessionId: session.id.toString(),
      sessionStatus: session.status,
      arrivalType: session.arrival_type,
      testMode: session.test_mode === 'PORTION_WISE' ? 'PORTION_WISE' : 'COMPOSITE',
      point,
      policy,
      portions,
      canDecideNow: auth.deciderCanApprove,
      actorUserId: auth.actorUserId.toString(),
      rollUp: summarizePortions(portions),
      journeyClosed: !!session.journey_closed_at,
      closedReason: session.closed_reason,
    },
  };
}

export async function getLabPortions(
  reqOrUser: Request | User,
  sessionIdParam: string | number | bigint
): Promise<ServiceResult<LabPortionsState>> {
  const { auth, errorResponse } = await resolveZmccLabAuth(reqOrUser, 'READ_LAB');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };
  const sessionId = parseId(sessionIdParam);
  if (sessionId === null) return { status: 400, error: 'Invalid session ID format.' };
  return buildPortionsState(auth, sessionId);
}

/** Adds a new virgin portion to an in-progress lab session. Upgrades COMPOSITE to PORTION_WISE if needed. */
export async function addLabPortion(
  reqOrUser: Request | User,
  sessionIdParam: string | number | bigint
): Promise<ServiceResult<LabPortionsState>> {
  const { auth, errorResponse } = await resolveZmccLabAuth(reqOrUser, 'SETUP_PORTIONS');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const sessionId = parseId(sessionIdParam);
  if (sessionId === null) return { status: 400, error: 'Invalid session ID format.' };

  try {
    await prisma.$transaction(async (tx) => {
      const locked: Array<{ id: bigint; status: string; zmcc_id: bigint; test_mode: string; unloaded_at: Date | null }> = await tx.$queryRaw`
        SELECT id, status, zmcc_id, test_mode, unloaded_at FROM zmcc_lab_session WHERE id = ${sessionId} FOR UPDATE
      `;
      if (locked.length === 0) throw new Error('SESSION_NOT_FOUND');
      const s = locked[0];
      if (auth.effectiveZmccId !== null && s.zmcc_id !== auth.effectiveZmccId) throw new Error('FORBIDDEN_SOURCE');

      // Ensure downstream operations have not yet commenced
      const [rmrIssued, tankReceiptIssued] = await Promise.all([
        tx.localSupplierRmrIssuance.findFirst({ where: { final_lab_session_id: sessionId }, select: { id: true } }),
        tx.zmccTankReceipt.findFirst({ where: { lab_session_id: sessionId }, select: { id: true } }),
      ]);
      if (rmrIssued || tankReceiptIssued || s.unloaded_at !== null) {
        throw new Error('DOWNSTREAM_ALREADY_COMMENCED');
      }

      // If session was COMPLETED, reopen it to IN_PROGRESS so new portion can be tested
      if (s.status === 'COMPLETED') {
        await tx.zmccLabSession.update({
          where: { id: sessionId },
          data: {
            status: 'IN_PROGRESS',
            completed_by_user_id: null,
            completed_at: null,
            decision: null,
            final_decision: null,
            final_decided_by_user_id: null,
            final_decided_at: null,
            final_decision_reason: null,
          },
        });
      }

      const existing = await tx.zmccLabPortion.findMany({
        where: { lab_session_id: sessionId },
        orderBy: { portion_number: 'asc' },
      });

      if (existing.length >= MAX_LAB_PORTIONS) {
        throw new Error('MAX_PORTIONS_REACHED');
      }

      const nextPortionNumber = existing.length + 1;

      // Create new portion in TESTING state
      const newPortion = await tx.zmccLabPortion.create({
        data: {
          lab_session_id: sessionId,
          portion_number: nextPortionNumber,
          status: 'TESTING',
          final_decision: 'PENDING',
          created_by_user_id: auth.actorUserId,
          ...primaryActorFields(auth.acting),
        },
      });

      // If session was composite, upgrade to PORTION_WISE
      const newMode = 'PORTION_WISE';
      if (s.test_mode !== newMode) {
        await tx.zmccLabSession.update({
          where: { id: sessionId },
          data: { test_mode: newMode },
        });
      }

      await writeAuditLog(tx, {
        tableName: 'zmcc_lab_session',
        recordId: sessionId,
        action: 'ZMCC_LAB_PORTION_ADDED',
        oldValues: { test_mode: s.test_mode, portion_count: existing.length },
        newValues: { test_mode: newMode, portion_count: nextPortionNumber, added_portion_id: newPortion.id.toString() },
        actor: auditActorOf(auth.acting),
      });
    });
  } catch (err) {
    const msg = getErrorMessage(err);
    const known: Record<string, [number, string]> = {
      SESSION_NOT_FOUND: [404, 'ZMCC Lab session not found.'],
      FORBIDDEN_SOURCE: [403, 'Forbidden. Lab session belongs to another ZMCC.'],
      SESSION_CLOSED: [409, 'This lab session is already finished.'],
      DOWNSTREAM_ALREADY_COMMENCED: [409, 'Cannot add portions: Downstream weighing, RMR or tank unloading has already commenced.'],
      RMR_ALREADY_ISSUED: [409, 'Cannot add portions: RMR receipt has already been issued for this session.'],
      MAX_PORTIONS_REACHED: [400, `Maximum limit of ${MAX_LAB_PORTIONS} portions reached.`],
    };
    if (known[msg]) return { status: known[msg][0], error: known[msg][1] };
    console.error('addLabPortion error:', err);
    return { status: 500, error: 'Failed to add portion.' };
  }

  return buildPortionsState(auth, sessionId);
}


export interface SetupPortionsPayload {
  test_mode: LabTestMode | string;
  portion_count?: number | string | null;
}

/** Chooses composite (1 portion) or portion-wise (N portions). Allowed only while no portion has a decision. */
export async function setupLabPortions(
  reqOrUser: Request | User,
  sessionIdParam: string | number | bigint,
  payload: SetupPortionsPayload
): Promise<ServiceResult<LabPortionsState>> {
  const { auth, errorResponse } = await resolveZmccLabAuth(reqOrUser, 'SETUP_PORTIONS');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };
  const sessionId = parseId(sessionIdParam);
  if (sessionId === null) return { status: 400, error: 'Invalid session ID format.' };

  const mode = String(payload?.test_mode ?? '').trim().toUpperCase();
  if (mode !== 'COMPOSITE' && mode !== 'PORTION_WISE') {
    return { status: 400, error: 'Choose Composite or Portion-wise.' };
  }
  const count = mode === 'COMPOSITE' ? 1 : Number(payload?.portion_count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_LAB_PORTIONS) {
    return { status: 400, error: `Number of portions must be 1 to ${MAX_LAB_PORTIONS}.` };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const locked: Array<{ id: bigint; status: string; zmcc_id: bigint; test_mode: string }> = await tx.$queryRaw`
        SELECT id, status, zmcc_id, test_mode FROM zmcc_lab_session WHERE id = ${sessionId} FOR UPDATE
      `;
      if (locked.length === 0) throw new Error('SESSION_NOT_FOUND');
      const s = locked[0];
      if (auth.effectiveZmccId !== null && s.zmcc_id !== auth.effectiveZmccId) throw new Error('FORBIDDEN_SOURCE');
      if (s.status !== 'IN_PROGRESS') throw new Error('SESSION_CLOSED');

      const existing = await tx.zmccLabPortion.findMany({ where: { lab_session_id: sessionId }, orderBy: { portion_number: 'asc' } });

      const keep = existing.filter((p) => p.portion_number <= count);
      const drop = existing.filter((p) => p.portion_number > count);

      // Allow dropping extra portions IF none of the dropped portions have decisions or lab results
      if (drop.length > 0) {
        const dropHasDecisions = drop.some((p) => p.person_decision !== null || p.final_decision !== 'PENDING');
        if (dropHasDecisions) throw new Error('CANNOT_DROP_DECIDED_PORTION');

        const dropIds = drop.map((p) => p.id);
        const dropResultsCount = await tx.zmccLabResult.count({
          where: { portion_id: { in: dropIds } },
        });
        if (dropResultsCount > 0) throw new Error('CANNOT_DROP_PORTION_WITH_RESULTS');

        await tx.zmccLabPortion.deleteMany({ where: { id: { in: dropIds } } });
      }

      const have = new Set(keep.map((p) => p.portion_number));
      for (let n = 1; n <= count; n++) {
        if (have.has(n)) continue;
        await tx.zmccLabPortion.create({
          data: {
            lab_session_id: sessionId,
            portion_number: n,
            status: 'TESTING',
            final_decision: 'PENDING',
            created_by_user_id: auth.actorUserId,
            ...primaryActorFields(auth.acting),
          },
        });
      }
      await tx.zmccLabSession.update({ where: { id: sessionId }, data: { test_mode: mode } });

      await writeAuditLog(tx, {
        tableName: 'zmcc_lab_session',
        recordId: sessionId,
        action: 'ZMCC_LAB_PORTIONS_SET',
        oldValues: { test_mode: s.test_mode, portions: existing.length },
        newValues: { test_mode: mode, portions: count, removed_portion_numbers: drop.map((p) => p.portion_number) },
        actor: auditActorOf(auth.acting),
      });

      // Roll up session: if all remaining portions are decided, finalize session to COMPLETED!
      await rollUpLabSessionTx(tx, sessionId, auth.acting);
    });
  } catch (err) {
    const msg = getErrorMessage(err);
    const known: Record<string, [number, string]> = {
      SESSION_NOT_FOUND: [404, 'ZMCC Lab session not found.'],
      FORBIDDEN_SOURCE: [403, 'Forbidden. Lab session belongs to another ZMCC.'],
      SESSION_CLOSED: [409, 'This lab session is already finished.'],
      ALREADY_DECIDED: [409, 'A portion already has a decision. Portions cannot be changed now.'],
      CANNOT_DROP_DECIDED_PORTION: [409, 'Cannot remove portions that already have decisions.'],
      CANNOT_DROP_PORTION_WITH_RESULTS: [409, 'Cannot remove portions that have recorded test measurements.'],
    };
    if (known[msg]) return { status: known[msg][0], error: known[msg][1] };
    console.error('setupLabPortions error:', err);
    return { status: 500, error: 'Failed to set up portions.' };
  }

  return buildPortionsState(auth, sessionId);
}

/** Discards a single untouched/empty portion from a lab session. */
export async function discardEmptyPortion(
  reqOrUser: Request | User,
  sessionIdParam: string | number | bigint,
  portionNumberParam: number | string
): Promise<ServiceResult<LabPortionsState>> {
  const { auth, errorResponse } = await resolveZmccLabAuth(reqOrUser, 'SETUP_PORTIONS');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };

  const sessionId = parseId(sessionIdParam);
  if (sessionId === null) return { status: 400, error: 'Invalid session ID format.' };

  const portionNumber = Number(portionNumberParam);
  if (!Number.isInteger(portionNumber) || portionNumber < 1) {
    return { status: 400, error: 'Invalid portion number.' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const locked: Array<{ id: bigint; status: string; zmcc_id: bigint; test_mode: string }> = await tx.$queryRaw`
        SELECT id, status, zmcc_id, test_mode FROM zmcc_lab_session WHERE id = ${sessionId} FOR UPDATE
      `;
      if (locked.length === 0) throw new Error('SESSION_NOT_FOUND');
      const s = locked[0];
      if (auth.effectiveZmccId !== null && s.zmcc_id !== auth.effectiveZmccId) throw new Error('FORBIDDEN_SOURCE');
      if (s.status !== 'IN_PROGRESS') throw new Error('SESSION_CLOSED');

      const existing = await tx.zmccLabPortion.findMany({
        where: { lab_session_id: sessionId },
        orderBy: { portion_number: 'asc' },
      });

      if (existing.length <= 1) {
        throw new Error('CANNOT_DELETE_LAST_PORTION');
      }

      const target = existing.find((p) => p.portion_number === portionNumber);
      if (!target) throw new Error('PORTION_NOT_FOUND');

      if (target.person_decision !== null || target.final_decision !== 'PENDING') {
        throw new Error('CANNOT_DROP_DECIDED_PORTION');
      }

      const resultCount = await tx.zmccLabResult.count({ where: { portion_id: target.id } });
      if (resultCount > 0) {
        throw new Error('CANNOT_DROP_PORTION_WITH_RESULTS');
      }

      // Delete target empty portion
      await tx.zmccLabPortion.delete({ where: { id: target.id } });

      // Renumber remaining portions
      const remaining = existing.filter((p) => p.id !== target.id);
      for (let i = 0; i < remaining.length; i++) {
        const correctNumber = i + 1;
        if (remaining[i].portion_number !== correctNumber) {
          await tx.zmccLabPortion.update({
            where: { id: remaining[i].id },
            data: { portion_number: correctNumber },
          });
        }
      }

      const newMode = remaining.length === 1 ? 'COMPOSITE' : 'PORTION_WISE';
      await tx.zmccLabSession.update({
        where: { id: sessionId },
        data: { test_mode: newMode },
      });

      await writeAuditLog(tx, {
        tableName: 'zmcc_lab_session',
        recordId: sessionId,
        action: 'ZMCC_LAB_PORTION_DISCARDED',
        oldValues: { test_mode: s.test_mode, portion_number: portionNumber },
        newValues: { test_mode: newMode, remaining_portions: remaining.length },
        actor: auditActorOf(auth.acting),
      });

      // Roll up session: if all remaining portions are decided, finalize session to COMPLETED!
      await rollUpLabSessionTx(tx, sessionId, auth.acting);
    });
  } catch (err) {
    const msg = getErrorMessage(err);
    const known: Record<string, [number, string]> = {
      SESSION_NOT_FOUND: [404, 'ZMCC Lab session not found.'],
      FORBIDDEN_SOURCE: [403, 'Forbidden. Lab session belongs to another ZMCC.'],
      SESSION_CLOSED: [409, 'This lab session is already finished.'],
      CANNOT_DELETE_LAST_PORTION: [400, 'Cannot discard the only portion of this session.'],
      PORTION_NOT_FOUND: [404, 'Portion not found in this session.'],
      CANNOT_DROP_DECIDED_PORTION: [409, 'This portion already has a decision and cannot be discarded.'],
      CANNOT_DROP_PORTION_WITH_RESULTS: [409, 'This portion contains lab test measurements and cannot be discarded.'],
    };
    if (known[msg]) return { status: known[msg][0], error: known[msg][1] };
    console.error('discardEmptyPortion error:', err);
    return { status: 500, error: 'Failed to discard empty portion.' };
  }

  return buildPortionsState(auth, sessionId);
}

export interface PortionDecisionPayload {
  version: number;
  person_decision: 'ACCEPT' | 'REJECT' | string;
  remarks?: string | null;
  quantity_value?: number | string | null;
  quantity_unit?: 'KG' | 'LITER' | string | null;
  tests: Array<{ lab_test_id: string; value?: number | string | null; text_value?: string | null }>;
}

/**
 * Saves the tests of one portion and the person's ACCEPT / REJECT, then applies the decision rule:
 * PROCEED / REJECT finish the portion; an exception goes to the Zonal Manager, or is decided now
 * when the person may approve it (Zonal Manager or above).
 */
export async function submitPortionDecision(
  reqOrUser: Request | User,
  sessionIdParam: string | number | bigint,
  portionIdParam: string | number | bigint,
  payload: PortionDecisionPayload
): Promise<ServiceResult<{ portion: LabPortionView; route: string; rollUp: LabSessionRollUp }>> {
  const { auth, errorResponse } = await resolveZmccLabAuth(reqOrUser, 'DECIDE_PORTION');
  if (errorResponse) return errorResponse;
  if (!auth) return { status: 401, error: 'Unauthorized.' };
  const sessionId = parseId(sessionIdParam);
  const portionId = parseId(portionIdParam);
  if (sessionId === null || portionId === null) return { status: 400, error: 'Invalid session or portion ID.' };

  const personDecision = String(payload?.person_decision ?? '').toUpperCase();
  if (personDecision !== 'ACCEPT' && personDecision !== 'REJECT') return { status: 400, error: 'Choose Accept or Reject.' };
  const version = Number(payload?.version);
  if (!Number.isInteger(version)) return { status: 400, error: 'Version is required.' };
  if (!Array.isArray(payload?.tests)) return { status: 400, error: 'Test results are required.' };

  let quantity: number | null = null;
  let unit: 'KG' | 'LITER' | null = null;
  if (payload.quantity_value !== undefined && payload.quantity_value !== null && String(payload.quantity_value).trim() !== '') {
    quantity = Number(payload.quantity_value);
    if (!Number.isFinite(quantity) || quantity <= 0) return { status: 400, error: 'Quantity must be more than 0.' };
    const u = String(payload.quantity_unit ?? '').trim().toUpperCase();
    if (u !== 'KG' && u !== 'LITER') return { status: 400, error: 'Quantity unit must be KG or LITER.' };
    unit = u;
  }

  const portion = await prisma.zmccLabPortion.findUnique({
    where: { id: portionId },
    include: { lab_session: { select: { id: true, zmcc_id: true, status: true, arrival_type: true, local_supplier_arrival_id: true } } },
  });
  if (!portion || portion.lab_session_id !== sessionId) return { status: 404, error: 'Portion not found.' };
  if (auth.effectiveZmccId !== null && portion.lab_session.zmcc_id !== auth.effectiveZmccId) {
    return { status: 403, error: 'Forbidden. Lab session belongs to another ZMCC.' };
  }
  if (portion.lab_session.status !== 'IN_PROGRESS') return { status: 409, error: 'This lab session is already finished.' };
  if (portion.status !== 'TESTING' || portion.final_decision !== 'PENDING' || portion.review_status === 'PENDING') {
    return { status: 409, error: 'This portion already has a decision. Reload.' };
  }
  if (portion.version !== version) return { status: 409, error: 'This portion was changed by someone else. Reload.' };

  const point = labPointForArrival(portion.lab_session.arrival_type);
  const policy = await loadLabPolicy(point);
  const allowedTests = new Set(policy.tests.map((t) => t.labTestId));
  for (const t of payload.tests) {
    if (!t || !allowedTests.has(String(t.lab_test_id))) return { status: 400, error: 'A test does not belong to this lab point.' };
    const pt = policy.tests.find((x) => x.labTestId === String(t.lab_test_id))!;
    if (pt.resultType === 'NUMERIC' && t.value !== undefined && t.value !== null && String(t.value).trim() !== '') {
      const n = Number(t.value);
      if (!Number.isFinite(n) || n < 0) return { status: 400, error: `${pt.testName}: enter a number of 0 or more.` };
    }
    const text = (t.text_value ?? '').trim();
    if (pt.resultType !== 'NUMERIC' && text && pt.options && !pt.options.some((o) => o.toUpperCase() === text.toUpperCase())) {
      return { status: 400, error: `${pt.testName}: choose one of the options.` };
    }
  }

  // Server-side photo enforcement: only photos saved for this portion count.
  const photoMap = await loadPortionPhotos(prisma, [portionId]);
  const savedPhotos = (photoMap.get(portionId.toString()) ?? []).map((p) => ({
    labTestId: p.lab_test_id?.toString() ?? null,
    captureId: p.capture_id,
  }));

  const remarks = (payload.remarks ?? '').trim();
  const { decision, details } = buildLabPortionDecision(policy, {
    tests: payload.tests.map((t) => ({
      labTestId: String(t.lab_test_id),
      value: t.value === undefined || t.value === null || String(t.value).trim() === '' ? null : Number(t.value),
      textValue: t.text_value ?? null,
    })),
    photos: savedPhotos,
    personDecision: personDecision as PersonDecision,
    remarks,
    deciderCanApprove: auth.deciderCanApprove,
  });
  if (!decision.remarksOk) return { status: 400, error: 'Please write remarks (at least 3 letters).' };

  let metrics: ReturnType<typeof computeCanonicalMilkMetrics> | null = null;
  if (quantity !== null && unit !== null && details.lr !== null && details.fat !== null) {
    try {
      metrics = computeCanonicalMilkMetrics(quantity, unit, details.lr, details.fat);
    } catch (err) {
      return { status: 400, error: getErrorMessage(err) || 'Could not calculate litres from these values.' };
    }
  }

  const now = new Date();
  const portionStatus = decision.finalDecision === 'PENDING' ? 'PENDING_REVIEW' : decision.finalDecision;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const upd = await tx.zmccLabPortion.updateMany({
        where: { id: portionId, version, status: 'TESTING', final_decision: 'PENDING' },
        data: {
          status: portionStatus,
          system_outcome: decision.systemOutcome,
          person_decision: personDecision,
          decision_remarks: remarks || null,
          exception_reasons: toJsonInput(decision.exceptionReasons),
          review_status: decision.reviewStatus,
          final_decision: decision.finalDecision,
          decision_details: toJsonInput(details),
          decided_at: now,
          created_by_user_id: auth.actorUserId,
          ...primaryActorFields(auth.acting),
          lr: details.lr !== null ? new Prisma.Decimal(details.lr.toFixed(2)) : null,
          fat: details.fat !== null ? new Prisma.Decimal(details.fat.toFixed(2)) : null,
          quantity_value: quantity !== null ? new Prisma.Decimal(quantity.toFixed(2)) : null,
          quantity_unit: unit as QuantityUnit | null,
          density: metrics ? new Prisma.Decimal(metrics.density.toFixed(4)) : null,
          gross_liters: metrics ? new Prisma.Decimal(metrics.grossLiters.toFixed(2)) : null,
          snf: metrics ? new Prisma.Decimal(metrics.snf.toFixed(2)) : null,
          ts: metrics ? new Prisma.Decimal(metrics.ts.toFixed(2)) : null,
          at_13ts_liters: metrics ? new Prisma.Decimal(metrics.at13tsLiters.toFixed(2)) : null,
          calculation_version: metrics ? metrics.calculationVersion : null,
          // DECIDE_NOW: the superior's own exception is decided on the same screen.
          ...(decision.route === 'DECIDE_NOW'
            ? {
                reviewed_by_user_id: auth.actorUserId,
                reviewed_at: now,
                review_remarks: remarks || null,
                ...asRoleFields(auth.acting, 'reviewed'),
              }
            : {}),
          version: { increment: 1 },
        },
      });
      if (upd.count !== 1) throw new Error('VERSION_CONFLICT');

      await writeAuditLog(tx, {
        tableName: 'zmcc_lab_portion',
        recordId: portionId,
        action: decision.route === 'SEND_TO_APPROVER' ? 'ZMCC_LAB_PORTION_SENT_TO_ZM' : 'ZMCC_LAB_PORTION_DECIDED',
        oldValues: { status: portion.status, final_decision: portion.final_decision, version: portion.version },
        newValues: {
          lab_session_id: sessionId.toString(),
          portion_number: portion.portion_number,
          point,
          policy_version: policy.version,
          route: decision.route,
          system_outcome: decision.systemOutcome,
          person_decision: personDecision,
          exception_reasons: decision.exceptionReasons,
          review_status: decision.reviewStatus,
          final_decision: decision.finalDecision,
          remarks: remarks || null,
          lr: details.lr,
          fat: details.fat,
          gross_liters: metrics?.grossLiters ?? null,
          photos: savedPhotos.map((p) => p.captureId),
        },
        actor: auditActorOf(auth.acting),
      });

      if (decision.route === 'SEND_TO_APPROVER') {
        await createNotificationsForEvent(tx, {
          eventKey: 'ZMCC_LAB_EXCEPTION_PENDING',
          sourceId: portionId.toString(),
          sourceZmccId: portion.lab_session.zmcc_id,
          title: 'Lab portion needs your decision',
          body: `Portion ${portion.portion_number} (session #${sessionId}): ${decision.exceptionReasons.join(', ')}. Lab said ${personDecision === 'ACCEPT' ? 'accept' : 'reject'}.${remarks ? ` Reason: ${remarks}` : ''}`,
          deepLink: '/mpd/zmcc-manager?tab=APPROVALS&view=LAB_EXCEPTIONS',
          dedupeSuffix: `portion:${portionId}:v${version}`,
        });
      } else if (details.warnings && details.warnings.length > 0) {
        // Warning tolerance: Non-blocking advisory notification to ZMCC Manager and Head of MPD
        await createNotificationsForEvent(tx, {
          eventKey: 'ZMCC_LAB_WARNING_LOGGED',
          sourceId: portionId.toString(),
          sourceZmccId: portion.lab_session.zmcc_id,
          title: `Lab warning accepted: Portion ${portion.portion_number}`,
          body: `Session #${sessionId} portion ${portion.portion_number}: ${details.warnings.join('; ')}. Accepted by ${auth.acting.actingAs || auth.acting.actorRole}.${remarks ? ` Remarks: ${remarks}` : ''}`,
          deepLink: '/zmcc/lab?tab=history',
          dedupeSuffix: `portion-warning:${portionId}:v${version}`,
        });
      }

      if (decision.finalDecision === 'REJECTED') {
        // MPD Head adds remarks on rejected milk (queue + notification).
        await recordRejectedMilkForDisposition(tx, {
          portionId,
          zmccId: portion.lab_session.zmcc_id,
          summary: `session #${sessionId} portion ${portion.portion_number}${metrics ? ` / ${metrics.grossLiters.toFixed(0)} L` : ''}`,
          actor: auditActorOf(auth.acting),
        });
      }
      const rollUp = await rollUpLabSessionTx(tx, sessionId, auth.acting);
      const fresh = await tx.zmccLabPortion.findUniqueOrThrow({ where: { id: portionId } });
      return { portion: toPortionView(fresh, photoMap.get(portionId.toString()) ?? []), route: decision.route, rollUp };
    });
    // Decided: nobody's draft for this portion is needed any more. Best effort, never affects the result.
    await clearDraftsForPortion(prisma as unknown as DraftDb, labPointForArrival(portion.lab_session.arrival_type), sessionId, portionId.toString()).catch(() => 0);
    return { status: 200, data: result };
  } catch (err) {
    if (getErrorMessage(err) === 'VERSION_CONFLICT') return { status: 409, error: 'This portion was changed by someone else. Reload.' };
    console.error('submitPortionDecision error:', err);
    return { status: 500, error: 'Failed to save the portion decision.' };
  }
}
