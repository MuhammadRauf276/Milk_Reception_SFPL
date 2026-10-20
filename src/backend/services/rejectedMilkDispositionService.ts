// MPD Head remarks on milk rejected at the ZMCC (rejected_milk_disposition) or Plant (visit_portion).
// Queue = rejected ZMCC lab portions and Plant visit portions that have no remarks yet.
import { prisma } from '@/backend/core/db';
import { writeAuditLog, type AuditActor } from '@/backend/core/audit';
import { requireRoles } from '@/backend/core/route-guards';
import type { ActingContext } from '@/types/acting';
import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';

export type RejectedMilkEntityType = 'ZMCC_LAB_PORTION' | 'PLANT_PORTION';
const MAX_REMARKS = 2000;
const MIN_REMARKS = 3;
const QUEUE_LIMIT = 200;

type Db = Prisma.TransactionClient;

export interface RecordRejectedMilkInput {
  /** ZmccLabPortion.id or VisitPortion.id of the rejected portion. */
  portionId: bigint;
  zmccId?: bigint;
  sourceId?: bigint;
  entityType?: RejectedMilkEntityType;
  /** Short text for the notification, e.g. "TK-1025 / 1200 L". */
  summary?: string;
  actor: AuditActor | ActingContext;
}

/**
 * Hook for ZMCC lab code: call inside transaction when a ZMCC lab portion becomes REJECTED.
 */
export async function recordRejectedMilkForDisposition(tx: Db, input: RecordRejectedMilkInput): Promise<void> {
  const entityType = input.entityType || 'ZMCC_LAB_PORTION';
  const heads = await tx.user.findMany({ where: { is_active: true, role: 'HEAD_OF_MPD' }, select: { id: true } });
  const detail = input.summary ? ` (${input.summary})` : '';
  const body = `Milk was rejected at the ${entityType === 'PLANT_PORTION' ? 'Plant' : 'ZMCC'}${detail}. Please add your remarks.`.slice(0, 500);

  for (const head of heads) {
    const dedupeKey = `REJECTED_MILK_REMARKS:${entityType}:${input.portionId}:${head.id}`;
    await tx.notification.upsert({
      where: { dedupe_key: dedupeKey },
      create: {
        recipient_user_id: head.id,
        event_key: 'REJECTED_MILK_REMARKS_PENDING',
        priority: 'HIGH',
        title: 'Rejected milk needs your remarks',
        body,
        deep_link: '/mpd/head',
        source_type: entityType,
        source_id: input.portionId.toString(),
        dedupe_key: dedupeKey,
      },
      update: {},
    });
  }

  await writeAuditLog(tx, {
    tableName: entityType === 'PLANT_PORTION' ? 'visit_portion' : 'zmcc_lab_portion',
    recordId: input.portionId,
    action: 'REJECTED_MILK_FLAGGED_FOR_MPD',
    oldValues: null,
    newValues: { entity_type: entityType, source_id: input.sourceId?.toString() || null, notified_heads: heads.length },
    actor: input.actor,
  });
}

export interface RejectedMilkQueueItem {
  entity_type: RejectedMilkEntityType;
  entity_id: string;
  portion_number: number;
  session_id: string;
  zmcc_id: string;
  zmcc_name: string;
  arrival_type: string;
  zmcc_token: string | null;
  gross_liters: string | null;
  reject_reason: string | null;
  rejected_at: string | null;
  remarks: string | null;
  remarks_by: string | null;
  remarks_at: string | null;
}

function toIso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

