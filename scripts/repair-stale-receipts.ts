/**
 * Repairs plant receipts saved before a weight correction (corrections made before 11 Nov did not update them).
 * For each tanker whose silo receipt weight differs from its weighbridge ticket by more than 5 kg, it runs the app's own
 * recalculation (the same one every weight correction now uses): silo receipt, silo stock and reconciliation.
 *
 *   Show only (changes nothing):  npx tsx --env-file=.env scripts/repair-stale-receipts.ts
 *   Apply:                        npx tsx --env-file=.env scripts/repair-stale-receipts.ts --apply
 *
 * Each repaired tanker gets an audit row (vehicle_visit, FINAL_RECEIPT_RECALCULATED) with the old and new figures.
 */
import { prisma } from '@core/db';
import { recomputeFinalReceiptTx } from '@/backend/services/siloInventoryService';
import { writeAuditLog } from '@/backend/core/audit';

const APPLY = process.argv.includes('--apply');

class DryRun extends Error {}

type Figures = { kg: number; liters: number; at13: number; reportLiters: number | null; reportAt13: number | null };

async function figures(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], visitId: bigint): Promise<Figures> {
  const r = await tx.siloInventoryTransaction.aggregate({
    where: { visit_id: visitId, transaction_type: 'RECEIPT' },
    _sum: { quantity_kg: true, quantity_liters: true, plant_final_at_13ts_liters: true },
  });
  const fdr = await tx.plantFinalDualReconciliation.findUnique({ where: { visit_id: visitId } });
  return {
    kg: Number(r._sum.quantity_kg ?? 0),
    liters: Number(r._sum.quantity_liters ?? 0),
    at13: Number(r._sum.plant_final_at_13ts_liters ?? 0),
    reportLiters: fdr?.received_gross_liters != null ? Number(fdr.received_gross_liters) : null,
    reportAt13: fdr?.received_at_13ts_liters != null ? Number(fdr.received_at_13ts_liters) : null,
  };
}

const f = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 2 }));

async function main() {
  const stale = await prisma.$queryRaw<Array<{ id: bigint; visit_number: string | null; vehicle_number: string; net: number }>>`
    SELECT v.id, v.visit_number, v.vehicle_number, (wt.gross_weight_kg - wt.tare_weight_kg)::float8 AS net
    FROM vehicle_visit v
    JOIN weight_ticket wt ON wt.visit_id = v.id
    JOIN (SELECT visit_id, SUM(quantity_kg) AS kg FROM silo_inventory_transaction
          WHERE transaction_type::text = 'RECEIPT' AND visit_id IS NOT NULL GROUP BY visit_id) r ON r.visit_id = v.id
    WHERE wt.gross_weight_kg IS NOT NULL AND wt.tare_weight_kg IS NOT NULL
      AND ABS((wt.gross_weight_kg - wt.tare_weight_kg) - r.kg) > 5
    ORDER BY v.id`;

  console.log(`${APPLY ? 'APPLYING' : 'SHOW ONLY (nothing is changed)'}: ${stale.length} tanker(s) whose receipt differs from the ticket.\n`);
  let done = 0;
  for (const v of stale) {
    const label = `${v.visit_number ?? v.id} ${v.vehicle_number} (ticket net ${f(v.net)} kg)`;
    try {
      await prisma.$transaction(async (tx) => {
        const before = await figures(tx, v.id);
        await recomputeFinalReceiptTx(tx, v.id);
        const after = await figures(tx, v.id);
        console.log(label);
        console.log(`  receipt kg      ${f(before.kg)}  ->  ${f(after.kg)}`);
        console.log(`  receipt litres  ${f(before.liters)}  ->  ${f(after.liters)}`);
        console.log(`  receipt @13 TS  ${f(before.at13)}  ->  ${f(after.at13)}`);
        console.log(`  report litres   ${f(before.reportLiters)}  ->  ${f(after.reportLiters)}`);
        console.log(`  report @13 TS   ${f(before.reportAt13)}  ->  ${f(after.reportAt13)}`);
        if (!APPLY) throw new DryRun();
        await writeAuditLog(tx, {
          tableName: 'vehicle_visit',
          recordId: v.id,
          action: 'FINAL_RECEIPT_RECALCULATED',
          oldValues: before,
          newValues: { ...after, reason: 'Receipt saved before a weight correction; recalculated from the corrected weighbridge ticket.' },
          actor: { userId: null, actorRole: 'SYSTEM_REPAIR' },
        });
      }, { timeout: 30_000 });
      done++;
      console.log('  repaired.\n');
    } catch (err) {
      if (err instanceof DryRun) {
        console.log('  (shown only, undone)\n');
        continue;
      }
      console.log(`${label}\n  NOT repaired: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  console.log(APPLY ? `Done: ${done} of ${stale.length} repaired.` : 'Nothing was changed. Run again with --apply to repair.');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Repair failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
