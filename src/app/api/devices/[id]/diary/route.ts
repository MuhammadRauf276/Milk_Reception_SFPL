import { NextResponse } from 'next/server';
import { requireDeviceAdmin } from '@/backend/core/route-guards';
import { deviceErrorInfo, getDeviceDiary } from '@/backend/services/device/deviceService';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireDeviceAdmin(req);
  if ('response' in guard) return guard.response;
  const { id: rawId } = await ctx.params;
  if (!/^\d+$/.test(rawId)) return NextResponse.json({ error: 'Phone not found.' }, { status: 404 });
  const q = new URL(req.url).searchParams;
  const cursor = q.get('cursor');
  const limit = Number(q.get('limit') ?? 50);
  try {
    const result = await getDeviceDiary(BigInt(rawId), {
      cursor: cursor && /^\d+$/.test(cursor) ? BigInt(cursor) : null,
      limit: Number.isFinite(limit) ? limit : 50,
    });
    return NextResponse.json(result);
  } catch (err) {
    const e = deviceErrorInfo(err);
    return NextResponse.json(e.body, { status: e.status });
  }
}
