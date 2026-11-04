import { clearHandledNotifications } from '@/backend/services/notificationService';
import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { writeAuditLog } from '@/backend/core/audit';
import { assertResourceInScope } from '@/backend/core/acting-context';
import type { ActingContext } from '@/types/acting';
import { createNotificationsForEvent } from '@/backend/services/notificationService';
import {
  calculateTier1RouteLoss,
  computeAndStoreAreaLossTx,
} from '@/backend/services/lossCalculationService';
import { computeExitOutcome, isHcSession } from '@/backend/services/zmccTankService';

/**
 * HC gate exit (PHE Operator, last step) and "Close without unloading" (MC and HC):
 * PHE Operator requests, ZMCC Manager approves. MC has no gate exit.
 * Nothing returned here carries litres, 13 TS, LR, SNF or TS.
 */

export interface ExitServiceResult<T> {
  status: number;
  data?: T;
  error?: string;
  message?: string;
}

export const EXIT_REASON_CODES = [
  'LEFT_BEFORE_UNLOADING',
  'SENT_BACK',
  'TANK_FULL',
  'VEHICLE_PROBLEM',
  'OTHER',
] as const;
export type ExitReasonCode = (typeof EXIT_REASON_CODES)[number];

export const EXIT_REASON_LABELS: Record<ExitReasonCode, string> = {
  LEFT_BEFORE_UNLOADING: 'Left before unloading',
  SENT_BACK: 'Sent back',
  TANK_FULL: 'Tank full',
  VEHICLE_PROBLEM: 'Vehicle problem',
  OTHER: 'Other',
};

class ExitError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function fail(err: unknown, fallback: string, label: string): ExitServiceResult<never> {
  if (err instanceof ExitError) return { status: err.status, error: err.message, message: err.message };
  console.error(`${label} error:`, err);
  return { status: 500, error: fallback, message: fallback };
}

function parseId(value: string | number | bigint, label: string): bigint {
  try {
    return BigInt(String(value).trim());
  } catch {
    throw new ExitError(400, `Invalid ${label}.`);
  }
}

function lettersCount(value: string): number {
  return (value.match(/\p{L}/gu) ?? []).length;
}

function parseReason(codeRaw: unknown, remarksRaw: unknown): { code: ExitReasonCode; remarks: string } {
  const code = String(codeRaw ?? '').trim().toUpperCase();
  if (!(EXIT_REASON_CODES as readonly string[]).includes(code)) {
    throw new ExitError(400, 'Choose a reason.');
  }
  const remarks = String(remarksRaw ?? '').trim();
  if (lettersCount(remarks) < 3) throw new ExitError(400, 'Write remarks (at least 3 letters).');
  if (remarks.length > 1000) throw new ExitError(400, 'Remarks are too long.');
  return { code: code as ExitReasonCode, remarks };
}

const SESSION_INCLUDE = {
  portions: { orderBy: { portion_number: 'asc' } },
  mot_arrival: { include: { journey: { include: { mot_vehicle: true, route: true, summary: true } } } },
  local_supplier_arrival: { include: { local_supplier: true } },
} satisfies Prisma.ZmccLabSessionInclude;
type SessionFull = Prisma.ZmccLabSessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

function scopeCheck(acting: ActingContext, zmccId: bigint) {
  const check = assertResourceInScope(acting, { sourceId: zmccId, sourceType: 'ZMCC' });
  if (!check.ok) throw new ExitError(403, 'This vehicle belongs to another ZMCC.');
}

async function lockSession(tx: Prisma.TransactionClient, sessionId: bigint, acting: ActingContext): Promise<SessionFull> {
  await tx.$queryRaw`SELECT id FROM zmcc_lab_session WHERE id = ${sessionId} FOR UPDATE`;
  const s = await tx.zmccLabSession.findUnique({ where: { id: sessionId }, include: SESSION_INCLUDE });
  if (!s) throw new ExitError(404, 'Vehicle not found.');
  scopeCheck(acting, s.zmcc_id);
  return s;
}

function labDecided(s: SessionFull): boolean {
  return (
    s.portions.length > 0 &&
    s.portions.every((p) => ['ACCEPTED', 'REJECTED'].includes(p.final_decision) && p.review_status !== 'PENDING')
  );
}

function vehicleOf(s: SessionFull): string {
  return (
    s.mot_arrival?.journey?.mot_vehicle?.vehicle_number ?? s.local_supplier_arrival?.vehicle_number ?? `#${s.id}`
  );
}

// ----------------------------------------------------------------------------
// HC gate exit
// ----------------------------------------------------------------------------

