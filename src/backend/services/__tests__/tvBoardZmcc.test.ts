import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { buildTvZmccBoard, labAndReceiptSteps, TV_ZMCC_MAX_ROWS } from '@/backend/services/tvBoardZmccService';
import { GET } from '@/app/api/tv-board/zmcc/route';

const manager = { role: 'ZMCC_MANAGER', name: null };
const lab = (over: Record<string, unknown> = {}) =>
  ({
    status: 'IN_PROGRESS',
    final_decision: null,
    decision: null,
    manager_review_status: 'NONE',
    started_at: new Date(),
    completed_at: null,
    close_requested_at: null,
    close_approved_at: null,
    journey_closed_at: null,
    tank_receipt: null,
    _count: { portions: 0 },
    ...over,
  }) as Parameters<typeof labAndReceiptSteps>[0];

test('lab and receipt steps follow the lab session, the receipt and approvals', () => {
  assert.deepEqual(labAndReceiptSteps(null, false, manager).map((s) => s.state), ['upcoming', 'upcoming']);
  assert.deepEqual(labAndReceiptSteps(null, true, manager).map((s) => s.state), ['current', 'upcoming']);
  assert.deepEqual(labAndReceiptSteps(lab(), true, manager).map((s) => s.state), ['current', 'upcoming']);

  const review = labAndReceiptSteps(lab({ status: 'COMPLETED', manager_review_status: 'PENDING' }), true, manager);
  assert.equal(review[0].state, 'waiting');
  assert.equal(review[0].approval?.role, 'ZMCC_MANAGER');

  const portionReview = labAndReceiptSteps(lab({ _count: { portions: 1 } }), true, manager);
  assert.equal(portionReview[0].state, 'waiting');

  const accepted = labAndReceiptSteps(lab({ status: 'COMPLETED', final_decision: 'ACCEPTED' }), true, manager);
  assert.deepEqual(accepted.map((s) => s.state), ['done', 'current']);

  const received = labAndReceiptSteps(
    lab({ status: 'COMPLETED', final_decision: 'ACCEPTED', tank_receipt: { at_13ts_liters: 412.4, gross_liters: 420, received_at: new Date() } }),
    true,
    manager
  );
  assert.equal(received[1].state, 'done');
  assert.equal(received[1].metric, '412 L @13 TS');

  const rejected = labAndReceiptSteps(lab({ status: 'COMPLETED', final_decision: 'REJECTED' }), true, manager);
  assert.deepEqual(rejected.map((s) => s.state), ['rejected', 'rejected']);

  const closing = labAndReceiptSteps(lab({ status: 'COMPLETED', final_decision: 'ACCEPTED', close_requested_at: new Date() }), true, manager);
  assert.equal(closing[1].state, 'waiting');
  assert.equal(closing[1].approval?.role, 'ZMCC_MANAGER');
});

test('board lists live and today\'s journeys per ZMCC, without lab values', async () => {
  const board = await buildTvZmccBoard();
  for (const section of board.zmccs) {
    const id = BigInt(section.id);
    const [live] = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM mot_journey WHERE zmcc_id = ${id} AND status IN ('COLLECTING','RETURNING','ARRIVED')`;
    assert.ok(section.testers.total >= Number(live.n), 'every live journey is listed');
    assert.ok(section.testers.rows.length <= TV_ZMCC_MAX_ROWS);
    assert.ok(section.hc.rows.length <= TV_ZMCC_MAX_ROWS);
    for (const row of [...section.testers.rows, ...section.hc.rows]) {
      assert.equal(row.steps.filter((s) => s.state === 'current').length <= 2, true, 'at most two steps marked current');
      assert.ok(row.steps.some((s) => s.key === 'receipt'), 'every journey has a Receipt step');
    }
    for (const row of section.testers.rows) assert.equal(row.steps.at(-1)?.key, 'end');
    for (const row of section.hc.rows) assert.equal(row.steps.at(-1)?.key, 'gate-out', 'every HC vehicle leaves through a gate exit');
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
