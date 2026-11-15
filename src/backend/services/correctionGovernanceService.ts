import { clearHandledNotifications, createNotificationsForEvent } from '@/backend/services/notificationService';
import type { NotificationEventKey } from '@/backend/modules/notifications/eventCatalog';
import { prisma } from '@/backend/core/db';
import { auditActorFromUser, writeAuditLog } from '@/backend/core/audit';
import { isCorrectionAuthority } from '@/backend/core/roles/capabilities';
import { canActAs, getDescendantRoles, getParentRole } from '@/backend/core/roles/hierarchy';
import { User } from '@/backend/core/types';
import { Prisma } from '@prisma/client';
import { toJsonInput } from '@/lib/json';
import { correctCompletedSession } from '@/backend/services/zmccLabService';
import { correctLabPortion } from '@/backend/services/zmcc/labPortionCorrectionService';
import { correctDispatchVisit, type CorrectionResponse } from '@/backend/services/corrections/dispatchCorrection';
import { correctPlantQaResults } from '@/backend/services/corrections/plantQaCorrection';
import { correctPlantReception } from '@/backend/services/corrections/plantReceptionCorrection';
import { correctShopCollection } from '@/backend/services/mot/motCore';
import { correctMotArrival, correctLocalSupplierArrival } from '@/backend/services/zmccArrivalService';

/**
 * Ticket modules. Lower roles raise a ticket (record, wrong value, proposed value, reason);
 * only DATA_EXECUTIVE / SUPER_ADMIN resolve it. DB statuses: MANAGER_PENDING = With manager, REQUESTED = Open,
 * APPROVED, REJECTED, APPLIED = Done.
 *
 * A ticket first goes to the role directly above the person who raised it (their manager). Once the manager
 * approves, it is Open for the Data Executive and Super Admin, who make the change. When the role directly
 * above is the Data Executive or Super Admin, there is no manager step.
 */
export const MANAGER_PENDING_STATUS = 'MANAGER_PENDING';

/** The role that must approve a ticket before the Data Executive sees it, or null when there is no manager step. */
export function managerRoleFor(requesterRole: string | null | undefined): string | null {
  if (!requesterRole) return null;
  const parent = getParentRole(requesterRole);
  return parent && !isCorrectionAuthority(parent) ? parent : null;
}
const MANAGER_WAIT_EVENTS: Record<string, NotificationEventKey> = {
  ZMCC_MANAGER: 'CORRECTION_WITH_ZMCC_MANAGER',
  CONTRACTOR_MANAGER: 'CORRECTION_WITH_CONTRACTOR_MANAGER',
  ADMIN_HEAD: 'CORRECTION_WITH_ADMIN_HEAD',
  PRODUCTION_HEAD: 'CORRECTION_WITH_PRODUCTION_HEAD',
  QA_HEAD: 'CORRECTION_WITH_QA_HEAD',
  HEAD_OF_MPD: 'CORRECTION_WITH_HEAD_OF_MPD',
};
const MANAGER_WAIT_EVENT_KEYS = Object.values(MANAGER_WAIT_EVENTS);

const MODULE_LABELS: Record<string, string> = {
  ZMCC_LAB_SESSION: 'lab test',
  MOT_SHOP_COLLECTION: 'shop collection',
  ZMCC_MC_ARRIVAL: 'MC arrival',
  ZMCC_HC_ARRIVAL: 'HC arrival',
  ZMCC_WEIGHING: 'weighing',
  ZMCC_EXIT: 'exit',
  VEHICLE_VISIT: 'vehicle visit',
  PLANT_QA_MEASUREMENT: 'plant QA test',
};

/** A failed bell notification must never fail the ticket action. */
async function safeNotify(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (err) {
    console.error('Correction request notification failed:', err);
  }
}

async function notifyManagerWaiting(req: { id: bigint; module: string; source_id: bigint | null }, managerRole: string, requesterName: string) {
  const eventKey = MANAGER_WAIT_EVENTS[managerRole];
  if (!eventKey) return;
  await createNotificationsForEvent(prisma, {
    eventKey,
    sourceId: req.id.toString(),
    // Only ZMCC and contractor managers are bound to one source; the other manager roles are global.
    sourceZmccId: managerRole === 'ZMCC_MANAGER' || managerRole === 'CONTRACTOR_MANAGER' ? req.source_id : null,
    title: 'Correction request waiting',
    body: `${requesterName} sent a correction request for a ${MODULE_LABELS[req.module] ?? 'record'}.`,
    deepLink: '/request-correction?tab=requests',
    dedupeSuffix: req.id.toString(),
  });
}

