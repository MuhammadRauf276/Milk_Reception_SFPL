import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { isZmccFieldOfficer } from '@/backend/core/roles/hierarchy';
import { getTvZmccBoard } from '@/backend/services/tvBoardZmccService';

export const dynamic = 'force-dynamic';

/**
 * Yard board, ZMCC part: per ZMCC the pipeline counts, tank figures and active Mobile Tester journeys.
 * Signed-in users only. The field roles the page bars are refused too. No lab values, only counts and quantities.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Sign in to see ZMCC sections.' }, { status: 401 });
  if (user.role === 'MOT' || isZmccFieldOfficer(user.role)) {
    return NextResponse.json({ error: 'Not available for this role.' }, { status: 403 });
  }
  const board = await getTvZmccBoard();
  return NextResponse.json(board, { headers: { 'Cache-Control': 'private, no-store' } });
}
