import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { requireRoles } from '@/backend/core/route-guards';
import { authenticateDevice } from '@/backend/core/device-auth';
import { canActAs, isOutsideDelegationRules } from '@/backend/core/roles/hierarchy';
import { MAX_PHOTO_BYTES, PhotoError, saveCapturedPhoto } from '@/backend/services/photo/capturedPhotoService';
import type { CapturedPhotoMeta } from '@/types/captured-photo';
import type { AuditActor } from '@/backend/core/audit';

// Field roles that take photos; roles above them are added by requireRoles (delegation 'ancestors').
const PHOTO_CAPTURE_ROLES = [
  'MOT',
  'MDO',
  'PHE_OPERATOR',
  'ZMCC_LAB_ATTENDANT',
  'CONTRACTOR_OPERATOR',
  'QA_LAB_ATTENDANT',
  'QA_MANAGER',
] as const;

function bad(error: string, status = 400, code?: string) {
  return NextResponse.json(code ? { error, code } : { error }, { status });
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad('Could not read the upload.');
  }
  const file = form.get('file');
  const metaRaw = form.get('meta');
  if (!(file instanceof Blob) || typeof metaRaw !== 'string') return bad('Photo or photo details are missing.');
  if (file.size > MAX_PHOTO_BYTES) return bad('Photo is too big (limit 4 MB).', 413, 'TOO_LARGE');

  let meta: CapturedPhotoMeta;
  try {
    meta = JSON.parse(metaRaw) as CapturedPhotoMeta;
  } catch {
    return bad('Photo details are not valid.', 400, 'INVALID_META');
  }

  // 1) Device identity (phones and station PCs), 2) fallback: signed-in session.
  let actor: AuditActor & { userId: bigint };
  const device = await authenticateDevice(req);
  if (device) {
    let ownerId = device.assignedUserId;
    if (device.isSharedStation) {
      const owner = form.get('ownerUserId');
      ownerId = typeof owner === 'string' && /^\d{1,18}$/.test(owner) ? BigInt(owner) : null;
    }
    if (!ownerId) return bad('This device is not linked to a user.', 403, 'NO_OWNER');
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true, role: true, is_active: true } });
    if (!owner || !owner.is_active) return bad('User not found or not active.', 403, 'NO_OWNER');
    // The client only requests an acting-as role; accept it only when the role tree allows it.
    const asked = meta.requestedAs?.trim() || null;
    const delegated = !!asked && asked !== owner.role && !isOutsideDelegationRules(owner.role) && canActAs(owner.role, asked);
    actor = {
      userId: owner.id,
      actorRole: owner.role,
      performedAsRole: delegated ? asked : owner.role,
      isDelegated: delegated,
      deviceId: device.id,
    };
  } else {
    const guard = await requireRoles(req, PHOTO_CAPTURE_ROLES, { requestedAs: meta.requestedAs ?? null });
    if ('response' in guard) return guard.response;
    actor = {
      userId: BigInt(guard.user.id),
      actorRole: guard.acting.actorRole,
      performedAsRole: guard.acting.actingAs,
      isDelegated: guard.acting.isDelegated,
    };
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await saveCapturedPhoto({ meta, bytes, actor });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PhotoError) return bad(err.message, err.status, err.code);
    console.error('[POST /api/photos]', err);
    return bad('Could not save the photo. Please try again.', 500, 'RETRY');
  }
}
