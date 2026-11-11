// Adds a photo that was never taken, for a test or lab report that should have one, and links it where the record
// expects it. A pending request then no longer says the picture is missing.
import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/backend/core/db';
import { writeAuditLog, auditActorFromUser } from '@/backend/core/audit';
import type { User } from '@/backend/core/types';
import { Prisma } from '@prisma/client';
import { MAX_PHOTO_BYTES, PhotoError, isJpeg, normalizeEntityType, saveCapturedPhoto } from './capturedPhotoService';
import { photoRelPathFor } from './photoStoragePath';
import type { TestPointCode } from '@/types/test-point-policy';

export interface AddPhotoInput {
  entityType: string;
  entityId: string;
  labTestId: string | null;
  photoKind: 'TEST_RESULT' | 'LAB_REPORT';
  bytes: Uint8Array;
  width: number;
  height: number;
  reason: string;
}

type TestRow = { labTestId: string; testName?: string; photoMode?: string; photoCaptureId: string | null };

const withoutPictureMissing = (reasons: unknown) =>
  (Array.isArray(reasons) ? reasons : []).filter((r) => r !== 'PICTURE_MISSING') as unknown as Prisma.InputJsonValue;
const missingRequired = (tests: TestRow[]) => tests.some((t) => t.photoMode === 'REQUIRED' && !t.photoCaptureId);

async function testingPointOf(entityType: string, entityId: bigint): Promise<TestPointCode | null> {
  switch (entityType) {
    case 'mot_shop_collection':
      return 'MOT_SHOP';
    case 'zmcc_lab_portion': {
      const p = await prisma.zmccLabPortion.findUnique({ where: { id: entityId }, select: { lab_session: { select: { arrival_type: true } } } });
      return p ? (p.lab_session.arrival_type === 'HC' ? 'ZMCC_LAB_HC' : 'ZMCC_LAB_MC') : null;
    }
    case 'dispatch_portion':
    case 'dispatch_info': {
      const visit =
        entityType === 'dispatch_info'
          ? await prisma.vehicleVisit.findUnique({ where: { id: entityId }, select: { procurement_source: { select: { source_type: true } } } })
          : (await prisma.visitPortion.findUnique({ where: { id: entityId }, select: { visit: { select: { procurement_source: { select: { source_type: true } } } } } }))?.visit;
      if (!visit) return null;
      return visit.procurement_source?.source_type === 'CONTRACTOR' ? 'CONTRACTOR_DISPATCH' : 'ZMCC_DISPATCH';
    }
    case 'visit_portion':
      return 'PLANT_QA';
    default:
      return null;
  }
}

/** Links the new photo where the record keeps its pictures, and clears "picture missing" on a pending request. */
async function linkPhoto(tx: Prisma.TransactionClient, entityType: string, entityId: bigint, labTestId: string | null, captureId: string) {
  const setCapture = (tests: TestRow[]) => tests.map((t) => (t.labTestId === labTestId ? { ...t, photoCaptureId: captureId } : t));
  if (entityType === 'mot_shop_collection') {
    const c = await tx.motShopCollection.findUniqueOrThrow({ where: { id: entityId } });
    const d = (c.decision_details ?? {}) as { tests?: TestRow[] };
    if (!d.tests) return;
    const tests = setCapture(d.tests);
    await tx.motShopCollection.update({
      where: { id: entityId },
      data: {
        decision_details: { ...d, tests } as unknown as Prisma.InputJsonValue,
        ...(c.review_status === 'PENDING' && !missingRequired(tests) ? { exception_reasons: withoutPictureMissing(c.exception_reasons) } : {}),
      },
    });
  } else if (entityType === 'zmcc_lab_portion') {
    const p = await tx.zmccLabPortion.findUniqueOrThrow({ where: { id: entityId } });
    const d = (p.decision_details ?? {}) as { tests?: TestRow[] };
    if (!d.tests) return;
    const tests = setCapture(d.tests);
    await tx.zmccLabPortion.update({
      where: { id: entityId },
      data: {
        decision_details: { ...d, tests } as unknown as Prisma.InputJsonValue,
        ...(p.review_status === 'PENDING' && !missingRequired(tests) ? { exception_reasons: withoutPictureMissing(p.exception_reasons) } : {}),
      },
    });
  } else if (entityType === 'dispatch_portion' || entityType === 'dispatch_info') {
    const visitId = entityType === 'dispatch_info' ? entityId : (await tx.visitPortion.findUniqueOrThrow({ where: { id: entityId }, select: { visit_id: true } })).visit_id;
    const portionNumber = entityType === 'dispatch_portion' ? (await tx.visitPortion.findUniqueOrThrow({ where: { id: entityId }, select: { portion_number: true } })).portion_number : null;
    const v = await tx.vehicleVisit.findUniqueOrThrow({ where: { id: visitId } });
    type Details = {
      portions?: Array<{ portionNumber: number; tests: TestRow[]; photos: Array<{ labTestId: string; captureId: string }> }>;
      labReport?: { required: boolean; captureId: string | null };
      missingPhotos?: string[];
    };
    const d = (v.dispatch_decision_details ?? {}) as Details;
    let missingPhotos = d.missingPhotos ?? [];
    if (entityType === 'dispatch_info') {
      d.labReport = { required: d.labReport?.required ?? false, captureId };
      missingPhotos = missingPhotos.filter((m) => !/lab report/i.test(m));
    } else if (d.portions) {
      const multi = d.portions.length > 1;
      d.portions = d.portions.map((p) => {
        if (p.portionNumber !== portionNumber) return p;
        const test = p.tests.find((t) => t.labTestId === labTestId);
        if (test?.testName) missingPhotos = missingPhotos.filter((m) => m !== (multi ? `Portion ${p.portionNumber}: ${test.testName}` : test.testName));
        return { ...p, tests: setCapture(p.tests), photos: [...p.photos.filter((x) => x.labTestId !== labTestId), ...(labTestId ? [{ labTestId, captureId }] : [])] };
      });
    }
    await tx.vehicleVisit.update({
      where: { id: visitId },
      data: {
        dispatch_decision_details: { ...d, missingPhotos } as unknown as Prisma.InputJsonValue,
        ...(entityType === 'dispatch_info' ? { dispatch_lab_report_capture_id: captureId } : {}),
        ...(v.current_status === 'PENDING_APPROVAL' && missingPhotos.length === 0 ? { dispatch_exception_reasons: withoutPictureMissing(v.dispatch_exception_reasons) } : {}),
      },
    });
  }
  // Plant QA finds its pictures by test, so the photo row is enough.
}

