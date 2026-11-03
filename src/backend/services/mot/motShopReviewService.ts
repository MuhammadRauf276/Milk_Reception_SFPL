// Stage 1 (MOT shop) exception review: a Zonal Manager (or above) decides a collection waiting for approval.
import type { Prisma } from '@prisma/client';
import { prisma } from '@core/db';
import { assertResourceInScope, asRoleFields } from '@/backend/core/acting-context';
import { writeAuditLog } from '@/backend/core/audit';
import { recomputeMotJourneySummaryTx } from '@/backend/services/motJourneySummaryService';
import type { ActingContext } from '@/types/acting';
import type {
  ExceptionReason,
  FinalDecision,
  MotShopDecisionDetails,
  PersonDecision,
  ReviewStatus,
} from '@/types/stage1-decision';

interface ServiceResult<T> {
  status: number;
  data?: T;
  error?: string;
}

export interface MotShopExceptionItem {
  id: string;
  collectionNumber: string;
  zmccId: string;
  journeyNumber: string;
  shopName: string;
  motName: string;
  submittedAt: string;
  performedAsRole: string | null;
  isDelegated: boolean;
  grossLiters: number;
  lr: number;
  fat: number;
  personDecision: PersonDecision;
  decisionRemarks: string | null;
  exceptionReasons: ExceptionReason[];
  details: MotShopDecisionDetails | null;
  photos: Array<{ captureId: string; labTestId: string | null; received: boolean }>;
  reviewStatus: ReviewStatus;
  finalDecision: FinalDecision;
  version: number;
  // Review outcome (only set once decided)
  reviewedAt?: string | null;
  reviewRemarks?: string | null;
}

const PHOTO_ENTITY_TYPES = ['mot_shop_collection', 'MOT_SHOP_COLLECTION'];

const itemInclude = {
  journey: { select: { journey_number: true, ended_at: true } },
  stop: { select: { shop_name_snapshot: true } },
  mot_profile: { select: { name: true } },
} satisfies Prisma.MotShopCollectionInclude;

type CollectionRow = Prisma.MotShopCollectionGetPayload<{ include: typeof itemInclude }>;

type Db = Pick<typeof prisma, 'capturedPhoto'>;

function asReasons(raw: unknown): ExceptionReason[] {
  return Array.isArray(raw) ? (raw.filter((r) => typeof r === 'string') as ExceptionReason[]) : [];
}

function toItem(
  row: CollectionRow,
  captured: Array<{ capture_id: string; lab_test_id: bigint | null }>
): MotShopExceptionItem {
  const details = (row.decision_details as unknown as MotShopDecisionDetails | null) ?? null;
  const capturedIds = new Set(captured.map((c) => c.capture_id));
  const photos: MotShopExceptionItem['photos'] = [];
  const seen = new Set<string>();
  for (const t of details?.tests ?? []) {
    if (!t.photoCaptureId || seen.has(t.photoCaptureId)) continue;
    seen.add(t.photoCaptureId);
    photos.push({ captureId: t.photoCaptureId, labTestId: t.labTestId, received: capturedIds.has(t.photoCaptureId) });
  }
  for (const c of captured) {
    if (seen.has(c.capture_id)) continue;
    seen.add(c.capture_id);
    photos.push({ captureId: c.capture_id, labTestId: c.lab_test_id?.toString() ?? null, received: true });
  }
  return {
    id: row.id.toString(),
    collectionNumber: row.collection_number,
    zmccId: row.zmcc_id.toString(),
    journeyNumber: row.journey.journey_number,
    shopName: row.stop.shop_name_snapshot,
    motName: row.mot_profile.name,
    submittedAt: row.device_collected_at.toISOString(),
    performedAsRole: row.performed_as_role,
    isDelegated: row.is_delegated,
    grossLiters: Number(row.gross_liters),
    lr: Number(row.lr),
    fat: Number(row.fat),
    personDecision: (row.person_decision === 'REJECT' ? 'REJECT' : 'ACCEPT') as PersonDecision,
    decisionRemarks: row.decision_remarks,
    exceptionReasons: asReasons(row.exception_reasons),
    details,
    photos,
    reviewStatus: row.review_status as ReviewStatus,
    finalDecision: row.final_decision as FinalDecision,
    version: row.version,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    reviewRemarks: row.review_remarks,
  };
}

async function loadPhotos(db: Db, ids: bigint[]) {
  const byId = new Map<string, Array<{ capture_id: string; lab_test_id: bigint | null }>>();
  if (ids.length === 0) return byId;
  const rows = await db.capturedPhoto.findMany({
    where: { entity_type: { in: PHOTO_ENTITY_TYPES }, entity_id: { in: ids } },
    select: { capture_id: true, lab_test_id: true, entity_id: true },
  });
  for (const r of rows) {
    const key = r.entity_id.toString();
    const list = byId.get(key) ?? [];
    list.push({ capture_id: r.capture_id, lab_test_id: r.lab_test_id });
    byId.set(key, list);
  }
  return byId;
}

