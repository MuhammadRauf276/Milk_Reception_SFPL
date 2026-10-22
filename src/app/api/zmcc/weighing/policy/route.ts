import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { WEIGHING_ROLES } from '@/backend/services/zmccTankService';
import { getWeighingPolicyForOperators } from '@/backend/services/zmccWeighingPolicyService';

/** Operator view of the weighing policy: only manual_entry_enabled and allowed_units. */
export async function GET(req: Request) {
  try {
    const guard = await requireRoles(req, WEIGHING_ROLES);
    if ('response' in guard) return guard.response;
    return NextResponse.json(await getWeighingPolicyForOperators());
  } catch (err) {
    console.error('GET /api/zmcc/weighing/policy error:', err);
    return NextResponse.json({ error: 'Failed to load the weighing settings.' }, { status: 500 });
  }
}