export async function addMissingPhoto(user: User, input: AddPhotoInput): Promise<{ status: number; body: unknown }> {
  const reason = input.reason.trim();
  if (reason.length < 5) return { status: 400, body: { error: 'Please write the reason (at least 5 letters).' } };
  const entityType = normalizeEntityType(input.entityType);
  if (!entityType || !/^\d{1,18}$/.test(input.entityId)) return { status: 400, body: { error: 'This record cannot have photos.' } };
  if (input.labTestId !== null && !/^\d{1,18}$/.test(input.labTestId)) return { status: 400, body: { error: 'Test is not valid.' } };
  if (!isJpeg(input.bytes)) return { status: 400, body: { error: 'Please choose a JPEG photo.' } };
  if (input.bytes.length > MAX_PHOTO_BYTES) return { status: 413, body: { error: 'Photo is too big (limit 4 MB).' } };

  const entityId = BigInt(input.entityId);
  const labTestId = input.labTestId ? BigInt(input.labTestId) : null;
  const testingPoint = await testingPointOf(entityType, entityId);
  if (!testingPoint) return { status: 404, body: { error: 'The record for this photo was not found.' } };
  const already = await prisma.capturedPhoto.findFirst({ where: { entity_type: entityType, entity_id: entityId, lab_test_id: labTestId, photo_kind: input.photoKind } });
  if (already) return { status: 409, body: { error: 'This test already has a photo. Replace it instead.' } };

  const captureId = randomUUID();
  const now = new Date();
  const bytes = Buffer.from(input.bytes);
  try {
    await saveCapturedPhoto({
      meta: {
        captureId,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        testingPoint,
        entityType,
        entityId: input.entityId,
        labTestId: input.labTestId,
        photoKind: input.photoKind,
        deviceCapturedAt: now.toISOString(),
        wasOffline: false,
        width: input.width,
        height: input.height,
      },
      bytes,
      actor: { ...auditActorFromUser(user), userId: BigInt(user.id) },
      relPath: await photoRelPathFor(prisma, { entityType, entityId, labTestId, testingPoint, photoKind: input.photoKind, captureId, takenAt: now }),
    });
  } catch (err) {
    if (err instanceof PhotoError) return { status: err.status, body: { error: err.message } };
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    await linkPhoto(tx, entityType, entityId, input.labTestId, captureId);
    const row = await tx.capturedPhoto.findUniqueOrThrow({ where: { capture_id: captureId } });
    await writeAuditLog(tx, {
      tableName: 'captured_photo',
      recordId: row.id,
      action: 'PHOTO_ADDED_BY_CORRECTION',
      newValues: { captureId, entityType, entityId: input.entityId, labTestId: input.labTestId, reason },
      actor: auditActorFromUser(user),
    });
  });
  return { status: 200, body: { success: true, captureId } };
}