async function notifyCorrectionOpen(req: { id: bigint; module: string }, requesterName: string) {
  await createNotificationsForEvent(prisma, {
    eventKey: 'CORRECTION_OPEN',
    sourceId: req.id.toString(),
    title: 'Correction request open',
    body: `${requesterName} sent a correction request for a ${MODULE_LABELS[req.module] ?? 'record'}.`,
    deepLink: '/super-admin/corrections?tab=requests',
    dedupeSuffix: req.id.toString(),
  });
}

export const CORRECTION_TICKET_MODULES = [
  'ZMCC_LAB_SESSION',
  'MOT_SHOP_COLLECTION',
  'ZMCC_MC_ARRIVAL',
  'ZMCC_HC_ARRIVAL',
  'ZMCC_WEIGHING',
  'ZMCC_EXIT',
  'VEHICLE_VISIT',
  'PLANT_QA_MEASUREMENT',
] as const;

/** Modules whose "Apply" changes the record. The rest are fixed on the record by hand; Apply then only closes the ticket. */
export const AUTO_APPLY_MODULES: ReadonlySet<string> = new Set([
  'ZMCC_LAB_SESSION',
  'MOT_SHOP_COLLECTION',
  'ZMCC_MC_ARRIVAL',
  'ZMCC_HC_ARRIVAL',
  'VEHICLE_VISIT',
  'PLANT_QA_MEASUREMENT',
]);

const PLANT_RECEPTION_FIELDS = ['token_number', 'vehicle_number', 'gross_weight_kg', 'tare_weight_kg'];

/** A vehicle ticket's changes, split between the dispatch record and the plant reception. */
export function splitVisitTicketChanges(changes: Record<string, unknown>) {
  const dispatch: Record<string, unknown> = {};
  const plant: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (PLANT_RECEPTION_FIELDS.includes(key)) plant[key] = value;
    else if (key === 'raw_milk_dispatch_note_number' || key.startsWith('vehicle_dispatch_')) dispatch[key] = value;
  }
  return { dispatch, plant };
}

/** The message from a failed correction, as an error, so the ticket stays open. */
function assertCorrected(res: CorrectionResponse, label: string) {
  if (res.status < 400) return;
  throw new Error(`${label}: ${res.body?.message || res.body?.error || 'The correction was refused.'}`);
}

/** A lab ticket's changes, split by where they are corrected. Keys: portion:<id>:lr|fat|net_weight_kg, result_<testId>. */
export function splitLabTicketChanges(changes: Record<string, unknown>) {
  type ResultChange = { test_id: string; numeric_value?: number | null; text_value?: string | null };
  const toResult = (testId: string, raw: unknown): ResultChange => {
    const n = Number(raw);
    return typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(n))
      ? { test_id: testId, numeric_value: n }
      : { test_id: testId, text_value: raw === null || raw === undefined ? null : String(raw) };
  };
  const portions = new Map<string, { lr?: number; fat?: number; net_weight_kg?: number; first_weight_kg?: number; second_weight_kg?: number; results?: ResultChange[] }>();
  const results: ResultChange[] = [];
  for (const [key, raw] of Object.entries(changes)) {
    const pr = /^portion:(\d{1,18}):result_(\d{1,18})$/.exec(key);
    if (pr) {
      const current = portions.get(pr[1]);
      portions.set(pr[1], { ...current, results: [...(current?.results ?? []), toResult(pr[2], raw)] });
      continue;
    }
    const p = /^portion:(\d{1,18}):(lr|fat|net_weight_kg|first_weight_kg|second_weight_kg)$/.exec(key);
    if (p) {
      const n = Number(raw);
      if (raw === null || raw === '' || !Number.isFinite(n)) throw new Error(`${p[2]} for portion #${p[1]} is not a number.`);
      portions.set(p[1], { ...portions.get(p[1]), [p[2]]: n });
      continue;
    }
    const r = /^result_(\d{1,18})$/.exec(key);
    if (r) results.push(toResult(r[1], raw));
  }
  if (Array.isArray(changes.results)) results.push(...(changes.results as typeof results));
  return { portions, results };
}

