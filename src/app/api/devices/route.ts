import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDeviceAdmin } from '@/backend/core/route-guards';
import { deviceErrorInfo, listDevices, listFormOptions, registerDevice } from '@/backend/services/device/deviceService';
import type { DeviceStatus } from '@/types/device';

const STATUSES = ['PENDING', 'ACTIVE', 'BLOCKED', 'RELEASED'] as const;

const registerSchema = z.object({
  deviceUid: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(150),
  isSharedStation: z.boolean().optional().default(false),
  procurementSourceId: z.union([z.string().regex(/^\d+$/), z.null()]).optional(),
});

export async function GET(req: Request) {
  const guard = await requireDeviceAdmin(req);
  if ('response' in guard) return guard.response;
  try {
    const status = new URL(req.url).searchParams.get('status');
    const [devices, options] = await Promise.all([
      listDevices(status && (STATUSES as readonly string[]).includes(status) ? { status: status as DeviceStatus } : {}),
      listFormOptions(),
    ]);
    return NextResponse.json({ devices, ...options });
  } catch (err) {
    const e = deviceErrorInfo(err);
    return NextResponse.json(e.body, { status: e.status });
  }
}

export async function POST(req: Request) {
  const guard = await requireDeviceAdmin(req);
  if ('response' in guard) return guard.response;
  const parsed = registerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Please fill in the phone ID and name.' }, { status: 400 });
  try {
    const { device, syncKey } = await registerDevice(guard.acting, {
      deviceUid: parsed.data.deviceUid,
      label: parsed.data.label,
      isSharedStation: parsed.data.isSharedStation,
      procurementSourceId: parsed.data.procurementSourceId ? BigInt(parsed.data.procurementSourceId) : null,
    });
    return NextResponse.json({ device, syncKey }, { status: 201 });
  } catch (err) {
    const e = deviceErrorInfo(err);
    return NextResponse.json(e.body, { status: e.status });
  }
}
