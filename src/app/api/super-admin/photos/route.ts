import { NextResponse } from 'next/server';
import { requireCorrectionAuthority } from '@/backend/core/route-guards';
import { listPhotoRegister, type PhotoRecordStatus } from '@/backend/services/photo/photoRegisterService';

const STATUSES: PhotoRecordStatus[] = ['SUBMITTED', 'NOT_SUBMITTED', 'NOT_FOUND'];
const STAGES = ['MOT_SHOP', 'ZMCC_LAB_MC', 'ZMCC_LAB_HC', 'ZMCC_DISPATCH', 'CONTRACTOR_DISPATCH', 'PLANT_QA'];

/** Every photo, newest first. Super Admin and Data Executive. */
export async function GET(req: Request) {
  const guard = await requireCorrectionAuthority(req);
  if ('response' in guard) return guard.response;

  const q = new URL(req.url).searchParams;
  const date = q.get('date') || undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'Invalid date.' }, { status: 400 });
  const stage = q.get('stage') || undefined;
  const status = q.get('status') || undefined;

  try {
    return NextResponse.json(
      await listPhotoRegister({
        date,
        stage: stage && STAGES.includes(stage) ? stage : undefined,
        status: status && (STATUSES as string[]).includes(status) ? (status as PhotoRecordStatus) : undefined,
        takenBy: q.get('takenBy')?.trim() || undefined,
        page: Math.max(1, Number(q.get('page')) || 1),
        pageSize: Math.min(50, Math.max(5, Number(q.get('pageSize')) || 25)),
      })
    );
  } catch (err) {
    console.error('GET /api/super-admin/photos error:', err);
    return NextResponse.json({ error: 'Could not load photos.' }, { status: 500 });
  }
}
