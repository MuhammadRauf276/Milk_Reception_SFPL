import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { getMySubmittedRequests } from '@/backend/services/approvals/submitterRequestService';

export async function GET(req: Request) {
  try {
    const current = await getCurrentUser(req);
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: BigInt(current.id) },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    const items = await getMySubmittedRequests(
      user.id,
      user.procurement_source_id ? user.procurement_source_id : undefined,
      user.role
    );

    return NextResponse.json({ items });
  } catch (err: unknown) {
    console.error('GET /api/approvals/my-requests error:', err);
    const message = err instanceof Error ? err.message : 'Failed to load submitted requests.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
