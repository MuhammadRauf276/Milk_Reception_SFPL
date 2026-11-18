import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { createArea, listAreas, routesThroughAreas, type ZmccAuthContext } from '@/backend/services/zmccMasterDataService';

const run = `${Date.now()}`;
const created: bigint[] = [];
const sa = (userId: bigint) =>
  ({ actorUserId: userId, role: 'SUPER_ADMIN', isSuperAdmin: true, isSystemScope: true, effectiveZmccId: null }) as unknown as ZmccAuthContext;

test('an area belongs to a ZMCC: added without a route, same name refused in any letter case', async (t) => {
  const zmcc = await prisma.procurementSource.findFirst({ where: { source_type: 'ZMCC', is_active: true } });
  if (!zmcc) return t.skip('needs an active ZMCC');
  const user = await prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' }, select: { id: true } });
  const auth = sa(user.id);

  assert.equal((await createArea(auth, { name: `Test area ${run}` })).status, 400, 'the ZMCC must be chosen');
  const ok = await createArea(auth, { name: `Test area ${run}`, zmcc_id: zmcc.id.toString() });
  assert.equal(ok.status, 201, JSON.stringify(ok));
  const area = ok.data as { id: string; area_code: string; zmcc_id: string };
  created.push(BigInt(area.id));
  assert.equal(area.zmcc_id, zmcc.id.toString());
  assert.ok(area.area_code.startsWith(`AR-${zmcc.code}-`) && /^[0-9]{3}$/.test(area.area_code.slice(-3)), area.area_code);

  const dup = await createArea(auth, { name: `TEST AREA ${run}`, zmcc_id: zmcc.id.toString() });
  assert.equal(dup.status, 409);

  const listed = (await listAreas(auth, { zmcc_id: zmcc.id.toString(), search: run })).find((a) => a.id === area.id);
  assert.ok(listed, 'listed under its ZMCC');
  assert.deepEqual(listed.routes, [], 'no shops yet, so no routes through it');
});

test('routes through an area are read from its shops (home and extra routes)', async () => {
  const shop = await prisma.zmccShop.findFirst({ include: { route_links: true } });
  if (!shop) return;
  const routes = (await routesThroughAreas([shop.area_id])).get(shop.area_id.toString()) ?? [];
  const ids = new Set(routes.map((r) => r.id));
  assert.ok(ids.has(shop.route_id.toString()), 'home route listed');
  for (const l of shop.route_links) assert.ok(ids.has(l.route_id.toString()), 'extra route listed');
});

test.after(async () => {
  // Only rows this test created.
  if (created.length) {
    await prisma.auditLog.deleteMany({ where: { table_name: 'zmcc_area', record_id: { in: created } } });
    await prisma.zmccArea.deleteMany({ where: { id: { in: created } } });
  }
  await prisma.$disconnect();
});
