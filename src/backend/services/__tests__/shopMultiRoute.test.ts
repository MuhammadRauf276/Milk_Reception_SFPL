import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { createShop, listShops, updateShop, type ZmccAuthContext } from '@/backend/services/zmccMasterDataService';
import { shopsOnRouteWhere } from '@/backend/services/routeShops';
import { getZmccHierarchyReport } from '@/backend/services/zmccReportsService';

const run = `${Date.now()}`;
const shopCode = `ZZ-TEST-MR-${run}`;
let shopId: bigint | null = null;

function superAdmin(userId: bigint): ZmccAuthContext {
  return { actorUserId: userId, role: 'SUPER_ADMIN', isSuperAdmin: true, isSystemScope: true, effectiveZmccId: null } as unknown as ZmccAuthContext;
}

async function pickRoutes() {
  const area = await prisma.zmccArea.findFirst({
    where: { is_active: true, route: { is_active: true, zmcc: { is_active: true, source_type: 'ZMCC' } } },
    include: { route: true },
  });
  if (!area) return null;
  const extra = await prisma.zmccRoute.findFirst({ where: { is_active: true, zmcc_id: area.zmcc_id, id: { not: area.route_id } } });
  const foreign = await prisma.zmccRoute.findFirst({ where: { is_active: true, zmcc_id: { not: area.zmcc_id } } });
  const user = await prisma.user.findFirstOrThrow({ select: { id: true } });
  const chiller = await prisma.chillerOwnership.findFirstOrThrow({ where: { is_active: true } });
  return { area, extra, foreign, userId: user.id, chillerId: chiller.id };
}

const body = (ctx: NonNullable<Awaited<ReturnType<typeof pickRoutes>>>, extra: string[]) => ({
  shop_code: shopCode,
  shop_name: `Test multi route shop ${run}`,
  owner_name: 'Test Owner',
  phone_number: '03001234567',
  cnic: '35201-1234567-1',
  area_id: ctx.area.id.toString(),
  chiller_ownership_id: ctx.chillerId.toString(),
  extra_route_ids: extra,
});

test('a shop on a home route and one extra route is listed once on each route', async (t) => {
  const ctx = await pickRoutes();
  if (!ctx || !ctx.extra) return t.skip('needs two active routes in one ZMCC');
  const auth = superAdmin(ctx.userId);
  const home = ctx.area.route_id;
  const extra = ctx.extra.id;

  // The home route is passed too: it must never be stored twice.
  const created = await createShop(auth, body(ctx, [extra.toString(), extra.toString(), home.toString()]));
  assert.equal(created.status, 201, JSON.stringify(created));
  shopId = BigInt((created.data as { id: string }).id);
  assert.equal(await prisma.zmccRouteShop.count({ where: { shop_id: shopId } }), 1);

  for (const routeId of [home, extra]) {
    const list = await listShops(auth, { route_id: routeId.toString() });
    assert.equal(list.filter((s) => s.id === shopId!.toString()).length, 1, `listed once on route ${routeId}`);
    // Same query the journey planner uses.
    const planned = await prisma.zmccShop.findMany({ where: { ...shopsOnRouteWhere(routeId), is_active: true } });
    assert.equal(planned.filter((s) => s.id === shopId).length, 1, `planned once on route ${routeId}`);
  }

  const shown = (await listShops(auth, { search: shopCode })).find((s) => s.id === shopId!.toString());
  assert.deepEqual(shown?.extra_route_ids, [extra.toString()]);

  // The route hierarchy shows the shop on both routes; the ZMCC total counts it once.
  const report = (await getZmccHierarchyReport(ctx.area.zmcc_id)) as { routes: Array<{ id: string; areas: Array<{ shops: Array<{ id: string }> }> }>; summary: { totalShops: number } };
  for (const routeId of [home, extra]) {
    const node = report.routes.find((r) => r.id === routeId.toString());
    const count = (node?.areas ?? []).flatMap((a) => a.shops).filter((s) => s.id === shopId!.toString()).length;
    assert.equal(count, 1, `hierarchy shows the shop once on route ${routeId}`);
  }
  const totalShops = await prisma.zmccShop.count({ where: { zmcc_id: ctx.area.zmcc_id } });
  assert.equal(report.summary.totalShops, totalShops);

  // Saving again replaces the extra routes.
  const cleared = await updateShop(auth, shopId, { extra_route_ids: [] });
  assert.equal(cleared.status, 200, JSON.stringify(cleared));
  assert.equal(await prisma.zmccRouteShop.count({ where: { shop_id: shopId } }), 0);
  const audit = await prisma.auditLog.findFirst({ where: { table_name: 'zmcc_shop', record_id: shopId, action: 'ZMCC_SHOP_CREATED' } });
  assert.ok(audit, 'creation is audited');
});

test('a route of another ZMCC is refused', async (t) => {
  const ctx = await pickRoutes();
  if (!ctx || !ctx.foreign) return t.skip('needs routes in two ZMCCs');
  const before = await prisma.zmccShop.count({ where: { shop_code: `${shopCode}-X` } });
  const refused = await createShop(superAdmin(ctx.userId), { ...body(ctx, [ctx.foreign.id.toString()]), shop_code: `${shopCode}-X`, shop_name: `Test refused ${run}` });
  assert.equal(refused.status, 400);
  assert.match(String(refused.error), /ZMCC/);
  assert.equal(await prisma.zmccShop.count({ where: { shop_code: `${shopCode}-X` } }), before);
});

test('collections stay on the route that was driven', async () => {
  const collections = await prisma.motShopCollection.findMany({ select: { route_id: true, journey: { select: { route_id: true } } }, take: 500 });
  assert.ok(collections.every((c) => c.route_id === c.journey.route_id));
});

test.after(async () => {
  if (shopId) {
    // Only rows this test created.
    await prisma.zmccRouteShop.deleteMany({ where: { shop_id: shopId } });
    await prisma.auditLog.deleteMany({ where: { table_name: 'zmcc_shop', record_id: shopId } });
    await prisma.zmccShop.deleteMany({ where: { id: shopId } });
  }
  await prisma.$disconnect();
});
