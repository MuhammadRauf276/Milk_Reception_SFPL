// Moves stored photos into the traceable folder layout (see photoStoragePath.ts). Safe to run again: a photo already
// in place is left alone. Old pictures kept after a replacement move to their record's replaced/ folder.
// Every move is written to the audit log and to _moves/<time>.csv in the storage folder.
import { access, mkdir, readdir, rename, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/backend/core/db';
import { writeAuditLog } from '@/backend/core/audit';
import { photoStorageRoot, resolvePhotoPath } from './capturedPhotoService';
import { buildPhotoRelPath, photoRecordFolder, photoRecordInfo, replacedPhotoRelPath, type PhotoPathParts } from './photoStoragePath';

const exists = (p: string) => access(p).then(() => true, () => false);

/** Moves a file; when the name is taken, adds -2, -3 … so nothing is ever overwritten. Returns where it went. */
async function moveFile(fromRel: string, toRel: string): Promise<string | null> {
  const from = resolvePhotoPath(fromRel);
  if (!from || !(await exists(from))) return null;
  let target = toRel;
  for (let n = 2; ; n++) {
    const full = resolvePhotoPath(target);
    if (!full) return null;
    if (full === from) return target;
    if (!(await exists(full))) {
      await mkdir(path.dirname(full), { recursive: true });
      await rename(from, full);
      return target;
    }
    target = toRel.replace(/\.jpg$/, `-${n}.jpg`);
  }
}

/** Removes folders left empty by the moves. Never touches the thumbnail cache or the move lists. */
async function removeEmptyFolders(dir: string, isRoot = true): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  let empty = true;
  for (const e of entries) {
    if (e.isDirectory() && !(isRoot && (e.name === '.thumbs' || e.name === '_moves'))) {
      if (!(await removeEmptyFolders(path.join(dir, e.name), false))) empty = false;
    } else {
      empty = false;
    }
  }
  if (empty && !isRoot) await rmdir(dir).catch(() => undefined);
  return empty;
}

export interface ReorganizeResult {
  checked: number;
  moved: number;
  replacedMoved: number;
  missing: string[];
  manifest: string | null;
}

export async function reorganizePhotos(options: { dryRun?: boolean } = {}): Promise<ReorganizeResult> {
  const photos = await prisma.capturedPhoto.findMany({ include: { lab_test: { select: { testCode: true, testName: true } } }, orderBy: { id: 'asc' } });
  const replacements = await prisma.auditLog.findMany({ where: { table_name: 'captured_photo', action: 'PHOTO_REPLACED' }, orderBy: { id: 'asc' } });
  const rows: string[] = ['capture_id,kind,from,to'];
  const result: ReorganizeResult = { checked: photos.length, moved: 0, replacedMoved: 0, missing: [], manifest: null };

  try {
  for (const photo of photos) {
    const info = await photoRecordInfo(prisma, photo.entity_type, photo.entity_id);
    const parts: PhotoPathParts = {
      takenAt: photo.device_captured_at,
      testingPoint: photo.testing_point,
      photoKind: photo.photo_kind,
      captureId: photo.capture_id,
      testCode: photo.lab_test?.testCode,
      testName: photo.lab_test?.testName,
      ...info,
    };
    const target = buildPhotoRelPath(parts);
    if (photo.file_path !== target) {
      const from = resolvePhotoPath(photo.file_path);
      if (!from || !(await exists(from))) {
        result.missing.push(`${photo.capture_id}: ${photo.file_path}`);
      } else {
        let placed = target;
        if (!options.dryRun) {
          placed = (await moveFile(photo.file_path, target)) ?? photo.file_path;
          await prisma.$transaction(async (tx) => {
            await tx.capturedPhoto.update({ where: { id: photo.id }, data: { file_path: placed } });
            await writeAuditLog(tx, {
              tableName: 'captured_photo',
              recordId: photo.id,
              action: 'PHOTO_FILE_MOVED',
              oldValues: { file_path: photo.file_path },
              newValues: { file_path: placed },
              actor: { userId: null, actorRole: 'SYSTEM' },
            });
          });
        }
        rows.push(`${photo.capture_id},current,${photo.file_path},${placed}`);
        result.moved++;
      }
    }

    // Older pictures of this photo, as named in the replacement records.
    const olds = replacements.filter((a) => a.record_id === photo.id);
    for (const a of olds) {
      const oldPath = (a.old_values as { file_path?: string } | null)?.file_path;
      if (!oldPath || oldPath === target || oldPath === photo.file_path) continue;
      const oldFull = resolvePhotoPath(oldPath);
      if (!oldFull || !(await exists(oldFull))) continue;
      // Already named as a replaced picture: keep its name, only bring it into this record's folder.
      let to = oldPath.includes('/replaced/') ? `${photoRecordFolder(parts)}/replaced/${path.posix.basename(oldPath)}` : replacedPhotoRelPath(parts, a.created_at);
      if (to === oldPath) continue;
      if (!options.dryRun) to = (await moveFile(oldPath, to)) ?? oldPath;
      rows.push(`${photo.capture_id},replaced,${oldPath},${to}`);
      result.replacedMoved++;
    }
  }
  } finally {
    if (!options.dryRun) await removeEmptyFolders(photoStorageRoot());
    // The list of moves is written even if a run stops part way.
    if (!options.dryRun && rows.length > 1) {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
      const manifest = path.join(photoStorageRoot(), '_moves', `${stamp}.csv`);
      await mkdir(path.dirname(manifest), { recursive: true });
      await writeFile(manifest, rows.join('\n') + '\n');
      result.manifest = manifest;
    }
  }

  return result;
}
