import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { listExitQueue } from '@/backend/services/zmccArrival/zmccExitService';
import type { ActingContext } from '@/types/acting';

const SYSTEM: ActingContext = { userId: BigInt(1), actorRole: 'SUPER_ADMIN', actingAs: 'SUPER_ADMIN', isDelegated: false, scope: { kind: 'SYSTEM' } };

test('every HC vehicle still inside with a decided lab test is on the Gate exit list, also after its milk went into the tank', async () => {
  const res = await listExitQueue(SYSTEM);
  assert.equal(res.status, 200);
  const listed = new Set(res.data!.items.filter((i) => i.can_exit).map((i) => i.hc_arrival_id));

  // Same rule written directly in SQL: still inside, lab portions all decided, no close request waiting.
  const expected = await prisma.$queryRawUnsafe<Array<{ id: string; closed: boolean }>>(`
    SELECT h.id::text AS id, (l.journey_closed_at IS NOT NULL) AS closed
    FROM zmcc_local_supplier_arrival h
    JOIN zmcc_lab_session l ON l.local_supplier_arrival_id = h.id
    WHERE h.gate_exit_required AND h.exit_timestamp IS NULL
      AND NOT (l.close_requested_at IS NOT NULL AND l.close_approved_at IS NULL)
      AND EXISTS (SELECT 1 FROM zmcc_lab_portion p WHERE p.lab_session_id = l.id)
      AND NOT EXISTS (SELECT 1 FROM zmcc_lab_portion p WHERE p.lab_session_id = l.id
                      AND (p.final_decision NOT IN ('ACCEPTED','REJECTED') OR p.review_status = 'PENDING'))
    ORDER BY l.created_at LIMIT 200`);
  for (const row of expected) assert.ok(listed.has(row.id), `HC arrival ${row.id} (session closed: ${row.closed}) is missing from Gate exit`);
});

test('an HC vehicle whose lab test is still running can ask to leave without giving milk', async () => {
  const res = await listExitQueue(SYSTEM);
  const byArrival = new Map(res.data!.items.filter((i) => i.hc_arrival_id).map((i) => [i.hc_arrival_id, i]));
  const running = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`
    SELECT h.id::text AS id FROM zmcc_local_supplier_arrival h
    JOIN zmcc_lab_session l ON l.local_supplier_arrival_id = h.id
    WHERE h.gate_exit_required AND h.exit_timestamp IS NULL AND l.status = 'IN_PROGRESS'
      AND l.journey_closed_at IS NULL AND l.close_requested_at IS NULL
    ORDER BY l.created_at LIMIT 200`);
  for (const r of running) {
    const item = byArrival.get(r.id);
    assert.ok(item, `HC arrival ${r.id} with a running lab test is missing from Vehicle exit`);
    assert.equal(item.can_request_close, true);
    assert.equal(item.can_exit, false, 'it cannot leave before the manager approves');
    assert.equal(item.preview_outcome, 'NOT_RECEIVED');
    assert.equal(item.needs_reason, true);
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
