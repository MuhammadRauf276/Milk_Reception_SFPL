import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { resolveEntityRef, type EntityDb } from '@/backend/services/photo/capturedPhotoService';

test('a dispatch lab report photo sent with the visit id is matched to that visit (upload and viewing)', async (t) => {
  const visit = await prisma.vehicleVisit.findFirst({
    where: { procurement_source_id: { not: null } },
    select: { id: true, procurement_source_id: true },
    orderBy: { id: 'desc' },
  });
  if (!visit) return t.skip('needs a dispatched visit');
  const ref = await resolveEntityRef('dispatch_info', visit.id, prisma as unknown as EntityDb);
  assert.ok(ref, 'the record is found, so the upload is not refused as "not found"');
  assert.equal(ref.sourceId, visit.procurement_source_id, 'scoped to the visit source');
});

test.after(async () => {
  await prisma.$disconnect();
});
