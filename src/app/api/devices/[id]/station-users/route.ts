import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDeviceAdmin } from '@/backend/core/route-guards';
import { deviceErrorInfo } from '@/backend/services/device/deviceService';
import { listStationUsers, removeStationPin, setStationPin } from '@/backend/services/device/stationPinService';

type Ctx = { params: Promise<{ id: string }> };

const putSchema = z.object({ userId: z.string().regex(/^\d+$/), pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits.') });
const deleteSchema = z.object({ userId: z.string().regex(/^\d+$/) });

async function deviceId(ctx: Ctx): Promise<bigint | null> {
  const { id } = await ctx.params;
  return /^\d+$/.test(id) ? BigInt(id) : null;
}

export async function GET(req: Request, ctx: Ctx) {
  const guard = await requireDeviceAdmin(req);
  if ('response' in guard) return guard.response;
  const id = await deviceId(ctx);
  if (id === null) return NextResponse.json({ error: 'Computer not found.' }, { status: 404 });
  try {
    return NextResponse.json({ users: await listStationUsers(id) });
  } catch (err) {
    const e = deviceErrorInfo(err);
    return NextResponse.json(e.body, { status: e.status });
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const guard = await requireDeviceAdmin(req);
  if ('response' in guard) return guard.response;
  const id = await deviceId(ctx);
  if (id === null) return NextResponse.json({ error: 'Computer not found.' }, { status: 404 });
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Choose a user and a PIN of exactly 4 digits.' }, { status: 400 });
  try {
    await setStationPin(guard.acting, id, BigInt(parsed.data.userId), parsed.data.pin);
    return NextResponse.json({ users: await listStationUsers(id) });
  } catch (err) {
    const e = deviceErrorInfo(err);
    return NextResponse.json(e.body, { status: e.status });
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const guard = await requireDeviceAdmin(req);
  if ('response' in guard) return guard.response;
  const id = await deviceId(ctx);
  if (id === null) return NextResponse.json({ error: 'Computer not found.' }, { status: 404 });
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Choose a user.' }, { status: 400 });
  try {
    await removeStationPin(guard.acting, id, BigInt(parsed.data.userId));
    return NextResponse.json({ users: await listStationUsers(id) });
  } catch (err) {
    const e = deviceErrorInfo(err);
    return NextResponse.json(e.body, { status: e.status });
  }
}
