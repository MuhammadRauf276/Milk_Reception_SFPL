// Replaces the picture of a saved photo. The old file stays on disk and its path and check code stay in the audit log.
import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/backend/core/db';
import { writeAuditLog, auditActorFromUser } from '@/backend/core/audit';
import type { User } from '@/backend/core/types';
import { isJpeg, MAX_PHOTO_BYTES, resolvePhotoPath } from './capturedPhotoService';
import { THUMBNAIL_WIDTH } from './photoThumbnail';
import { buildPhotoRelPath, photoRecordInfo, replacedPhotoRelPath } from './photoStoragePath';

export interface ReplacePhotoInput {
  captureId: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  reason: string;
}

export async function replaceCapturedPhoto(user: User, input: ReplacePhotoInput): Promise<{ status: number; body: unknown }> {
  const { captureId, bytes, width, height } = input;
  const reason = input.reason.trim();
  if (reason.length < 5) return { status: 400, body: { error: 'Please write the reason (at least 5 letters).' } };
  if (!isJpeg(bytes)) return { status: 400, body: { error: 'Please choose a JPEG photo.' } };
  if (bytes.length > MAX_PHOTO_BYTES) return { status: 413, body: { error: 'Photo is too big (limit 4 MB).' } };
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return { status: 400, body: { error: 'Could not read the size of this photo.' } };
  }

  const photo = await prisma.capturedPhoto.findUnique({ where: { capture_id: captureId } });
  if (!photo) return { status: 404, body: { error: 'Photo not found.' } };

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 === photo.sha256) return { status: 400, body: { error: 'This is the same picture. Nothing was changed.' } };

  const now = new Date();
  const info = await photoRecordInfo(prisma, photo.entity_type, photo.entity_id);
  const test = photo.lab_test_id ? await prisma.labTest.findUnique({ where: { id: photo.lab_test_id }, select: { testCode: true, testName: true } }) : null;
  const parts = { takenAt: photo.device_captured_at, testingPoint: photo.testing_point, photoKind: photo.photo_kind, captureId, testCode: test?.testCode, testName: test?.testName, ...info };
  const relPath = buildPhotoRelPath(parts);
  const keptPath = replacedPhotoRelPath(parts, now);
  const fullPath = resolvePhotoPath(relPath);
  const oldFull = resolvePhotoPath(photo.file_path);
  const keptFull = resolvePhotoPath(keptPath);
  if (!fullPath || !keptFull) return { status: 400, body: { error: 'Could not store this photo.' } };
  // Keep the old picture next to the record, then put the new one where the photo belongs.
  if (oldFull) {
    await mkdir(path.dirname(keptFull), { recursive: true });
    await rename(oldFull, keptFull).catch(() => undefined);
  }
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, bytes);

  try {
  await prisma.$transaction(async (tx) => {
    await tx.capturedPhoto.update({ where: { id: photo.id }, data: { sha256, file_path: relPath, width, height, bytes: bytes.length } });
    await writeAuditLog(tx, {
      tableName: 'captured_photo',
      recordId: photo.id,
      action: 'PHOTO_REPLACED',
      oldValues: { sha256: photo.sha256, file_path: keptPath, stored_at_before: photo.file_path },
      newValues: { sha256, file_path: relPath, reason },
      actor: auditActorFromUser(user),
    });
  });
  } catch (err) {
    // Nothing was saved, so put the old picture back where the record points.
    if (relPath !== photo.file_path) await rm(fullPath, { force: true }).catch(() => undefined);
    if (oldFull) await rename(keptFull, oldFull).catch(() => undefined);
    throw err;
  }

  // The small copy is named by the photo's ID, so the old one has to go.
  const thumb = resolvePhotoPath(path.join('.thumbs', `${captureId}-w${THUMBNAIL_WIDTH}.jpg`));
  if (thumb) await rm(thumb, { force: true }).catch(() => undefined);
  return { status: 200, body: { success: true, sha256 } };
}