async function loadQueue(status: 'PENDING' | 'DONE' | 'ALL'): Promise<RejectedMilkQueueItem[]> {
  // 1. ZMCC Lab Portions
  const zmccDispositions = await prisma.rejectedMilkDisposition.findMany({
    where: { entity_type: 'ZMCC_LAB_PORTION' },
    include: { decided_by: { select: { full_name: true, username: true } } },
  });
  const zmccByEntity = new Map(zmccDispositions.map((d) => [d.entity_id.toString(), d]));
  const zmccDecidedIds = zmccDispositions.map((d) => d.entity_id);

  const zmccWhere: Prisma.ZmccLabPortionWhereInput = {
    OR: [{ final_decision: 'REJECTED' }, { status: 'REJECTED' }],
    ...(status === 'PENDING' ? { id: { notIn: zmccDecidedIds } } : {}),
    ...(status === 'DONE' ? { id: { in: zmccDecidedIds } } : {}),
  };

  const zmccPortions = await prisma.zmccLabPortion.findMany({
    where: zmccWhere,
    orderBy: { updated_at: 'desc' },
    take: QUEUE_LIMIT,
    include: {
      lab_session: {
        include: {
          zmcc: { select: { id: true, name: true } },
          mot_arrival: { select: { zmcc_token: true } },
          local_supplier_arrival: { select: { zmcc_token: true } },
        },
      },
    },
  });

  const zmccItems: RejectedMilkQueueItem[] = zmccPortions.map((p) => {
    const d = zmccByEntity.get(p.id.toString());
    const session = p.lab_session;
    return {
      entity_type: 'ZMCC_LAB_PORTION',
      entity_id: p.id.toString(),
      portion_number: p.portion_number,
      session_id: session.id.toString(),
      zmcc_id: session.zmcc_id.toString(),
      zmcc_name: session.zmcc?.name ?? '',
      arrival_type: session.arrival_type,
      zmcc_token: session.mot_arrival?.zmcc_token ?? session.local_supplier_arrival?.zmcc_token ?? null,
      gross_liters: p.gross_liters ? p.gross_liters.toString() : null,
      reject_reason: p.review_remarks || p.decision_remarks || session.rejection_reason || null,
      rejected_at: toIso(p.decided_at ?? p.reviewed_at ?? p.updated_at),
      remarks: d?.remarks ?? null,
      remarks_by: d ? d.decided_by.full_name || d.decided_by.username : null,
      remarks_at: toIso(d?.decided_at),
    };
  });

  // 2. Plant Visit Portions (Phase 4d Stage 4)
  const plantPortions = await prisma.visitPortion.findMany({
    where: {
      plant_decision: 'REJECTED',
      ...(status === 'PENDING' ? { mpd_disposition_remarks: null } : {}),
      ...(status === 'DONE' ? { mpd_disposition_remarks: { not: null } } : {}),
    },
    take: QUEUE_LIMIT,
    orderBy: { updated_at: 'desc' },
    include: {
      visit: {
        include: {
          procurement_source: { select: { id: true, name: true } },
          gate_log: { select: { entry_timestamp: true } },
        },
      },
      mpd_disposition_user: { select: { full_name: true, username: true } },
    },
  });

  const plantItems: RejectedMilkQueueItem[] = plantPortions.map((p) => ({
    entity_type: 'PLANT_PORTION',
    entity_id: p.id.toString(),
    portion_number: p.portion_number,
    session_id: p.visit_id.toString(),
    zmcc_id: p.visit.procurement_source_id ? p.visit.procurement_source_id.toString() : '',
    zmcc_name: p.visit.procurement_source?.name || `Vehicle ${p.visit.vehicle_number}`,
    arrival_type: 'PLANT_VEHICLE',
    zmcc_token: p.visit.token_number || null,
    gross_liters: p.dispatch_quantity_value ? p.dispatch_quantity_value.toString() : null,
    reject_reason: p.plant_rejection_reason || 'Plant QA Rejection',
    rejected_at: toIso(p.plant_decided_at ?? p.updated_at),
    remarks: p.mpd_disposition_remarks ?? null,
    remarks_by: p.mpd_disposition_user ? p.mpd_disposition_user.full_name || p.mpd_disposition_user.username : null,
    remarks_at: toIso(p.mpd_disposition_at),
  }));

  const allItems = [...zmccItems, ...plantItems];
  allItems.sort((a, b) => {
    const timeA = a.rejected_at ? new Date(a.rejected_at).getTime() : 0;
    const timeB = b.rejected_at ? new Date(b.rejected_at).getTime() : 0;
    return timeB - timeA;
  });

  return allItems;
}

/** GET queue. MPD Head and Super Admin; Data Executive may read. */
export async function getRejectedMilkQueue(req: Request): Promise<NextResponse> {
  const guard = await requireRoles(req, ['HEAD_OF_MPD', 'DATA_EXECUTIVE', 'SUPER_ADMIN'], { delegation: 'none', requestedAs: null });
  if ('response' in guard) return guard.response;
  const raw = (new URL(req.url).searchParams.get('status') || 'pending').toUpperCase();
  const status = raw === 'DONE' || raw === 'ALL' ? raw : 'PENDING';
  try {
    const items = await loadQueue(status);
    return NextResponse.json({ items, can_add_remarks: guard.acting.actorRole !== 'DATA_EXECUTIVE' });
  } catch (err) {
    console.error('getRejectedMilkQueue error:', err);
    return NextResponse.json({ error: 'Could not load rejected milk.' }, { status: 500 });
  }
}

