import { NextResponse } from 'next/server';
import { requireRoles } from '@/backend/core/route-guards';
import { REQUESTING_ROLES, requestableEntities } from '@/lib/recordEditor';
import type { EditorEntity } from '@/lib/recordEditor';

/**
 * Whose work list this request is for. Normally the signed-in person's own role and ZMCC or contractor. While a
 * superior covers an operator (the x-acting-as headers), it is the covered role and station, and "mine" still means
 * the records the signed-in person entered, so a covering manager or Super Admin sees and corrects their own entries.
 */
export async function resolveWorkListOwner(
  req: Request
): Promise<{ response: NextResponse } | { userId: bigint; role: string; entities: readonly EditorEntity[]; sourceId?: bigint }> {
  // Without covering headers the person's own role must have a work list; never fall back to another role.
  const covering = req.headers.get('x-acting-as');
  const guard = await requireRoles(req, REQUESTING_ROLES, covering ? {} : { delegation: 'none', requestedAs: null });
  if ('response' in guard) {
    return guard.response.status === 401
      ? guard
      : { response: NextResponse.json({ error: 'Your role has no work list here.' }, { status: 403 }) };
  }
  // Covering: the covered role. Otherwise the person's own role (the shared guard would pick one for a Super Admin).
  const role = covering ? guard.acting.actingAs : guard.acting.actorRole;
  const entities = requestableEntities(role);
  if (entities.length === 0) return { response: NextResponse.json({ error: 'Your role has no work list here.' }, { status: 403 }) };
  const scope = guard.acting.scope;
  const sourceId =
    scope.kind === 'SOURCE'
      ? scope.sourceId
      : !guard.acting.isDelegated && guard.user.procurement_source_id
      ? BigInt(guard.user.procurement_source_id)
      : undefined;
  return { userId: guard.acting.userId, role, entities, sourceId };
}
