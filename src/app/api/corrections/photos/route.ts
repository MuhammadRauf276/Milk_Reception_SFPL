import { NextResponse } from 'next/server';
import { requireDirectEditAuthority } from '@/backend/core/route-guards';
import { addMissingPhoto } from '@/backend/services/photo/addMissingPhoto';

/** Add a photo that was never taken. Super Admin only. Form fields: file, reason, width, height, entityType, entityId, labTestId, photoKind. */
export async function POST(req: Request) {
  const guard = await requireDirectEditAuthority(req);
  if ('response' in guard) return guard.response;

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File)) return NextResponse.json({ error: 'Please choose a photo.' }, { status: 400 });
  const labTestId = String(form.get('labTestId') ?? '');

  try {
    const result = await addMissingPhoto(guard.user, {
      entityType: String(form.get('entityType') ?? ''),
      entityId: String(form.get('entityId') ?? ''),
      labTestId: labTestId || null,
      photoKind: form.get('photoKind') === 'LAB_REPORT' ? 'LAB_REPORT' : 'TEST_RESULT',
      bytes: new Uint8Array(await file.arrayBuffer()),
      width: Number(form.get('width')),
      height: Number(form.get('height')),
      reason: String(form.get('reason') ?? ''),
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('POST /api/corrections/photos error:', err);
    return NextResponse.json({ error: 'Could not save the photo. Nothing was changed.' }, { status: 500 });
  }
}
