// Who may read, write or delete a draft: the same people who may work on that stage and visit.
import { prisma } from '@core/db';
import { getCurrentUser } from '@core/auth';
import { requireRoles } from '@core/route-guards';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { DISPATCH_WRITE_ROLES } from '@/backend/services/dispatchScope';
import { resolveZmccLabAuth } from '@/backend/services/zmccLabService';
import { labPointForArrival } from '@/backend/services/zmcc/labPortionReviewService';
import { alreadyDecidedMessage, type DraftFormType } from '@/backend/services/formDraftService';

export type DraftAccess =
  | { ok: true; userId: bigint; closedMessage: string | null }
  | { ok: false; status: number; error: string };

/** The collaborators, replaceable in tests. */
export interface AccessDeps {
  prisma: typeof prisma;
  getCurrentUser: typeof getCurrentUser;
  requireRoles: typeof requireRoles;
  resolveZmccLabAuth: typeof resolveZmccLabAuth;
  labPointForArrival: typeof labPointForArrival;
}

const realDeps: AccessDeps = { prisma, getCurrentUser, requireRoles, resolveZmccLabAuth, labPointForArrival };

const fail = (status: number, error: string): DraftAccess => ({ ok: false, status, error });

function parseId(v: string): bigint | null {
  return /^\d{1,18}$/.test(v) ? BigInt(v) : null;
}

async function nameOf(deps: AccessDeps, userId: bigint | null): Promise<string | null> {
  if (!userId) return null;
  const u = await deps.prisma.user.findUnique({ where: { id: userId }, select: { full_name: true, username: true } });
  return u ? u.full_name || u.username : null;
}

/**
 * Plant QA: the very check the portion routes use (add, remove, complete): an active user whose role is
 * QA_LAB_ATTENDANT or a role above it (QA_HEAD, DATA_EXECUTIVE, SUPER_ADMIN).
 */
async function plantQaUser(req: Request, deps: AccessDeps): Promise<{ id: bigint } | DraftAccess> {
  const authUser = await deps.getCurrentUser(req);
  if (!authUser) return fail(401, 'Unauthorized. Authentication required.');
  const dbUser = await deps.prisma.user.findFirst({
    where: { OR: [{ username: authUser.username }, { username: authUser.id }], is_active: true },
    select: { id: true, role: true },
  });
  if (!dbUser || !canActAs(dbUser.role, 'QA_LAB_ATTENDANT')) return fail(403, 'Not allowed to work on Plant QA.');
  return { id: dbUser.id };
}

export async function authorizeDraftAccess(
  req: Request,
  formType: DraftFormType,
  scopeIdRaw: string,
  portionKey: string,
  deps: AccessDeps = realDeps,
): Promise<DraftAccess> {
  const scopeId = parseId(scopeIdRaw);
  if (!scopeId) return fail(400, 'Invalid scope id.');
  if (!portionKey || portionKey.length > 64) return fail(400, 'Invalid portion key.');
  const db = deps.prisma;

  if (formType === 'PLANT_QA') {
    const who = await plantQaUser(req, deps);
    if (!('id' in who)) return who;
    const portionId = parseId(portionKey);
    if (!portionId) return fail(400, 'Invalid portion key.');
    const portion = await db.visitPortion.findFirst({
      where: { id: portionId, visit_id: scopeId },
      select: { plant_decision: true, plant_decided_by: true, plant_decided_at: true },
    });
    if (!portion) return fail(404, 'Portion not found for this visit.');
    const decided = portion.plant_decision === 'ACCEPTED' || portion.plant_decision === 'REJECTED';
    const closedMessage = decided ? alreadyDecidedMessage(await nameOf(deps, portion.plant_decided_by), portion.plant_decided_at) : null;
    return { ok: true, userId: BigInt(who.id), closedMessage };
  }

  if (formType === 'ZMCC_LAB_MC' || formType === 'ZMCC_LAB_HC') {
    const { auth, errorResponse } = await deps.resolveZmccLabAuth(req, 'UPDATE_DRAFT');
    if (!auth) return fail(errorResponse?.status ?? 403, errorResponse?.error ?? 'Not allowed to work on ZMCC lab.');
    const portionId = parseId(portionKey);
    if (!portionId) return fail(400, 'Invalid portion key.');
    const portion = await db.zmccLabPortion.findFirst({
      where: { id: portionId, lab_session_id: scopeId },
      select: { person_decision: true, final_decision: true, lab_session: { select: { zmcc_id: true, status: true, arrival_type: true } } },
    });
    if (!portion) return fail(404, 'Portion not found for this lab session.');
    if (auth.effectiveZmccId !== null && portion.lab_session.zmcc_id !== auth.effectiveZmccId) return fail(403, 'Forbidden. Lab session belongs to another ZMCC.');
    if (deps.labPointForArrival(portion.lab_session.arrival_type) !== formType) return fail(400, 'Draft form does not match this lab session.');
    const decided = portion.lab_session.status !== 'IN_PROGRESS' || portion.person_decision !== null || portion.final_decision !== 'PENDING';
    return {
      ok: true,
      userId: auth.actorUserId,
      closedMessage: decided ? 'This portion was already decided or the session is finished. Your draft is kept.' : null,
    };
  }

  if (formType === 'MOT_SHOP') {
    const guard = await deps.requireRoles(req, ['MOT']);
    if ('response' in guard) return fail(guard.response.status, 'Not allowed to work on MOT collections.');
    const stop = await db.motJourneyStop.findUnique({
      where: { id: scopeId },
      select: { journey: { select: { mot_profile_id: true } }, collection: { select: { created_at: true, submitted_by_user_id: true } } },
    });
    if (!stop) return fail(404, 'Shop stop not found.');
    const own = await db.motProfile.findUnique({ where: { user_id: BigInt(guard.user.id) }, select: { id: true } });
    if (!own || own.id !== stop.journey.mot_profile_id) return fail(403, 'Forbidden. This journey is not assigned to you.');
    const closedMessage = stop.collection ? alreadyDecidedMessage(await nameOf(deps, stop.collection.submitted_by_user_id), stop.collection.created_at) : null;
    return { ok: true, userId: BigInt(guard.user.id), closedMessage };
  }

  // Dispatch forms: the draft belongs to the operator who opened the draft work item.
  const guard = await deps.requireRoles(req, DISPATCH_WRITE_ROLES);
  if ('response' in guard) return fail(guard.response.status, 'Not allowed to work on dispatch.');
  const visit = await db.vehicleVisit.findUnique({ where: { id: scopeId }, select: { created_by: true, current_status: true } });
  if (!visit) return fail(404, 'Dispatch work item not found.');
  if (visit.created_by?.toString() !== String(guard.user.id)) return fail(403, 'Unauthorized. This dispatch belongs to another operator.');
  return {
    ok: true,
    userId: BigInt(guard.user.id),
    closedMessage: visit.current_status === 'DRAFT_DISPATCH' ? null : 'This dispatch is no longer a draft. Your draft is kept.',
  };
}
