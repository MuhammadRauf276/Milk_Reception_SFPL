import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeDraftAccess, type AccessDeps } from '../formDraftAccess';

// Fakes for the database and the guards. Only the calls formDraftAccess makes are answered.
interface FakeUser {
  id: bigint;
  username: string;
  role: string;
  is_active: boolean;
}

function makeDeps(opts: {
  signedIn?: { id: string; username: string } | null;
  users?: FakeUser[];
  portions?: Array<{ id: bigint; visit_id: bigint; plant_decision: string | null }>;
  guardUser?: { id: string } | null; // null = the role guard refuses
  guardStatus?: number;
  stops?: Array<{ id: bigint; mot_profile_id: bigint }>;
  profiles?: Array<{ user_id: bigint; id: bigint }>;
  visits?: Array<{ id: bigint; created_by: bigint | null; current_status: string }>;
  lab?: { auth: unknown; errorResponse?: { status: number; error: string } };
}): AccessDeps {
  const users = opts.users ?? [];
  const db = {
    user: {
      async findFirst({ where }: { where: { OR: Array<{ username: string }>; is_active: boolean } }) {
        const names = where.OR.map((o) => o.username);
        return users.find((u) => names.includes(u.username) && u.is_active === where.is_active) ?? null;
      },
      async findUnique() {
        return null;
      },
    },
    visitPortion: {
      async findFirst({ where }: { where: { id: bigint; visit_id: bigint } }) {
        const p = (opts.portions ?? []).find((x) => x.id === where.id && x.visit_id === where.visit_id);
        return p ? { plant_decision: p.plant_decision, plant_decided_by: null, plant_decided_at: null } : null;
      },
    },
    zmccLabPortion: { async findFirst() { return null; } },
    motJourneyStop: {
      async findUnique({ where }: { where: { id: bigint } }) {
        const s = (opts.stops ?? []).find((x) => x.id === where.id);
        return s ? { journey: { mot_profile_id: s.mot_profile_id }, collection: null } : null;
      },
    },
    motProfile: {
      async findUnique({ where }: { where: { user_id: bigint } }) {
        return (opts.profiles ?? []).find((p) => p.user_id === where.user_id) ?? null;
      },
    },
    vehicleVisit: {
      async findUnique({ where }: { where: { id: bigint } }) {
        return (opts.visits ?? []).find((v) => v.id === where.id) ?? null;
      },
    },
  };
  return {
    prisma: db,
    getCurrentUser: async () => (opts.signedIn === undefined ? null : opts.signedIn),
    requireRoles: async () =>
      opts.guardUser ? { user: opts.guardUser } : { response: { status: opts.guardStatus ?? 403 } },
    resolveZmccLabAuth: async () => opts.lab ?? { auth: null, errorResponse: { status: 403, error: 'no' } },
    labPointForArrival: () => 'ZMCC_LAB_MC',
  } as unknown as AccessDeps;
}

const req = new Request('http://localhost/api/drafts');
const qaUser = (role: string, over: Partial<FakeUser> = {}): FakeUser => ({ id: BigInt(7), username: 'qa1', role, is_active: true, ...over });
const signed = { id: '7', username: 'qa1' };
const portions = [{ id: BigInt(10), visit_id: BigInt(5), plant_decision: null }];

test('Plant QA: every role the portion routes accept can save a draft', async () => {
  for (const role of ['QA_LAB_ATTENDANT', 'QA_HEAD', 'DATA_EXECUTIVE', 'SUPER_ADMIN']) {
    const deps = makeDeps({ signedIn: signed, users: [qaUser(role)], portions });
    const out = await authorizeDraftAccess(req, 'PLANT_QA', '5', '10', deps);
    assert.ok(out.ok, `${role} should be allowed`);
    if (out.ok) assert.equal(out.userId, BigInt(7), 'the caller gets their own id back');
  }
});

test('Plant QA: a role below QA attendant, an inactive user and a signed-out caller are refused', async () => {
  const below = await authorizeDraftAccess(req, 'PLANT_QA', '5', '10', makeDeps({ signedIn: signed, users: [qaUser('MOT')], portions }));
  assert.deepEqual(below.ok ? null : below.status, 403);
  const inactive = await authorizeDraftAccess(req, 'PLANT_QA', '5', '10', makeDeps({ signedIn: signed, users: [qaUser('QA_HEAD', { is_active: false })], portions }));
  assert.deepEqual(inactive.ok ? null : inactive.status, 403);
  const out = await authorizeDraftAccess(req, 'PLANT_QA', '5', '10', makeDeps({ signedIn: null, portions }));
  assert.deepEqual(out.ok ? null : out.status, 401);
});

