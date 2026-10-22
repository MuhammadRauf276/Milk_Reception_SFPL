import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDeviceAdmin } from '@/backend/core/route-guards';
import { countDevices, deviceErrorInfo, listDevices, listFormOptions, registerDevice } from '@/backend/services/device/deviceService';
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
    const sp = new URL(req.url).searchParams;
    const status = sp.get('status');
    const paged = sp.has('page');
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize')) || 25));
    const search = (sp.get('q') || '').trim();
    const filter = {
      ...(status && (STATUSES as readonly string[]).includes(status) ? { status: status as DeviceStatus } : {}),
      ...(search ? { search } : {}),
    };
    const [devices, totalRecords, options] = await Promise.all([
      listDevices(paged ? { ...filter, skip: (page - 1) * pageSize, take: pageSize } : filter),
      paged ? countDevices(filter) : Promise.resolve(0),
      sp.get('options') === '0' ? Promise.resolve({}) : listFormOptions(),
    ]);
    return NextResponse.json({
      devices,
      ...options,
      ...(paged
        ? { pagination: { page, pageSize, totalRecords, totalPages: totalRecords === 0 ? 1 : Math.ceil(totalRecords / pageSize) } }
        : {}),
    });
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