export interface RecordHcExitPayload {
  exit_timestamp?: string | Date | null;
  client_event_id?: string | null;
  exit_client_event_id?: string | null;
  exit_reason_code?: string | null;
  exit_remarks?: string | null;
}

export type ExitResultView = {
  arrival_id: string;
  session_id: string;
  exit_timestamp: string;
  exit_outcome: string;
  exit_reason_code: string | null;
  exit_remarks: string | null;
  is_replay?: boolean;
};

/** Records the gate exit of an HC vehicle. The outcome is computed, never typed. */
export async function recordHcGateExit(
  acting: ActingContext,
  arrivalIdParam: string | number | bigint,
  payload: RecordHcExitPayload
): Promise<ExitServiceResult<ExitResultView>> {
  try {
    const arrivalId = parseId(arrivalIdParam, 'arrival id');
    const eventRaw = payload?.client_event_id || payload?.exit_client_event_id;
    const clientEventId = typeof eventRaw === 'string' && eventRaw.trim() ? eventRaw.trim() : null;
    const exitDate = payload?.exit_timestamp ? new Date(payload.exit_timestamp) : new Date();
    if (isNaN(exitDate.getTime())) throw new ExitError(400, 'Invalid exit time.');
    if (exitDate.getTime() > Date.now() + 5 * 60 * 1000) throw new ExitError(400, 'The exit time cannot be in the future.');

    const data = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM zmcc_local_supplier_arrival WHERE id = ${arrivalId} FOR UPDATE`;
      const arrival = await tx.zmccLocalSupplierArrival.findUnique({ where: { id: arrivalId } });
      if (!arrival) throw new ExitError(404, 'HC arrival not found.');
      scopeCheck(acting, arrival.zmcc_id);
      const session = await tx.zmccLabSession.findUnique({
        where: { local_supplier_arrival_id: arrivalId },
        include: SESSION_INCLUDE,
      });
      if (!session) throw new ExitError(409, 'The lab has not started for this vehicle yet.');
      await tx.$queryRaw`SELECT id FROM zmcc_lab_session WHERE id = ${session.id} FOR UPDATE`;

      if (arrival.gate_exit_required !== true) {
        throw new ExitError(409, 'Gate exit is not tracked for this older arrival.');
      }
      if (arrival.exit_timestamp) {
        if (clientEventId && arrival.exit_client_event_id === clientEventId) {
          return {
            arrival_id: arrivalId.toString(),
            session_id: session.id.toString(),
            exit_timestamp: arrival.exit_timestamp.toISOString(),
            exit_outcome: session.exit_outcome ?? computeExitOutcome(session.portions),
            exit_reason_code: session.exit_reason_code,
            exit_remarks: session.exit_remarks,
            is_replay: true,
          } satisfies ExitResultView;
        }
        throw new ExitError(409, 'The exit is already recorded for this vehicle.');
      }
      if (!labDecided(session)) {
        throw new ExitError(409, 'The lab has not finished all portions yet. The vehicle cannot leave.');
      }
      if (exitDate.getTime() < arrival.arrival_timestamp.getTime()) {
        throw new ExitError(400, 'The exit time cannot be before the arrival time.');
      }

      const outcome = computeExitOutcome(session.portions);
      const missing = outcome === 'PARTLY_RECEIVED' || outcome === 'ACCEPTED_NOT_RECEIVED';
      let reasonCode: string | null = null;
      let remarks: string | null = null;
      if (missing) {
        if (session.closed_reason === 'CLOSED_WITHOUT_UNLOADING' && session.exit_reason_code) {
          // The manager already approved closing without unloading: reuse the approved reason.
          reasonCode = session.exit_reason_code;
          remarks = session.exit_remarks;
        } else {
          const r = parseReason(payload?.exit_reason_code, payload?.exit_remarks);
          reasonCode = r.code;
          remarks = r.remarks;
        }
      } else {
        const optional = String(payload?.exit_remarks ?? '').trim();
        remarks = optional ? optional.slice(0, 1000) : null;
      }

      const now = new Date();
      await tx.zmccLocalSupplierArrival.update({
        where: { id: arrivalId },
        data: {
          exit_timestamp: exitDate,
          exit_recorded_by_user_id: acting.userId,
          exit_client_event_id: clientEventId,
          exit_submitted_at: now,
        },
      });
      await tx.zmccLabSession.update({
        where: { id: session.id },
        data: { exit_outcome: outcome, exit_reason_code: reasonCode, exit_remarks: remarks },
      });
      await writeAuditLog(tx, {
        tableName: 'zmcc_local_supplier_arrival',
        recordId: arrivalId,
        action: 'ZMCC_HC_GATE_EXIT_RECORDED',
        oldValues: { exit_timestamp: null },
        newValues: {
          exit_timestamp: exitDate.toISOString(),
          exit_outcome: outcome,
          exit_reason_code: reasonCode,
          exit_remarks: remarks,
          lab_session_id: session.id.toString(),
        },
        actor: acting,
      });

      if (missing) {
        await createNotificationsForEvent(tx, {
          eventKey: 'ZMCC_EXIT_WITHOUT_UNLOADING',
          sourceId: session.id.toString(),
          sourceZmccId: session.zmcc_id,
          title: 'Vehicle left without full unloading',
          body: `${vehicleOf(session)} left (${EXIT_REASON_LABELS[reasonCode as ExitReasonCode] ?? reasonCode}).`,
          deepLink: '/zmcc',
          dedupeSuffix: `exit:${session.id}`,
        });
      }

      return {
        arrival_id: arrivalId.toString(),
        session_id: session.id.toString(),
        exit_timestamp: exitDate.toISOString(),
        exit_outcome: outcome,
        exit_reason_code: reasonCode,
        exit_remarks: remarks,
      } satisfies ExitResultView;
    });
    return { status: 200, data };
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') {
      return { status: 409, error: 'This exit event was already used.', message: 'This exit event was already used.' };
    }
    return fail(err, 'Could not record the exit.', 'recordHcGateExit');
  }
}

// ----------------------------------------------------------------------------
// Close without unloading (MC and HC)
// ----------------------------------------------------------------------------

function canRequestClose(s: SessionFull): string | null {
  if (s.unloaded_at) return 'This vehicle is already unloaded.';
  if (s.journey_closed_at || s.closed_reason) return 'This vehicle visit is already closed.';
  if (!labDecided(s)) return 'The lab has not finished all portions yet.';
  if (!s.portions.some((p) => p.final_decision === 'ACCEPTED')) return 'There is no accepted milk. Nothing to close.';
  if (s.close_requested_at && !s.close_approved_at) return 'A close request is already waiting for the manager.';
  return null;
}

export async function requestCloseWithoutUnloading(
  acting: ActingContext,
  sessionIdParam: string | number | bigint,
  payload: { reason_code?: unknown; remarks?: unknown }
): Promise<ExitServiceResult<{ session_id: string; close_requested_at: string }>> {
  try {
    const sessionId = parseId(sessionIdParam, 'vehicle id');
    const reason = parseReason(payload?.reason_code, payload?.remarks);
    const data = await prisma.$transaction(async (tx) => {
      const s = await lockSession(tx, sessionId, acting);
      const blocked = canRequestClose(s);
      if (blocked) throw new ExitError(409, blocked);
      const now = new Date();
      await tx.zmccLabSession.update({
        where: { id: sessionId },
        data: {
          close_requested_by_user_id: acting.userId,
          close_requested_at: now,
          close_approved_by_user_id: null,
          close_approved_at: null,
          exit_reason_code: reason.code,
          exit_remarks: reason.remarks,
        },
      });
      await writeAuditLog(tx, {
        tableName: 'zmcc_lab_session',
        recordId: sessionId,
        action: 'ZMCC_CLOSE_WITHOUT_UNLOADING_REQUESTED',
        oldValues: null,
        newValues: { reason_code: reason.code, remarks: reason.remarks },
        actor: acting,
      });
      await createNotificationsForEvent(tx, {
        eventKey: 'ZMCC_CLOSE_REQUEST_PENDING',
        sourceId: sessionId.toString(),
        sourceZmccId: s.zmcc_id,
        title: 'Close without unloading: approval needed',
        body: `${vehicleOf(s)}: ${EXIT_REASON_LABELS[reason.code]}.`,
        deepLink: '/zmcc',
        dedupeSuffix: `close:${sessionId}:${now.getTime()}`,
      });
      return { session_id: sessionId.toString(), close_requested_at: now.toISOString() };
    });
    return { status: 200, data };
  } catch (err) {
    return fail(err, 'Could not send the request.', 'requestCloseWithoutUnloading');
  }
}

/** Area loss for a closed-without-unloading MC journey: received (unloaded) milk only. */
async function storeAreaLossForCloseTx(tx: Prisma.TransactionClient, s: SessionFull, acting: ActingContext) {
  const journey = s.mot_arrival?.journey;
  if (!journey) return;
  const stored = await computeAndStoreAreaLossTx(tx, { journeyId: journey.id, sessionId: s.id, actor: acting });
  if (stored || !journey.summary) return;
  // Nothing was received: store zero received so the whole declared quantity shows as loss.
  const declared = Number(journey.summary.total_gross_liters);
  const declared13 = Number(journey.summary.total_at_13ts_liters);
  const tier1 = calculateTier1RouteLoss({
    shopGrossLiters: declared,
    zmccArrivalGrossLiters: 0,
    shopAt13tsLiters: declared13,
    zmccArrivalAt13tsLiters: 0,
  });
  await tx.motJourney.update({
    where: { id: journey.id },
    data: {
      area_received_net_kg: new Prisma.Decimal(0),
      area_received_liters: new Prisma.Decimal(0),
      area_received_at_13ts_liters: new Prisma.Decimal(0),
      area_mot_declared_liters: new Prisma.Decimal(declared.toFixed(2)),
      area_mot_declared_at_13ts_liters: new Prisma.Decimal(declared13.toFixed(2)),
      area_loss_gain_liters: new Prisma.Decimal(tier1.signedVarianceLiters.toFixed(2)),
      area_loss_gain_at_13ts_liters: new Prisma.Decimal(tier1.signedVarianceAt13tsLiters.toFixed(2)),
      area_loss_gain_pct: new Prisma.Decimal(declared > 0 ? ((tier1.signedVarianceLiters / declared) * 100).toFixed(4) : '0'),
      area_computed_at: new Date(),
    },
  });
}

/** ZMCC Manager decision on a pending close request. */
export async function decideCloseWithoutUnloading(
  acting: ActingContext,
  sessionIdParam: string | number | bigint,
  payload: { approve?: unknown; decision?: unknown; remarks?: unknown }
): Promise<ExitServiceResult<{ session_id: string; approved: boolean }>> {
  try {
    const sessionId = parseId(sessionIdParam, 'vehicle id');
    // Accepts { decision: 'APPROVE' | 'REJECT' } or { approve: boolean }.
    const decisionText = typeof payload?.decision === 'string' ? payload.decision.trim().toUpperCase() : '';
    let approve: boolean;
    if (decisionText === 'APPROVE' || decisionText === 'REJECT') approve = decisionText === 'APPROVE';
    else if (typeof payload?.approve === 'boolean') approve = payload.approve;
    else throw new ExitError(400, 'Choose approve or reject.');
    const decisionRemarks = String(payload?.remarks ?? '').trim().slice(0, 1000);
    if (!approve && lettersCount(decisionRemarks) < 3) {
      throw new ExitError(400, 'Write a short reason for rejecting (at least 3 letters).');
    }
    const data = await prisma.$transaction(async (tx) => {
      const s = await lockSession(tx, sessionId, acting);
      if (!s.close_requested_at || s.close_approved_at) throw new ExitError(409, 'There is no pending close request.');
      if (s.unloaded_at || s.journey_closed_at) throw new ExitError(409, 'This vehicle visit is already closed.');
      if (s.close_requested_by_user_id === acting.userId) {
        throw new ExitError(403, 'You cannot approve your own request.');
      }
      const now = new Date();
      if (!approve) {
        await tx.zmccLabSession.update({
          where: { id: sessionId },
          data: { close_requested_by_user_id: null, close_requested_at: null },
        });
        await writeAuditLog(tx, {
          tableName: 'zmcc_lab_session',
          recordId: sessionId,
          action: 'ZMCC_CLOSE_WITHOUT_UNLOADING_REJECTED',
          oldValues: { exit_reason_code: s.exit_reason_code, exit_remarks: s.exit_remarks },
          newValues: { remarks: decisionRemarks },
          actor: acting,
        });
        await clearHandledNotifications(tx, ['ZMCC_CLOSE_REQUEST_PENDING'], sessionId);
        return { session_id: sessionId.toString(), approved: false };
      }

      const outcome = computeExitOutcome(s.portions);
      await tx.zmccLabSession.update({
        where: { id: sessionId },
        data: {
          close_approved_by_user_id: acting.userId,
          close_approved_at: now,
          journey_closed_at: now,
          closed_reason: 'CLOSED_WITHOUT_UNLOADING',
          exit_outcome: outcome,
        },
      });
      await clearHandledNotifications(tx, ['ZMCC_CLOSE_REQUEST_PENDING'], sessionId);
      await writeAuditLog(tx, {
        tableName: 'zmcc_lab_session',
        recordId: sessionId,
        action: 'ZMCC_CLOSE_WITHOUT_UNLOADING_APPROVED',
        oldValues: null,
        newValues: {
          closed_reason: 'CLOSED_WITHOUT_UNLOADING',
          exit_outcome: outcome,
          exit_reason_code: s.exit_reason_code,
          exit_remarks: s.exit_remarks,
        },
        actor: acting,
      });
      if (!isHcSession(s.arrival_type)) await storeAreaLossForCloseTx(tx, s, acting);
      return { session_id: sessionId.toString(), approved: true };
    });
    return { status: 200, data };
  } catch (err) {
    return fail(err, 'Could not save the decision.', 'decideCloseWithoutUnloading');
  }
}

// ----------------------------------------------------------------------------
// Lists (no litres / quality values)
// ----------------------------------------------------------------------------

export type ExitQueueItem = {
  session_id: string;
  zmcc_id: string;
  source_type: 'MC' | 'HC';
  vehicle_number: string | null;
  source_name: string | null;
  zmcc_token: string | null;
  /** HC arrival id used by the exit endpoint; null for MC. */
  hc_arrival_id: string | null;
  exit_outcome: string | null;
  /** Computed outcome if the vehicle leaves now. */
  preview_outcome: string;
  needs_reason: boolean;
  unloaded: boolean;
  can_exit: boolean;
  can_request_close: boolean;
  close_requested: boolean;
  close_reason_code: string | null;
  close_remarks: string | null;
  close_requested_at: string | null;
};

function toQueueItem(s: SessionFull): ExitQueueItem {
  const outcome = computeExitOutcome(s.portions);
  const hc = isHcSession(s.arrival_type);
  const decided = labDecided(s);
  const left = !!s.local_supplier_arrival?.exit_timestamp;
  return {
    session_id: s.id.toString(),
    zmcc_id: s.zmcc_id.toString(),
    source_type: hc ? 'HC' : 'MC',
    vehicle_number: s.mot_arrival?.journey?.mot_vehicle?.vehicle_number ?? s.local_supplier_arrival?.vehicle_number ?? null,
    source_name: s.mot_arrival?.journey?.route?.route_code ?? s.local_supplier_arrival?.local_supplier?.name ?? null,
    zmcc_token: s.mot_arrival?.zmcc_token ?? s.local_supplier_arrival?.zmcc_token ?? null,
    hc_arrival_id: hc && s.local_supplier_arrival_id ? s.local_supplier_arrival_id.toString() : null,
    exit_outcome: s.exit_outcome,
    preview_outcome: outcome,
    needs_reason:
      (outcome === 'PARTLY_RECEIVED' || outcome === 'ACCEPTED_NOT_RECEIVED') &&
      s.closed_reason !== 'CLOSED_WITHOUT_UNLOADING',
    unloaded: !!s.unloaded_at,
    can_exit: hc && decided && !left && s.local_supplier_arrival?.gate_exit_required === true && !s.close_requested_at,
    can_request_close: canRequestClose(s) === null,
    close_requested: !!s.close_requested_at && !s.close_approved_at,
    close_reason_code: s.exit_reason_code,
    close_remarks: s.exit_remarks,
    close_requested_at: s.close_requested_at ? s.close_requested_at.toISOString() : null,
  };
}

/** PHE Operator list: HC vehicles still inside, and MC/HC vehicles that may be closed without unloading. */
export async function listExitQueue(acting: ActingContext): Promise<ExitServiceResult<{ items: ExitQueueItem[] }>> {
  const zmccFilter = acting.scope.kind === 'SOURCE' ? { zmcc_id: acting.scope.sourceId } : {};
  const rows = await prisma.zmccLabSession.findMany({
    where: {
      ...zmccFilter,
      journey_closed_at: null,
      portions: { some: {} },
      OR: [
        { arrival_type: 'HC', local_supplier_arrival: { is: { exit_timestamp: null, gate_exit_required: true } } },
        { unloaded_at: null, portions: { some: { final_decision: 'ACCEPTED' } } },
      ],
    },
    include: SESSION_INCLUDE,
    orderBy: { created_at: 'asc' },
    take: 200,
  });
  const items = rows.map(toQueueItem).filter((i) => i.can_exit || i.can_request_close || i.close_requested);
  return { status: 200, data: { items } };
}

/** ZMCC Manager list of pending close requests. */
export async function listPendingCloseRequests(
  acting: ActingContext
): Promise<ExitServiceResult<{ items: ExitQueueItem[] }>> {
  const zmccFilter = acting.scope.kind === 'SOURCE' ? { zmcc_id: acting.scope.sourceId } : {};
  const rows = await prisma.zmccLabSession.findMany({
    where: { ...zmccFilter, close_requested_at: { not: null }, close_approved_at: null, journey_closed_at: null },
    include: SESSION_INCLUDE,
    orderBy: { close_requested_at: 'asc' },
    take: 100,
  });
  return { status: 200, data: { items: rows.map(toQueueItem) } };
}