test('Plant QA: a portion that belongs to another visit is refused with 404', async () => {
  const deps = makeDeps({ signedIn: signed, users: [qaUser('QA_LAB_ATTENDANT')], portions });
  const out = await authorizeDraftAccess(req, 'PLANT_QA', '6', '10', deps); // portion 10 is on visit 5
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.status, 404);
});

test('MOT shop: a MOT user not assigned to the journey is refused with 403, the assigned one gets their id', async () => {
  const stops = [{ id: BigInt(3), mot_profile_id: BigInt(100) }];
  const other = makeDeps({ guardUser: { id: '9' }, stops, profiles: [{ user_id: BigInt(9), id: BigInt(200) }] });
  const refused = await authorizeDraftAccess(req, 'MOT_SHOP', '3', 'form', other);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.status, 403);
  const noProfile = await authorizeDraftAccess(req, 'MOT_SHOP', '3', 'form', makeDeps({ guardUser: { id: '9' }, stops }));
  assert.equal(noProfile.ok, false);
  const mine = makeDeps({ guardUser: { id: '9' }, stops, profiles: [{ user_id: BigInt(9), id: BigInt(100) }] });
  const ok = await authorizeDraftAccess(req, 'MOT_SHOP', '3', 'form', mine);
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.userId, BigInt(9));
  const missing = await authorizeDraftAccess(req, 'MOT_SHOP', '4', 'form', mine);
  assert.equal(missing.ok ? 0 : missing.status, 404);
});

test('MOT shop: a role the guard refuses is refused', async () => {
  const out = await authorizeDraftAccess(req, 'MOT_SHOP', '3', 'form', makeDeps({ guardUser: null, guardStatus: 403 }));
  assert.equal(out.ok ? 0 : out.status, 403);
});

test('Dispatch: a draft work item owned by another operator is refused with 403, the owner is allowed', async () => {
  const visits = [{ id: BigInt(20), created_by: BigInt(1), current_status: 'DRAFT_DISPATCH' }];
  for (const formType of ['DISPATCH', 'ZMCC_DISPATCH', 'CONTRACTOR_DISPATCH'] as const) {
    const other = await authorizeDraftAccess(req, formType, '20', 'form', makeDeps({ guardUser: { id: '2' }, visits }));
    assert.equal(other.ok ? 0 : other.status, 403, formType);
    const owner = await authorizeDraftAccess(req, formType, '20', 'form', makeDeps({ guardUser: { id: '1' }, visits }));
    assert.ok(owner.ok, formType);
    if (owner.ok) {
      assert.equal(owner.userId, BigInt(1));
      assert.equal(owner.closedMessage, null);
    }
  }
  const gone = await authorizeDraftAccess(req, 'DISPATCH', '21', 'form', makeDeps({ guardUser: { id: '1' }, visits }));
  assert.equal(gone.ok ? 0 : gone.status, 404);
});

test('Dispatch: a role not allowed is refused with the guard status; a submitted dispatch reports closed', async () => {
  const refused = await authorizeDraftAccess(req, 'DISPATCH', '20', 'form', makeDeps({ guardUser: null, guardStatus: 403 }));
  assert.equal(refused.ok ? 0 : refused.status, 403);
  const signedOut = await authorizeDraftAccess(req, 'DISPATCH', '20', 'form', makeDeps({ guardUser: null, guardStatus: 401 }));
  assert.equal(signedOut.ok ? 0 : signedOut.status, 401);
  const visits = [{ id: BigInt(20), created_by: BigInt(1), current_status: 'DISPATCHED' }];
  const closed = await authorizeDraftAccess(req, 'DISPATCH', '20', 'form', makeDeps({ guardUser: { id: '1' }, visits }));
  assert.ok(closed.ok && closed.closedMessage !== null);
});

test('bad ids are refused before any lookup', async () => {
  const deps = makeDeps({});
  assert.equal((await authorizeDraftAccess(req, 'PLANT_QA', 'abc', '10', deps)).ok, false);
  assert.equal((await authorizeDraftAccess(req, 'PLANT_QA', '5', 'x'.repeat(65), deps)).ok, false);
  const bad = await authorizeDraftAccess(req, 'PLANT_QA', '-5', '10', deps);
  assert.equal(bad.ok ? 0 : bad.status, 400);
});

test('ZMCC lab: a refused lab auth passes its status through', async () => {
  const deps = makeDeps({ lab: { auth: null, errorResponse: { status: 403, error: 'Forbidden.' } } });
  const out = await authorizeDraftAccess(req, 'ZMCC_LAB_MC', '5', '10', deps);
  assert.equal(out.ok ? 0 : out.status, 403);
});