export type CorrectionStatusLabel = 'With manager' | 'Open' | 'Approved' | 'Rejected' | 'Done';

export function correctionStatusLabel(status: string): CorrectionStatusLabel {
  switch (status) {
    case MANAGER_PENDING_STATUS:
      return 'With manager';
    case 'APPROVED':
      return 'Approved';
    case 'REJECTED':
    case 'CANCELLED':
      return 'Rejected';
    case 'APPLIED':
      return 'Done';
    default:
      return 'Open';
  }
}

export interface CreateCorrectionRequestInput {
  userId: bigint;
  actorRole?: string | null;
  module: string;
  recordId: string;
  sourceId?: bigint | null;
  reason: string;
  requestedChanges: Record<string, unknown>;
  /** What is recorded now (the wrong value), per field. Stored with the ticket for the resolver. */
  currentValues?: Record<string, unknown> | null;
  /** Readable name per field (e.g. "Portion 2 · LR"), shown to the person who resolves the ticket. */
  fieldLabels?: Record<string, string> | null;
  impact?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface SerializedCorrectionRequest {
  id: string;
  correlationId: string;
  module: string;
  recordId: string;
  sourceId: string | null;
  impact: string;
  status: string;
  statusLabel: CorrectionStatusLabel;
  /** The role that approves first (the manager of the person who raised it), or null when there is no manager step. */
  managerRole: string | null;
  /** The manager approval, once given. */
  managerApproval: { name: string; role: string; at: string; note: string | null } | null;
  reason: string;
  requestedChanges: Record<string, unknown>;
  currentValues: Record<string, unknown>;
  fieldLabels: Record<string, string>;
  /** True when "Apply" changes the record itself; false when the record is fixed by hand and the ticket only closes. */
  autoApply: boolean;
  requestedAt: string;
  requestedBy: {
    id: string;
    username: string;
    name: string;
  };
  reviewedAt: string | null;
  reviewReason: string | null;
  reviewedBy: {
    id: string;
    username: string;
    name: string;
  } | null;
}

export async function createCorrectionRequest(input: CreateCorrectionRequestInput) {
  const correlationId = `CORR-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
  const impact = input.impact || 'MEDIUM';
  const managerRole = managerRoleFor(input.actorRole);

  const req = await prisma.correctionRequest.create({
    data: {
      correlation_id: correlationId,
      module: input.module,
      record_id: input.recordId,
      source_id: input.sourceId ?? null,
      impact,
      status: managerRole ? MANAGER_PENDING_STATUS : 'REQUESTED',
      reason: input.reason.trim(),
      requested_changes: {
        ...input.requestedChanges,
        ...(input.currentValues && Object.keys(input.currentValues).length > 0 ? { __current: input.currentValues } : {}),
        ...(input.fieldLabels && Object.keys(input.fieldLabels).length > 0 ? { __labels: input.fieldLabels } : {}),
        ...(input.actorRole ? { __requesterRole: input.actorRole } : {}),
        ...(managerRole ? { __managerRole: managerRole } : {}),
      } as Prisma.InputJsonValue,
      requested_by_user_id: input.userId,
    },
    include: {
      requester: true,
    },
  });

  // Notify Data Executive & Super Admin
  try {
    await writeAuditLog(prisma, {
      tableName: 'correction_request',
      recordId: req.id,
      action: 'CORRECTION_REQUESTED',
      oldValues: null,
      newValues: toJsonInput({
        correlation_id: correlationId,
        module: input.module,
        record_id: input.recordId,
        reason: input.reason,
        changes: input.requestedChanges,
      }),
      actor: { userId: input.userId, actorRole: input.actorRole ?? null },
    });
  } catch (err) {
    console.error('AuditLog creation failed for correction request:', err);
  }

  const requesterName = req.requester.full_name || req.requester.username;
  await safeNotify(() => (managerRole ? notifyManagerWaiting(req, managerRole, requesterName) : notifyCorrectionOpen(req, requesterName)));

  return req;
}

function stripInternal(changes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(changes)) {
    if (!k.startsWith('__')) out[k] = v;
  }
  return out;
}

export async function listCorrectionRequests(filter: {
  status?: string;
  module?: string;
  sourceId?: bigint | null;
  /** Only tickets raised by this user (lower roles see their own tickets). */
  requestedByUserId?: bigint | null;
  /** Tickets waiting for this manager: raised by a role below them, in their own ZMCC or contractor when they have one. */
  awaitingManager?: { userId: bigint; role: string; sourceId?: bigint | null } | null;
  limit?: number;
}) {
  const where: Prisma.CorrectionRequestWhereInput = {};
  if (filter.status && filter.status !== 'ALL') {
    where.status = filter.status;
  }
  if (filter.module && filter.module !== 'ALL') {
    where.module = filter.module;
  }
  if (filter.sourceId) {
    where.source_id = filter.sourceId;
  }
  if (filter.requestedByUserId) {
    where.requested_by_user_id = filter.requestedByUserId;
  }
  if (filter.awaitingManager) {
    where.status = MANAGER_PENDING_STATUS;
    where.requested_by_user_id = { not: filter.awaitingManager.userId };
    where.requester = { role: { in: getDescendantRoles(filter.awaitingManager.role) } };
    if (filter.awaitingManager.sourceId) where.source_id = filter.awaitingManager.sourceId;
  }

  const items = await prisma.correctionRequest.findMany({
    where,
    include: {
      requester: true,
      reviewer: true,
    },
    orderBy: { requested_at: 'desc' },
    take: filter.limit ?? 100,
  });

  return items.map((item): SerializedCorrectionRequest => ({
    id: item.id.toString(),
    correlationId: item.correlation_id,
    module: item.module,
    recordId: item.record_id,
    sourceId: item.source_id ? item.source_id.toString() : null,
    impact: item.impact,
    status: item.status,
    statusLabel: correctionStatusLabel(item.status),
    managerRole: ((item.requested_changes as Record<string, unknown> | null)?.__managerRole as string) || null,
    managerApproval:
      ((item.requested_changes as Record<string, unknown> | null)?.__manager as SerializedCorrectionRequest['managerApproval']) || null,
    reason: item.reason,
    requestedChanges: stripInternal((item.requested_changes as Record<string, unknown>) || {}),
    currentValues: ((item.requested_changes as Record<string, unknown> | null)?.__current as Record<string, unknown>) || {},
    fieldLabels: ((item.requested_changes as Record<string, unknown> | null)?.__labels as Record<string, string>) || {},
    autoApply: AUTO_APPLY_MODULES.has(item.module),
    requestedAt: item.requested_at.toISOString(),
    requestedBy: {
      id: item.requester.id.toString(),
      username: item.requester.username,
      name: item.requester.full_name || item.requester.username,
    },
    reviewedAt: item.reviewed_at ? item.reviewed_at.toISOString() : null,
    reviewReason: item.review_reason,
    reviewedBy: item.reviewer
      ? {
          id: item.reviewer.id.toString(),
          username: item.reviewer.username,
          name: item.reviewer.full_name || item.reviewer.username,
        }
      : null,
  }));
}

/**
 * The manager step. Approve opens the ticket for the Data Executive and Super Admin; reject closes it.
 * Allowed for any role above the person who raised it, within the same ZMCC or contractor when the manager has one.
 */
export async function managerDecideCorrectionRequest(
  requestId: bigint,
  manager: User,
  decision: 'APPROVE' | 'REJECT',
  note: string
) {
  const req = await prisma.correctionRequest.findUnique({ where: { id: requestId }, include: { requester: true } });
  if (!req) throw new Error('Correction request not found.');
  if (req.status !== MANAGER_PENDING_STATUS) throw new Error('This request is no longer waiting for a manager.');

  const managerId = BigInt(manager.id);
  if (req.requested_by_user_id === managerId) throw new Error('Forbidden. You cannot approve your own request.');
  const requesterRole = req.requester.role;
  if (manager.role === requesterRole || !canActAs(manager.role, requesterRole)) {
    throw new Error('Forbidden. Only a manager above the person who raised this request can decide it.');
  }
  const managerSource = manager.procurement_source_id ? BigInt(manager.procurement_source_id) : null;
  if (managerSource && req.source_id && managerSource !== req.source_id) {
    throw new Error('Forbidden. This request belongs to another ZMCC or contractor.');
  }

  const now = new Date();
  const cleanNote = note.trim();
  const approve = decision === 'APPROVE';
  const changes = (req.requested_changes as Record<string, unknown>) || {};
  // Only a request still waiting is changed, so two managers deciding at once cannot both succeed.
  const done = await prisma.correctionRequest.updateMany({
    where: { id: requestId, status: MANAGER_PENDING_STATUS },
    data: approve
      ? {
          status: 'REQUESTED',
          requested_changes: {
            ...changes,
            __manager: { name: manager.name || manager.username, role: manager.role, at: now.toISOString(), note: cleanNote || null },
          } as Prisma.InputJsonValue,
        }
      : { status: 'REJECTED', reviewed_by_user_id: managerId, reviewed_at: now, review_reason: cleanNote },
  });
  if (done.count === 0) throw new Error('This request is no longer waiting for a manager.');

  await writeAuditLog(prisma, {
    tableName: 'correction_request',
    recordId: req.id,
    action: approve ? 'CORRECTION_REQUEST_MANAGER_APPROVED' : 'CORRECTION_REQUEST_MANAGER_REJECTED',
    oldValues: { status: req.status },
    newValues: { status: approve ? 'REQUESTED' : 'REJECTED', note: cleanNote || null },
    actor: auditActorFromUser(manager),
  });

  await safeNotify(() => clearHandledNotifications(prisma, MANAGER_WAIT_EVENT_KEYS, req.id));
  if (approve) {
    await safeNotify(() => notifyCorrectionOpen(req, req.requester.full_name || req.requester.username));
  }
  return { id: req.id, status: approve ? 'REQUESTED' : 'REJECTED' };
}

export async function rejectCorrectionRequest(
  requestId: bigint,
  reviewerUser: User,
  reviewReason: string
) {
  // Reviewing a correction is non-delegable: Data Executive and Super Admin only.
  if (!isCorrectionAuthority(reviewerUser.role)) {
    throw new Error('Forbidden. Only Data Executive or Super Admin may review correction requests.');
  }

  const req = await prisma.correctionRequest.findUnique({
    where: { id: requestId },
  });
  if (!req) {
    throw new Error('Correction request not found.');
  }
  if (req.status !== 'REQUESTED') {
    throw new Error(`Cannot reject correction request in status: ${req.status}`);
  }

  const reviewerId = BigInt(reviewerUser.id);
  await safeNotify(() => clearHandledNotifications(prisma, ['CORRECTION_ESCALATED', 'CORRECTION_OPEN'], requestId));
  const updated = await prisma.correctionRequest.update({
    where: { id: requestId },
    data: {
      status: 'REJECTED',
      reviewed_by_user_id: reviewerId,
      reviewed_at: new Date(),
      review_reason: reviewReason.trim(),
    },
    include: {
      requester: true,
      reviewer: true,
    },
  });

  await writeAuditLog(prisma, {
    tableName: 'correction_request',
    recordId: req.id,
    action: 'CORRECTION_REQUEST_REJECTED',
    oldValues: { status: req.status },
    newValues: { status: 'REJECTED', review_reason: reviewReason },
    actor: auditActorFromUser(reviewerUser),
  });

  return updated;
}

export async function approveCorrectionRequest(
  requestId: bigint,
  reviewerUser: User,
  note?: string | null
) {
  if (!isCorrectionAuthority(reviewerUser.role)) {
    throw new Error('Forbidden. Only Data Executive or Super Admin may review correction requests.');
  }
  const req = await prisma.correctionRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new Error('Correction request not found.');
  if (req.status !== 'REQUESTED') throw new Error(`Cannot approve correction request in status: ${req.status}`);

  await safeNotify(() => clearHandledNotifications(prisma, ['CORRECTION_ESCALATED', 'CORRECTION_OPEN'], requestId));
  const updated = await prisma.correctionRequest.update({
    where: { id: requestId },
    data: {
      status: 'APPROVED',
      reviewed_by_user_id: BigInt(reviewerUser.id),
      reviewed_at: new Date(),
      review_reason: note?.trim() || 'Approved. The correction will be made.',
    },
    include: { requester: true, reviewer: true },
  });
  await writeAuditLog(prisma, {
    tableName: 'correction_request',
    recordId: req.id,
    action: 'CORRECTION_REQUEST_APPROVED',
    oldValues: { status: req.status },
    newValues: { status: 'APPROVED', review_reason: note ?? null },
    actor: auditActorFromUser(reviewerUser),
  });
  return updated;
}

export async function applyCorrectionRequest(
  requestId: bigint,
  reviewerUser: User
) {
  // Applying a correction is non-delegable: Data Executive and Super Admin only.
  if (!isCorrectionAuthority(reviewerUser.role)) {
    throw new Error('Forbidden. Only Data Executive or Super Admin may apply corrections.');
  }

  const req = await prisma.correctionRequest.findUnique({
    where: { id: requestId },
  });
  if (!req) {
    throw new Error('Correction request not found.');
  }
  if (req.status !== 'REQUESTED' && req.status !== 'APPROVED') {
    throw new Error(`Cannot apply correction request in status: ${req.status}`);
  }

  const reviewerId = BigInt(reviewerUser.id);
  const changes = (req.requested_changes as Record<string, unknown>) || {};
  let applicationResult: unknown = null;

  const appliedReason = `Correction ticket ${req.correlation_id}: ${req.reason}`;

  // Execute module-specific application
  if (req.module === 'ZMCC_LAB_SESSION') {
    const { portions, results } = splitLabTicketChanges(changes);
    const applied: unknown[] = [];
    // Portion figures go through the portion correction, which keeps the tank ledger, receipt and loss in step.
    for (const [portionId, values] of portions) {
      const current = await prisma.zmccLabPortion.findUnique({ where: { id: BigInt(portionId) }, select: { version: true, lab_session_id: true } });
      if (!current || current.lab_session_id.toString() !== req.record_id) throw new Error(`Portion #${portionId} is not part of this lab session.`);
      const res = await correctLabPortion(reviewerUser, portionId, {
        reason: appliedReason,
        version: current.version,
        ...values,
        idempotency_key: `${req.correlation_id}:${portionId}`,
      });
      if ('error' in res) throw new Error(`Portion #${portionId}: ${res.error}`);
      applied.push(res.data);
    }
    const quantityValue = changes.quantity_value === undefined ? undefined : Number(changes.quantity_value);
    const sessionChange =
      results.length > 0 || quantityValue !== undefined || typeof changes.quantity_unit === 'string' || typeof changes.remarks === 'string';
    if (sessionChange) {
      const res = await correctCompletedSession(reviewerUser, req.record_id, {
        reason: appliedReason,
        quantity_value: quantityValue,
        quantity_unit: typeof changes.quantity_unit === 'string' ? (changes.quantity_unit as 'KG' | 'LITER') : undefined,
        decision: typeof changes.decision === 'string' ? (changes.decision as 'ACCEPTED' | 'REJECTED') : undefined,
        remarks: typeof changes.remarks === 'string' ? changes.remarks : undefined,
        results: results.length > 0 ? results : undefined,
      });
      if (res.error) throw new Error(`Lab correction failed: ${res.error}`);
      applied.push(res.data);
    }
    if (applied.length === 0) throw new Error('This ticket has no value the system can apply. Correct the record directly, then reject the ticket with a note.');
    applicationResult = applied;
  } else if (req.module === 'MOT_SHOP_COLLECTION') {
    const res = await correctShopCollection(reviewerUser, req.record_id, {
      reason: `Applied from Correction Request #${req.correlation_id}: ${req.reason}`,
      quantity_value: typeof changes.quantity_value === 'number' ? changes.quantity_value : undefined,
      quantity_unit: typeof changes.quantity_unit === 'string' ? (changes.quantity_unit as 'KG' | 'LITER') : undefined,
      lr: typeof changes.lr === 'number' ? changes.lr : undefined,
      fat: typeof changes.fat === 'number' ? changes.fat : undefined,
      shop_rmr_number: typeof changes.shop_rmr_number === 'string' ? changes.shop_rmr_number : undefined,
      results: splitLabTicketChanges(changes).results,
    });
    if (res.error) {
      throw new Error(`MOT collection correction failed: ${res.error}`);
    }
    applicationResult = res.data;
  }

  else if (req.module === 'ZMCC_MC_ARRIVAL') {
    const res = await correctMotArrival(reviewerUser, req.record_id, {
      reason: `Applied from Correction Request #${req.correlation_id}: ${req.reason}`,
      raw_milk_token_number: typeof changes.raw_milk_token_number === 'string' ? changes.raw_milk_token_number : undefined,
      arrival_timestamp: typeof changes.arrival_timestamp === 'string' ? changes.arrival_timestamp : undefined,
    });
    if (res.error) {
      throw new Error(`MC arrival correction failed: ${res.error}`);
    }
    applicationResult = res.data;
  } else if (req.module === 'ZMCC_HC_ARRIVAL') {
    const res = await correctLocalSupplierArrival(reviewerUser, req.record_id, {
      reason: `Applied from Correction Request #${req.correlation_id}: ${req.reason}`,
      raw_milk_token_number: typeof changes.raw_milk_token_number === 'string' ? changes.raw_milk_token_number : undefined,
      rmr_number: typeof changes.rmr_number === 'string' ? changes.rmr_number : undefined,
      vehicle_number: typeof changes.vehicle_number === 'string' ? changes.vehicle_number : undefined,
      arrival_timestamp: typeof changes.arrival_timestamp === 'string' ? changes.arrival_timestamp : undefined,
    });
    if (res.error) {
      throw new Error(`HC arrival correction failed: ${res.error}`);
    }
    applicationResult = res.data;
  }
  else if (req.module === 'VEHICLE_VISIT') {
    const { dispatch, plant } = splitVisitTicketChanges(changes);
    const applied: unknown[] = [];
    if (Object.keys(dispatch).length > 0) {
      const res = await correctDispatchVisit(reviewerUser, req.record_id, { reason: appliedReason, idempotency_key: req.correlation_id, ...dispatch });
      assertCorrected(res, 'Dispatch correction failed');
      applied.push(res.body);
    }
    if (Object.keys(plant).length > 0) {
      const res = await correctPlantReception(reviewerUser, { recordId: req.record_id, reason: appliedReason, changes: plant });
      assertCorrected(res, 'Plant reception correction failed');
      applied.push(res.body);
    }
    if (applied.length === 0) throw new Error('This ticket has no value the system can apply. Reject it with a note.');
    applicationResult = applied;
  } else if (req.module === 'PLANT_QA_MEASUREMENT') {
    const { results } = splitLabTicketChanges(changes);
    if (results.length === 0) throw new Error('This ticket has no value the system can apply. Reject it with a note.');
    const portion = await prisma.visitPortion.findUnique({ where: { id: BigInt(req.record_id) }, select: { visit_id: true } });
    if (!portion) throw new Error('Plant portion not found.');
    const res = await correctPlantQaResults(reviewerUser, portion.visit_id.toString(), req.record_id, { reason: appliedReason, results });
    assertCorrected(res, 'Plant QA correction failed');
    applicationResult = res.body;
  }
  // ZMCC_WEIGHING, ZMCC_EXIT and the other modules are fixed by the Data Executive on the record itself;
  // applying the ticket then closes it as Done (MANUAL_APPLY in the audit trail).

  // Update request status to APPLIED
  const updated = await prisma.correctionRequest.update({
    where: { id: requestId },
    data: {
      status: 'APPLIED',
      reviewed_by_user_id: reviewerId,
      reviewed_at: new Date(),
      review_reason: applicationResult ? 'Approved and applied to the record.' : 'Closed. The record was corrected by hand.',
    },
    include: {
      requester: true,
      reviewer: true,
    },
  });

  await writeAuditLog(prisma, {
    tableName: 'correction_request',
    recordId: req.id,
    action: 'CORRECTION_REQUEST_APPLIED',
    oldValues: { status: req.status },
    newValues: { status: 'APPLIED', application_result: applicationResult ? 'SUCCESS' : 'MANUAL_APPLY' },
    actor: auditActorFromUser(reviewerUser),
  });

  await safeNotify(() => clearHandledNotifications(prisma, ['CORRECTION_ESCALATED', 'CORRECTION_OPEN'], requestId));

  return { request: updated, result: applicationResult };
}
