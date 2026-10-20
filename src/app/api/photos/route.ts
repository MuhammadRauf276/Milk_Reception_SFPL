import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { getCurrentUser } from '@/backend/core/auth';
import { authenticateDevice } from '@/backend/core/device-auth';
import { ACTING_AS_HEADER, scopeFailureResponse } from '@/backend/core/route-guards';
import { assertResourceInScope, resolveActingContext } from '@/backend/core/acting-context';
import type { Role, User } from '@/backend/core/types';
import {
  MAX_PHOTO_BYTES,
  PhotoError,
  decidePhotoOwner,
  normalizeEntityType,
  resolveEntityRef,
  saveCapturedPhoto,
  type EntityDb,
} from '@/backend/services/photo/capturedPhotoService';
import type { CapturedPhotoMeta } from '@/types/captured-photo';
import type { AuditActor } from '@/backend/core/audit';

// Field roles that take photos; roles above them are added by resolveActingContext (delegation 'ancestors').
const PHOTO_CAPTURE_ROLES = [
  'MOT',
  'MDO',
  'PHE_OPERATOR',
  'ZMCC_LAB_ATTENDANT',
  'CONTRACTOR_OPERATOR',
  'QA_LAB_ATTENDANT',
] as const;

function bad(error: string, status = 400, code?: string) {
  return NextResponse.json(code ? { error, code } : { error }, { status });
}

async function loadUserById(id: bigint): Promise<User | null> {
  const row = await prisma.user.findUnique({ where: { id }, include: { procurement_source: true } });
  if (!row || !row.is_active) return null;
  return {
    id: row.id.toString(),
    username: row.username,
    name: row.full_name || row.username,
    role: row.role as Role,
    department: row.department || '',
    scope_type: row.scope_type,
    procurement_source_id: row.procurement_source_id ? row.procurement_source_id.toString() : null,
    procurement_source: row.procurement_source
      ? {
          id: row.procurement_source.id.toString(),
          code: row.procurement_source.code,
          name: row.procurement_source.name,
          source_type: row.procurement_source.source_type,
          is_active: row.procurement_source.is_active,
        }
      : null,
  };
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

  const entityType = normalizeEntityType(meta?.entityType);
  if (!entityType) return bad('This kind of record cannot have photos.', 400, 'UNKNOWN_ENTITY');
  if (typeof meta.entityId !== 'string' || !/^\d{1,18}$/.test(meta.entityId)) {
    return bad('Record ID is not valid.', 400, 'INVALID_META');
  }

  const ownerRaw = form.get('ownerUserId');
  const formOwner = typeof ownerRaw === 'string' && /^\d{1,18}$/.test(ownerRaw.trim()) ? ownerRaw.trim() : null;

  // Who is the owner of this photo? Device first, then session.
  const session = await getCurrentUser(req);
  const device = await authenticateDevice(req);
  let deviceId: bigint | null = null;

  const decision = decidePhotoOwner({
    hasDevice: !!device,
    assignedUserId: device?.assignedUserId != null ? device.assignedUserId.toString() : null,
    formOwnerId: formOwner,
    sessionUserId: session?.id ?? null,
  });
  if (!decision.ok) return bad(decision.message, decision.status, decision.code);
  if (device) deviceId = device.id;
  const user: User | null = decision.useSession && session ? session : await loadUserById(BigInt(decision.ownerId));
  if (!user) return bad('User not found or not active.', 403, 'NO_OWNER');

  const requestedAs = meta.requestedAs ?? req.headers.get(ACTING_AS_HEADER);
  const resolved = resolveActingContext(user, PHOTO_CAPTURE_ROLES, { requestedAs });
  if (!resolved.ok) {
    return resolved.code === 'FORBIDDEN' ? bad('Forbidden.', 403) : scopeFailureResponse(resolved.code);
  }
  const acting = resolved.ctx;

  // The record must exist and be inside the actor's area.
  const ref = await resolveEntityRef(entityType, BigInt(meta.entityId), prisma as unknown as EntityDb);
  if (!ref) return bad('The record for this photo was not found.', 404, 'ENTITY_NOT_FOUND');
  const scope = assertResourceInScope(acting, ref);
  if (!scope.ok) return scopeFailureResponse(scope.code);

  const actor: AuditActor & { userId: bigint } = {
    userId: acting.userId,
    actorRole: acting.actorRole,
    performedAsRole: acting.actingAs,
    isDelegated: acting.isDelegated,
    deviceId,
  };

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
