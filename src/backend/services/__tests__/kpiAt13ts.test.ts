import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { getZmccHierarchyReport } from '@/backend/services/zmccReportsService';
import { getLabHistory } from '@/backend/services/zmccLabService';
import {
  computeContractorHistoryMetrics,
  computeContractorOverview,
  computeContractorReceiptsMetrics,
} from '@/frontend/modules/dashboard/contractor/contractorManagerHelpers';
import type { ContractorVehicleVisit } from '@/frontend/modules/dashboard/contractor/contractorManagerTypes';

const visit = (over: Partial<ContractorVehicleVisit>): ContractorVehicleVisit =>
  ({
    grossLiters: 1000,
    status: 'COMPLETED',
    journeyStage: 'COMPLETED',
    gateEntryTimestamp: null,
    secondWeightTimestamp: null,
    finalReceiptExists: true,
    authoritativeFinalLiters: 990,
    litersVariance: -10,
    dispatch13TsLiters: 950,
    plantFinalAt13TsLiters: 940,
    at13TsVarianceLiters: -10,
    ...over,
  }) as ContractorVehicleVisit;

test('contractor metrics total received @13 TS and count receipts without a figure', () => {
  const visits = [visit({}), visit({ plantFinalAt13TsLiters: 100 }), visit({ plantFinalAt13TsLiters: null, dispatch13TsLiters: null, at13TsVarianceLiters: null })];
  const o = computeContractorOverview(visits);
  assert.equal(o.totalReceivedAt13TsLiters, 1040);
  assert.equal(o.receivedMissingAt13Ts, 1);
  assert.equal(o.totalReceivedLiters, 2970);
  const r = computeContractorReceiptsMetrics(visits);
  assert.equal(r.totalAuthoritativeReceivedAt13TsLiters, 1040);
  assert.equal(r.totalDispatchedAt13TsLiters, 1900);
  assert.equal(r.dispatchedMissingAt13Ts, 1);
  assert.equal(r.netAt13TsVariance, -20);
  const h = computeContractorHistoryMetrics(visits);
  assert.equal(h.totalReceivedAt13TsLiters, 1040);
  assert.equal(h.receivedMissingAt13Ts, 1);
  assert.equal(h.netAt13TsVariance, -20);
});

test('contractor @13 TS net variance is null when no receipt has one', () => {
  const h = computeContractorHistoryMetrics([visit({ at13TsVarianceLiters: null })]);
  assert.equal(h.netAt13TsVariance, null);
});

test('ZMCC hierarchy Today intake @13 TS equals the database sum for the shown shops', async () => {
  const row = await prisma.motShopCollection.findFirst({ orderBy: { operational_date: 'desc' }, select: { zmcc_id: true, operational_date: true } });
  if (!row || !row.operational_date) return;
  const date = row.operational_date.toISOString().slice(0, 10);
  const report = (await getZmccHierarchyReport(row.zmcc_id, date)) as Awaited<ReturnType<typeof getZmccHierarchyReport>> & { summary: { todayIntakeAt13TsLiters: number; todayIntakeMissingAt13Ts: number; todayIntakeLiters: number }; routes: Array<{ areas: Array<{ shops: Array<{ id: string }> }> }> };
  const shopIds = report.routes.flatMap((r) => r.areas.flatMap((a) => a.shops.map((s) => BigInt(s.id))));
  const agg = await prisma.motShopCollection.aggregate({
    where: { zmcc_id: row.zmcc_id, operational_date: row.operational_date, shop_id: { in: shopIds } },
    _sum: { at_13ts_liters: true, gross_liters: true },
  });
  assert.equal(report.summary.todayIntakeAt13TsLiters, Number(Number(agg._sum.at_13ts_liters ?? 0).toFixed(2)));
  assert.equal(report.summary.todayIntakeLiters, Number(Number(agg._sum.gross_liters ?? 0).toFixed(2)));
  assert.equal(typeof report.summary.todayIntakeMissingAt13Ts, 'number');
});

test('lab history summary carries @13 TS total and the count without tests, matching the database', async () => {
  const user = await prisma.user.findFirst({ where: { is_active: true, role: 'ZMCC_MANAGER' } });
  if (!user) return;
  const res = (await getLabHistory(user as never, { pageSize: 1 })) as { status: number; data?: { summary: { totalGrossLiters: number | null; totalAt13TsLiters: number | null; missingAt13TsCount: number } } };
  if (res.status !== 200 || !res.data) return;
  const where = { status: 'COMPLETED' as const, zmcc_id: (user as unknown as { procurement_source_id: bigint }).procurement_source_id };
  const agg = await prisma.zmccLabSession.aggregate({ where, _sum: { gross_liters: true, at_13ts_liters: true } });
  const missing = await prisma.zmccLabSession.count({ where: { ...where, at_13ts_liters: null, gross_liters: { not: null } } });
  assert.equal(res.data.summary.totalAt13TsLiters, agg._sum.at_13ts_liters != null ? Number(agg._sum.at_13ts_liters) : null);
  assert.equal(res.data.summary.totalGrossLiters, agg._sum.gross_liters != null ? Number(agg._sum.gross_liters) : null);
  assert.equal(res.data.summary.missingAt13TsCount, missing);
});
