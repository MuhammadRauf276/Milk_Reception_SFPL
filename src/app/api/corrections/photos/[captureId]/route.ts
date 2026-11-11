import { NextResponse } from 'next/server';
import { requireDirectEditAuthority } from '@/backend/core/route-guards';
import { replaceCapturedPhoto } from '@/backend/services/photo/replaceCapturedPhoto';

/** Replace the picture of a saved photo. Super Admin only. Form fields: file, reason, width, height. */
export async function POST(req: Request, { params }: { params: Promise<{ captureId: string }> }) {
  const guard = await requireDirectEditAuthority(req);
  if ('response' in guard) return guard.response;

  const { captureId } = await params;
  if (!/^[A-Za-z0-9-]{8,64}$/.test(captureId)) return NextResponse.json({ error: 'Photo not found.' }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File)) return NextResponse.json({ error: 'Please choose a photo.' }, { status: 400 });

  try {
    const result = await replaceCapturedPhoto(guard.user, {
      captureId,
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
