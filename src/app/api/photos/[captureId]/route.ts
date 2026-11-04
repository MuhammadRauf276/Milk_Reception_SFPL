import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { getCurrentUser } from '@/backend/core/auth';
import { authenticateDevice } from '@/backend/core/device-auth';
import {
  normalizeEntityType,
  resolveEntityRef,
  resolvePhotoPath,
  type EntityDb,
} from '@/backend/services/photo/capturedPhotoService';
import { THUMBNAIL_WIDTH, getPhotoThumbnail } from '@/backend/services/photo/photoThumbnail';

// Roles that may open any photo. Others: the uploader, or a user linked to the same source as the uploader.
const VIEW_ALL_ROLES = new Set(['SUPER_ADMIN', 'DATA_EXECUTIVE', 'EXECUTIVE_MANAGEMENT', 'HEAD_OF_MPD', 'QA_HEAD']);

export async function GET(req: Request, ctx: { params: Promise<{ captureId: string }> }) {
  const { captureId } = await ctx.params;
  if (!/^[A-Za-z0-9-]{8,64}$/.test(captureId)) {
    return NextResponse.json({ error: 'Photo not found.' }, { status: 404 });
  }

  const photo = await prisma.capturedPhoto.findUnique({ where: { capture_id: captureId } });
  if (!photo) return NextResponse.json({ error: 'Photo not found.' }, { status: 404 });

  let allowed = false;
  const user = await getCurrentUser(req);
  if (user) {
    if (VIEW_ALL_ROLES.has(user.role) || user.id === photo.captured_by.toString()) {
      allowed = true;
    } else if (user.procurement_source_id) {
      // Same-source viewers: the record's own source when it has one, else the uploader's source.
      const type = normalizeEntityType(photo.entity_type);
      const ref = type ? await resolveEntityRef(type, photo.entity_id, prisma as unknown as EntityDb) : null;
      if (ref?.sourceId != null) {
        allowed = ref.sourceId.toString() === user.procurement_source_id;
      } else {
        const uploader = await prisma.user.findUnique({
          where: { id: photo.captured_by },
          select: { procurement_source_id: true },
        });
        allowed = !!uploader?.procurement_source_id && uploader.procurement_source_id.toString() === user.procurement_source_id;
      }
    }
  } else {
    const device = await authenticateDevice(req);
    allowed = !!device && photo.device_id !== null && device.id === photo.device_id;
  }
  if (!allowed) {
    return NextResponse.json({ error: user ? 'Forbidden.' : 'Unauthorized.' }, { status: user ? 403 : 401 });
  }

  const full = resolvePhotoPath(photo.file_path);
  if (!full) return NextResponse.json({ error: 'Photo not found.' }, { status: 404 });
  try {
    const wantsThumbnail = new URL(req.url).searchParams.get('w') === String(THUMBNAIL_WIDTH);
    const data = (wantsThumbnail ? await getPhotoThumbnail(captureId, full) : null) ?? (await readFile(full));
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(data.length),
        // A capture id always means the same image, so the browser never has to ask for it twice.
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Photo file is missing.' }, { status: 404 });
  }
}
