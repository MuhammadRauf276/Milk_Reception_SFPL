import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@core/db';
import { getSupplyChainLossHierarchy } from '@/backend/services/lossCalculationService';
import { getSuperAdminDailyReportData } from '@/backend/services/superAdminDailyReportService';
import { QaWarningEscalationService } from '@/backend/services/qaWarningEscalationService';

// Fixtures are committed rows with a unique code, removed in `finally` (nothing is left behind).
const tag = `T-SCALE-${Date.now()}`;

async function cleanup(sourceId: bigint) {
  const visits = await prisma.vehicleVisit.findMany({ where: { procurement_source_id: sourceId }, select: { id: true } });
  const ids = visits.map((v) => v.id);
  await prisma.plantFinalDualReconciliation.deleteMany({ where: { visit_id: { in: ids } } });
  await prisma.siloInventoryTransaction.deleteMany({ where: { visit_id: { in: ids } } });
  await prisma.weightTicket.deleteMany({ where: { visit_id: { in: ids } } });
  await prisma.visitPortion.deleteMany({ where: { visit_id: { in: ids } } });
  await prisma.vehicleVisit.deleteMany({ where: { id: { in: ids } } });
  await prisma.procurementSource.delete({ where: { id: sourceId } });
}

test('loss reconciliation: hand-checked detail rows after the narrower visit select', async () => {
  const silo = await prisma.silo.findFirstOrThrow({ select: { id: true } });
  const src = await prisma.procurementSource.create({ data: { code: tag, name: 'Scale test ZMCC', source_type: 'ZMCC' } });
  try {
    const v1 = await prisma.vehicleVisit.create({
      data: { visit_number: `${tag}-A`, vehicle_number: 'SCALE-A', operational_date: new Date('2031-03-10T00:00:00Z'), procurement_source_id: src.id, vehicle_dispatch_gross_liters: 10000, vehicle_dispatch_at_13ts_liters: 9800, created_at: new Date('2031-03-10T06:00:00Z') },
    });
    const v2 = await prisma.vehicleVisit.create({
      data: {
        visit_number: `${tag}-B`, vehicle_number: 'SCALE-B', raw_milk_dispatch_note_number: `${tag}-NOTE`, operational_date: new Date('2031-03-10T00:00:00Z'), procurement_source_id: src.id,
        vehicle_dispatch_gross_liters: 8000, vehicle_dispatch_at_13ts_liters: 7900, vehicle_dispatch_lr: 28, vehicle_dispatch_fat: 4, created_at: new Date('2031-03-10T09:00:00Z'),
      },
    });
    await prisma.weightTicket.create({ data: { visit_id: v2.id, ticket_number: `${tag}-W`, net_weight_kg: 8200 } });
    const tx = await prisma.siloInventoryTransaction.create({
      data: { silo_id: silo.id, transaction_type: 'RECEIPT', quantity_liters: 7920, operational_timestamp: new Date('2031-03-10T12:00:00Z'), visit_id: v2.id },
    });
    await prisma.plantFinalDualReconciliation.create({
      data: { visit_id: v2.id, final_receipt_transaction_id: tx.id, received_gross_liters: 7920, received_at_13ts_liters: 7800, reconciled_at: new Date('2031-03-10T12:00:00Z') },
    });

    const r = await getSupplyChainLossHierarchy({ period: 'custom', from: '2031-03-01', to: '2031-03-31', zmccId: src.id });
    assert.equal(r.details.length, 2);
    const [first, second] = r.details; // newest created_at first
    assert.equal(first.vehicleNumber, 'SCALE-B');
    assert.equal(first.referenceNumber, `${tag}-NOTE`);
    assert.equal(first.dispatchedGrossLiters, 8000);
    assert.equal(first.plantNetKg, 8200);
    assert.equal(first.plantAcceptedLiters, 7920);
    assert.equal(first.transitLossLiters, 80);
    assert.equal(first.transitLossPercent, 1);
    assert.equal(first.isHighTransitLoss, false); // 1.00% is not above 1.0
    assert.equal(first.dispatchLr, 28);
    assert.equal(first.dispatchFat, 4);
    assert.equal(first.zmccName, 'Scale test ZMCC');
    assert.equal(first.zmccCode, tag);
    assert.equal(first.date, '2031-03-10');
    assert.equal(second.vehicleNumber, 'SCALE-A');
    assert.equal(second.referenceNumber, `${tag}-A`);
    assert.equal(second.plantAcceptedLiters, 10000); // no reconciliation yet: falls back to dispatched litres
    assert.equal(second.transitLossLiters, 0);
    assert.equal(second.plantNetKg, 0);
  } finally {
    await cleanup(src.id);
  }
});

test('daily report: the warning-escalation check runs once per source, not once per portion', async () => {
  const src = await prisma.procurementSource.create({ data: { code: `${tag}-D`, name: 'Scale daily ZMCC', source_type: 'ZMCC' } });
  const original = QaWarningEscalationService.evaluateWarningEscalation;
  let calls = 0;
  QaWarningEscalationService.evaluateWarningEscalation = function (...args: Parameters<typeof original>) {
    calls++;
    return original.apply(this, args);
  };
  try {
    const visit = await prisma.vehicleVisit.create({
      data: { visit_number: `${tag}-D1`, vehicle_number: 'SCALE-D', operational_date: new Date('2031-03-11T00:00:00Z'), procurement_source_id: src.id, vehicle_dispatch_gross_liters: 6000 },
    });
    for (const n of [1, 2, 3]) {
      await prisma.visitPortion.create({ data: { visit_id: visit.id, portion_number: n, plant_decision: 'ACCEPTED', dispatch_quantity_value: 2000, plant_decided_at: new Date('2031-03-11T08:00:00Z') } });
    }
    const report = await getSuperAdminDailyReportData({ date: '2031-03-11', zmccId: src.id.toString() });
    const rows = JSON.parse(JSON.stringify(report)).plantQa?.visits ?? JSON.parse(JSON.stringify(report)).plantQaVisits ?? [];
    assert.ok(Array.isArray(rows));
    const mine = rows.filter((x: { vehicleNumber: string }) => x.vehicleNumber === 'SCALE-D');
    assert.equal(mine.length, 3, 'all three portions are still listed');
    assert.equal(new Set(mine.map((x: { mtdThreshold: number }) => x.mtdThreshold)).size, 1);
    assert.equal(calls, 1, 'one check for the shared source, warning flag and role');
  } finally {
    QaWarningEscalationService.evaluateWarningEscalation = original;
    await cleanup(src.id);
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