export async function listMotShopExceptions(
  ctx: ActingContext,
  q: { status?: 'PENDING' | 'DECIDED'; limit?: number }
): Promise<MotShopExceptionItem[]> {
  const decided = q.status === 'DECIDED';
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 200);
  const where: Prisma.MotShopCollectionWhereInput = decided
    ? { review_status: { in: ['APPROVED', 'REJECTED'] }, reviewed_by_user_id: { not: null } }
    : { review_status: 'PENDING' };
  if (ctx.scope.kind === 'SOURCE') where.zmcc_id = ctx.scope.sourceId;
  else if (ctx.scope.kind !== 'SYSTEM') return [];

  const rows = await prisma.motShopCollection.findMany({
    where,
    include: itemInclude,
    orderBy: decided ? { reviewed_at: 'desc' } : { device_collected_at: 'asc' },
    take: limit,
  });
  const photos = await loadPhotos(prisma, rows.map((r) => r.id));
  return rows.map((r) => toItem(r, photos.get(r.id.toString()) ?? []));
}

export async function reviewMotShopException(
  ctx: ActingContext,
  id: bigint,
  i: { verdict: 'OKAY' | 'NO'; remarks?: string | null; version: number }
): Promise<ServiceResult<MotShopExceptionItem>> {
  if (i.verdict !== 'OKAY' && i.verdict !== 'NO') return { status: 400, error: 'Choose OKAY or NO.' };
  if (!Number.isInteger(i.version)) return { status: 400, error: 'Version is required.' };
  const remarks = (i.remarks ?? '').trim();
  if (i.verdict === 'NO' && remarks.length < 3) {
    return { status: 400, error: 'Please write a reason for saying NO.' };
  }

  const existing = await prisma.motShopCollection.findUnique({ where: { id }, select: { zmcc_id: true } });
  if (!existing) return { status: 404, error: 'Collection not found.' };
  const scope = assertResourceInScope(ctx, { sourceId: existing.zmcc_id, sourceType: 'ZMCC' });
  if (!scope.ok) return { status: 403, error: 'This record is outside your area.' };

  return prisma.$transaction(async (tx): Promise<ServiceResult<MotShopExceptionItem>> => {
    const row = await tx.motShopCollection.findUnique({ where: { id }, include: itemInclude });
    if (!row) return { status: 404, error: 'Collection not found.' };
    if (row.version !== i.version || row.review_status !== 'PENDING') {
      return { status: 409, error: 'Someone already decided this. Reload.' };
    }
    if (row.submitted_by_user_id === ctx.userId) {
      return { status: 403, error: 'You cannot decide your own collection.' };
    }

    const person: PersonDecision = row.person_decision === 'REJECT' ? 'REJECT' : 'ACCEPT';
    const final: FinalDecision =
      i.verdict === 'OKAY' ? (person === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED') : person === 'ACCEPT' ? 'REJECTED' : 'ACCEPTED';
    const reviewStatus: ReviewStatus = i.verdict === 'OKAY' ? 'APPROVED' : 'REJECTED';
    const now = new Date();

    const upd = await tx.motShopCollection.updateMany({
      where: { id, version: i.version, review_status: 'PENDING' },
      data: {
        ...asRoleFields(ctx, 'reviewed'),
        reviewed_by_user_id: ctx.userId,
        reviewed_at: now,
        review_remarks: remarks || null,
        review_status: reviewStatus,
        final_decision: final,
        version: { increment: 1 },
      },
    });
    if (upd.count !== 1) return { status: 409, error: 'Someone already decided this. Reload.' };

    await tx.motJourneyStop.update({
      where: { id: row.journey_stop_id },
      data: { status: final === 'REJECTED' ? 'REJECTED' : 'VISITED' },
    });

    await writeAuditLog(tx, {
      tableName: 'mot_shop_collection',
      recordId: id,
      action: 'MOT_SHOP_EXCEPTION_REVIEWED',
      oldValues: { review_status: row.review_status, final_decision: row.final_decision, version: row.version },
      newValues: {
        verdict: i.verdict,
        review_status: reviewStatus,
        final_decision: final,
        person_decision: person,
        review_remarks: remarks || null,
      },
      actor: ctx,
    });

    if (row.journey.ended_at) {
      await recomputeMotJourneySummaryTx(tx, row.journey_id, ctx.userId, ctx.actingAs);
    }

    const fresh = await tx.motShopCollection.findUniqueOrThrow({ where: { id }, include: itemInclude });
    const photos = await loadPhotos(tx, [id]);
    return { status: 200, data: toItem(fresh, photos.get(id.toString()) ?? []) };
  });
}
