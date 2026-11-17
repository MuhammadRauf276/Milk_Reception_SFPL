import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { getPakistanDayWindow } from '@/backend/core/business-day';
import { buildTvZmccBoard, testerStepIndex, TV_ZMCC_MAX_TESTER_ROWS } from '@/backend/services/tvBoardZmccService';
import { GET } from '@/app/api/tv-board/zmcc/route';

test('tester step follows status, arrival, lab and tank receipt', () => {
  assert.equal(testerStepIndex({ status: 'COLLECTING', hasArrival: false, hasLab: false, inTank: false }), 1);
  assert.equal(testerStepIndex({ status: 'RETURNING', hasArrival: false, hasLab: false, inTank: false }), 2);
  assert.equal(testerStepIndex({ status: 'ARRIVED', hasArrival: true, hasLab: false, inTank: false }), 3);
  assert.equal(testerStepIndex({ status: 'ARRIVED', hasArrival: true, hasLab: true, inTank: false }), 4);
  assert.equal(testerStepIndex({ status: 'ARRIVED', hasArrival: true, hasLab: true, inTank: true }), 5);
});

test('board figures match direct SQL for one ZMCC', async () => {
  const board = await buildTvZmccBoard();
  const section = board.zmccs[0];
  if (!section) return;
  const id = BigInt(section.id);
  const day = getPakistanDayWindow();

  const [ledger] = await prisma.$queryRaw<Array<{ stock: unknown }>>`
    SELECT COALESCE(SUM(CASE WHEN t.transaction_type IN ('RECEIPT','ADJUSTMENT_IN') THEN t.at_13ts_liters
                             WHEN t.transaction_type IN ('ISSUE','ADJUSTMENT_OUT') THEN -t.at_13ts_liters ELSE 0 END), 0) AS stock
    FROM zmcc_tank_inventory_transaction t
    JOIN zmcc_tank k ON k.id = t.tank_id
    WHERE k.zmcc_id = ${id} AND k.is_active = true`;
  assert.equal(section.tank.stockAt13Ts, Number(Number(ledger.stock).toFixed(2)));

  const [dispatched] = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(DISTINCT v.id) AS n
    FROM vehicle_visit v
    JOIN visit_portion p ON p.visit_id = v.id
    JOIN dispatch_info d ON d.portion_id = p.id
    WHERE v.procurement_source_id = ${id}
      AND v.current_status NOT IN ('DRAFT_DISPATCH','PENDING_APPROVAL','REOPENED','CANCELLED')
      AND d.dispatch_timestamp >= ${day.start} AND d.dispatch_timestamp <= ${day.end}`;
  assert.equal(section.steps.dispatched, Number(dispatched.n));

  const [active] = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM mot_journey WHERE zmcc_id = ${id} AND status IN ('COLLECTING','RETURNING','ARRIVED')`;
  assert.equal(section.testers.total, Number(active.n));
  assert.ok(section.testers.rows.length <= Math.min(TV_ZMCC_MAX_TESTER_ROWS, Number(active.n)));

  const rowIds = section.testers.rows.map((r) => BigInt(r.journeyId));
  if (rowIds.length) {
    const rows = await prisma.motJourney.findMany({ where: { id: { in: rowIds } }, select: { status: true, zmcc_id: true } });
    for (const r of rows) {
      assert.ok(['COLLECTING', 'RETURNING', 'ARRIVED'].includes(r.status));
      assert.equal(r.zmcc_id, id);
    }
  }
  assert.ok(!JSON.stringify(board).match(/\b(fat|lr|snf|density)\b/i), 'no lab values exposed');
});

test('the route refuses an anonymous request', async () => {
  const res = await GET(new Request('http://localhost/api/tv-board/zmcc'));
  assert.equal(res.status, 401);
});

test.after(async () => {
  await prisma.$disconnect();
});
