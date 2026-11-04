import { clearHandledNotifications } from '@/backend/services/notificationService';
import { prisma } from '@/backend/core/db';
import { NextResponse } from 'next/server';
import { approveHcSupplier } from '@/backend/services/zmccLocalSupplierService';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await approveHcSupplier(req, id);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    await clearHandledNotifications(prisma, ['HC_APPROVAL_PENDING', 'NEW_HC_PENDING'], id);
    return NextResponse.json({ supplier: result.data }, { status: result.status });
  } catch (err: unknown) {
    console.error('POST /api/zmcc/hc-suppliers/[id]/approve error:', err);
    return NextResponse.json({ error: 'Could not approve this HC.' }, { status: 500 });
  }
}
