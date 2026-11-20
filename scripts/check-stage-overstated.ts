/**
 * Read-only: shows, fill by fill, how "Dispatch overstated" is worked out for a ZMCC and a date range, with the
 * same code the screens use. Changes nothing.
 *
 * Run on the VM:
 *   npx tsx --env-file=.env scripts/check-stage-overstated.ts "ZMCC Hasilpur" 2026-11-17 2026-11-17 > overstated.txt
 *
 * For each tank fill: milk already in the tank, what came in, admin +/-, the tank milk TS, what the slips say,
 * the same litres at the tank TS ("true"), the difference (overstated), and plant / road.
 */
import { prisma } from '@core/db';
import { getZmccStageChain } from '@/backend/services/zmccStageChainService';

const f0 = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const f2 = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2));
const ts = (l: number, a13: number) => (l > 0 ? ((a13 * 13) / l).toFixed(2) : '—');

function table(rows: Array<Record<string, string>>): string {
  if (!rows.length) return '  (none)';
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => r[c].length)));
  const line = (v: string[]) => '  ' + v.map((x, i) => (i < 2 ? x.padEnd(w[i]) : x.padStart(w[i]))).join('  ');
  return [line(cols), line(w.map((n) => '-'.repeat(n))), ...rows.map((r) => line(cols.map((c) => r[c])))].join('\n');
}

(async () => {
  const [name, from, to] = process.argv.slice(2);
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? '')) {
    console.error('Usage: npx tsx --env-file=.env scripts/check-stage-overstated.ts "ZMCC Hasilpur" 2026-11-17 2026-11-17');
    process.exit(1);
  }
  const zmcc = await prisma.procurementSource.findFirst({ where: { source_type: 'ZMCC', name: { equals: name, mode: 'insensitive' } }, select: { id: true, name: true } });
  if (!zmcc) {
    console.error(`No ZMCC named "${name}".`);
    process.exit(1);
  }
  const report = await getZmccStageChain({ from, to, zmccIds: [zmcc.id.toString()], basis: 'calendar' });
  const z = report.zmccs[0];
  console.log(`${zmcc.name}, ${from} to ${to} (calendar days). Litres as measured and @13 TS litres.\n`);
  if (!z) {
    console.log('No tank fills dispatched in these days.');
    process.exit(0);
  }
  console.log('Totals of the days:');
  console.log(`  MC intake ${f0(z.receivedMot.at13ts)} · HC intake ${f0(z.receivedHc.at13ts)} · Other ${f0(z.receivedOther.at13ts)} · Admin added ${f0(z.adminIn.at13ts)} · Admin removed ${f0(z.adminOut.at13ts)}  (@13 TS, by the day received)`);
  console.log(`  Dispatched (slips) ${f0(z.dispatchSlip.liters)} L, ${f0(z.dispatchSlip.at13ts)} @13 TS · same litres at the tank TS ${f0(z.dispatchTrue13ts)} @13 TS`);
  console.log(`  Dispatch overstated ${f2(z.loss.slipOver13ts)} @13 TS · Plant ${f0(z.plant.at13ts)} @13 TS · Road ${f2(z.loss.road.at13ts)} · Road against slip ${f2(z.loss.roadVsSlip.at13ts)}\n`);

  console.log('Fill by fill (a fill = the milk in the tank when one or more tankers were loaded):');
  console.log(
    table(
      z.cycles.map((c) => ({
        day: c.day,
        tankers: c.tankers.length > 2 ? `${c.tankers.length} tankers` : c.tankers.map((t) => t.vehicleNumber ?? t.visitNumber ?? '').join(' + '),
        in_tank_before_L: f0(c.opening.liters),
        before_TS: ts(c.opening.liters, c.opening.at13ts),
        intake_L: f0(c.intake.liters),
        intake_TS: ts(c.intake.liters, c.intake.at13ts),
        admin_L: f0(c.adjustments.liters),
        tank_TS: f2(c.ts.tank),
        slip_L: f0(c.dispatchSlip.liters),
        slip_13: f0(c.dispatchSlip.at13ts),
        slip_TS: f2(c.ts.slip),
        true_13: f0(c.dispatchTrue13ts),
        overstated: f2(c.slipOver13ts),
        plant_13: c.plant ? f0(c.plant.at13ts) : 'pending',
        road_13: c.road ? f2(c.road.at13ts) : '—',
        check: c.overdrawn ? 'MORE OUT THAN IN TANK' : c.lateIntake?.liters ? `entered after dispatch ${f0(c.lateIntake.liters)} L` : '',
      }))
    )
  );
  console.log('\ntrue_13 = slip litres × tank TS / 13.  overstated = slip_13 − true_13.  road = plant − true_13.');
  console.log('A fill counts on the day its last tanker left. Nothing was changed.');
  await prisma.$disconnect();
})();
