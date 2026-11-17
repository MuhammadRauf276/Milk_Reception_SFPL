import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { getVehiclesInsideZmcc } from '@/backend/services/zmccArrival/zmccArrivalCore';
import type { Role, User } from '@/backend/core/types';

test('Inside ZMCC: Mobile Tester vehicles only while their journey is open, HC vehicles until their gate exit', async () => {
  const sa = await prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN', is_active: true } });
  const user: User = { id: sa.id.toString(), username: sa.username, name: sa.full_name || sa.username, role: sa.role as Role, department: 'TEST', scope_type: 'GLOBAL' };
  const res = await getVehiclesInsideZmcc(user);
  assert.equal(res.status, 200);
  const data = res.data!;

  const [mot] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
    SELECT COUNT(*)::int AS n FROM zmcc_mot_arrival a JOIN mot_journey j ON j.id = a.journey_id
    WHERE a.exit_timestamp IS NULL AND j.status NOT IN ('COMPLETED','CANCELLED')`);
  const [hc] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
    SELECT COUNT(*)::int AS n FROM zmcc_local_supplier_arrival WHERE gate_exit_required AND exit_timestamp IS NULL`);
  assert.equal(data.total_count, mot.n + hc.n);

  const motIds = data.vehicles.filter((v) => v.arrival_type === 'MOT').map((v) => BigInt(v.id));
  if (motIds.length) {
    const closed = await prisma.zmccMotArrival.count({ where: { id: { in: motIds }, journey: { status: { in: ['COMPLETED', 'CANCELLED'] } } } });
    assert.equal(closed, 0, 'no closed journey is shown as inside');
  }
  for (const v of data.vehicles.filter((x) => x.arrival_type !== 'MOT')) assert.equal(v.gate_exit_required, true);
});

test.after(async () => {
  await prisma.$disconnect();
});
