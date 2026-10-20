import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDeviceAdmin } from '@/backend/core/route-guards';
import { assignDevice, blockDevice, deviceErrorInfo, releaseDevice, rotateKey } from '@/backend/services/device/deviceService';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), userId: z.string().regex(/^\d+$/) }),
  z.object({ action: z.literal('release') }),
  z.object({ action: z.literal('block'), reason: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal('rotate-key') }),
]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireDeviceAdmin(req);
  if ('response' in guard) return guard.response;
  const { id: rawId } = await ctx.params;
  if (!/^\d+$/.test(rawId)) return NextResponse.json({ error: 'Phone not found.' }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Please check what you entered.' }, { status: 400 });
  const id = BigInt(rawId);
  const body = parsed.data;
  try {
    if (body.action === 'assign') return NextResponse.json({ device: await assignDevice(guard.acting, id, BigInt(body.userId)) });
    if (body.action === 'release') return NextResponse.json({ device: await releaseDevice(guard.acting, id) });
    if (body.action === 'block') return NextResponse.json({ device: await blockDevice(guard.acting, id, body.reason) });
    const { device, syncKey } = await rotateKey(guard.acting, id);
    return NextResponse.json({ device, syncKey });
  } catch (err) {
    const e = deviceErrorInfo(err);
    return NextResponse.json(e.body, { status: e.status });
  }
}