/** POST remarks. MPD Head and Super Admin only. One remark per rejected portion. */
export async function addRejectedMilkRemarks(req: Request): Promise<NextResponse> {
  const guard = await requireRoles(req, ['HEAD_OF_MPD', 'SUPER_ADMIN'], { delegation: 'none', requestedAs: null });
  if ('response' in guard) return guard.response;
  const acting = guard.acting;

  const body = (await req.json().catch(() => null)) as { entity_type?: unknown; entity_id?: unknown; remarks?: unknown } | null;
  const rawType = typeof body?.entity_type === 'string' ? body.entity_type : 'ZMCC_LAB_PORTION';
  if (rawType !== 'ZMCC_LAB_PORTION' && rawType !== 'PLANT_PORTION') {
    return NextResponse.json({ error: 'This kind of rejected milk is not supported here.' }, { status: 400 });
  }
  const entityType = rawType as RejectedMilkEntityType;

  if (typeof body?.entity_id !== 'string' && typeof body?.entity_id !== 'number') {
    return NextResponse.json({ error: 'Rejected milk id is required.' }, { status: 400 });
  }
  const idText = String(body.entity_id).trim();
  if (!/^\d+$/.test(idText)) {
    return NextResponse.json({ error: 'Invalid rejected milk id.' }, { status: 400 });
  }
  const entityId = BigInt(idText);
  const remarks = typeof body?.remarks === 'string' ? body.remarks.trim() : '';
  if (remarks.length < MIN_REMARKS) {
    return NextResponse.json({ error: 'Please write your remarks.' }, { status: 400 });
  }
  if (remarks.length > MAX_REMARKS) {
    return NextResponse.json({ error: `Remarks are too long (max ${MAX_REMARKS} letters).` }, { status: 400 });
  }

  if (entityType === 'PLANT_PORTION') {
    const portion = await prisma.visitPortion.findUnique({
      where: { id: entityId },
      select: { id: true, plant_decision: true, mpd_disposition_remarks: true },
    });
    if (!portion) return NextResponse.json({ error: 'Plant rejected milk portion not found.' }, { status: 404 });
    if (portion.plant_decision !== 'REJECTED') {
      return NextResponse.json({ error: 'This plant milk portion was not rejected.' }, { status: 409 });
    }
    if (portion.mpd_disposition_remarks) {
      return NextResponse.json({ error: 'Remarks were already saved for this plant milk portion.' }, { status: 409 });
    }

    try {
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.visitPortion.update({
          where: { id: entityId },
          data: {
            mpd_disposition_remarks: remarks,
            mpd_disposition_by: acting.userId,
            mpd_disposition_at: now,
          },
        });

        // Also upsert a RejectedMilkDisposition row for unified reporting
        await tx.rejectedMilkDisposition.upsert({
          where: { entity_type_entity_id: { entity_type: 'PLANT_PORTION', entity_id: entityId } },
          create: {
            stage: 'PLANT',
            entity_type: 'PLANT_PORTION',
            entity_id: entityId,
            remarks,
            decided_by_user_id: acting.userId,
            decided_as_role: acting.actingAs,
            decided_is_delegated: acting.isDelegated,
            decided_at: now,
          },
          update: {
            remarks,
            decided_by_user_id: acting.userId,
            decided_as_role: acting.actingAs,
            decided_is_delegated: acting.isDelegated,
            decided_at: now,
          },
        });

        await writeAuditLog(tx, {
          tableName: 'visit_portion',
          recordId: entityId,
          action: 'PLANT_REJECTED_MILK_MPD_REMARKS_ADDED',
          oldValues: null,
          newValues: { entity_type: 'PLANT_PORTION', portion_id: entityId.toString(), remarks },
          actor: acting,
        });
      });

      return NextResponse.json({ ok: true, id: entityId.toString() }, { status: 201 });
    } catch (err) {
      console.error('addRejectedMilkRemarks plant error:', err);
      return NextResponse.json({ error: 'Could not save remarks for plant portion.' }, { status: 500 });
    }
  }

  // ZMCC_LAB_PORTION
  const portion = await prisma.zmccLabPortion.findUnique({
    where: { id: entityId },
    select: { id: true, status: true, final_decision: true },
  });
  if (!portion) return NextResponse.json({ error: 'Rejected milk not found.' }, { status: 404 });
  if (portion.final_decision !== 'REJECTED' && portion.status !== 'REJECTED') {
    return NextResponse.json({ error: 'This milk was not rejected.' }, { status: 409 });
  }

  try {
    const saved = await prisma.$transaction(async (tx) => {
      const existing = await tx.rejectedMilkDisposition.findUnique({
        where: { entity_type_entity_id: { entity_type: 'ZMCC_LAB_PORTION', entity_id: entityId } },
        select: { id: true },
      });
      if (existing) return null;
      const row = await tx.rejectedMilkDisposition.create({
        data: {
          stage: 'ZMCC',
          entity_type: 'ZMCC_LAB_PORTION',
          entity_id: entityId,
          remarks,
          decided_by_user_id: acting.userId,
          decided_as_role: acting.actingAs,
          decided_is_delegated: acting.isDelegated,
        },
      });
      await writeAuditLog(tx, {
        tableName: 'rejected_milk_disposition',
        recordId: row.id,
        action: 'REJECTED_MILK_REMARKS_ADDED',
        oldValues: null,
        newValues: { stage: 'ZMCC', entity_type: 'ZMCC_LAB_PORTION', entity_id: entityId.toString(), remarks },
        actor: acting,
      });
      return row;
    });
    if (!saved) {
      return NextResponse.json({ error: 'Remarks were already saved for this milk.' }, { status: 409 });
    }
    return NextResponse.json({ ok: true, id: saved.id.toString() }, { status: 201 });
  } catch (err) {
    console.error('addRejectedMilkRemarks error:', err);
    return NextResponse.json({ error: 'Could not save remarks.' }, { status: 500 });
  }
}
