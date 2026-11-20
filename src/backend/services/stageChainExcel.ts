/**
 * Excel for the Stage by stage report: the view on screen (period, date basis, ZMCCs) as a workbook.
 * Sheets: Summary, Per ZMCC, Per day, ZMCC per day, Tank fills. Same header look as the Loss / Gain export.
 */
import ExcelJS from 'exceljs';
import type { StageChainReport, StageHcRow, StageMotRow, StagePair, StageTotal } from '@/backend/modules/management-reporting/stageChainContracts';

type Col = { header: string; key: string; width: number; fmt?: string };
type Row = Record<string, string | number | boolean | null | undefined>;

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
const SUB_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
const L2 = '#,##0.00';
const TS = '0.00';

function sheet(wb: ExcelJS.Workbook, name: string, title: string, columns: Col[], rows: Row[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 2 }] });
  ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));
  ws.addRow([title]).font = { name: 'Segoe UI', bold: true, size: 12 };
  const head = ws.addRow(columns.map((c) => c.header));
  head.height = 30;
  head.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  for (const r of rows) {
    const { __bold, ...values } = r;
    const row = ws.addRow(columns.map((c) => (values[c.key] ?? null) as ExcelJS.CellValue));
    columns.forEach((c, i) => {
      if (c.fmt) row.getCell(i + 1).numFmt = c.fmt;
    });
    if (__bold) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: 'Segoe UI', bold: true, size: 11 };
        cell.fill = SUB_FILL;
      });
    }
  }
}

const intakeOf = (r: Pick<StageTotal, 'receivedMot' | 'receivedHc' | 'receivedOther'>): StagePair => ({
  liters: r.receivedMot.liters + r.receivedHc.liters + r.receivedOther.liters,
  at13ts: r.receivedMot.at13ts + r.receivedHc.at13ts + r.receivedOther.at13ts,
});
const tsOf = (p: StagePair) => (p.liters > 0 ? (p.at13ts * 13) / p.liters : null);
const pct = (now: number, before: number) => (before ? ((now - before) / Math.abs(before)) * 100 : null);

export async function generateStageChainExcel(
  report: StageChainReport,
  filterText: string,
  drill?: { testers: StageMotRow[]; routes: StageMotRow[]; hcSuppliers: StageHcRow[] }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Milk Reception & Process Management';
  wb.created = new Date();
  const basis = report.basis === 'business' ? 'Business day (08:00 to 08:00)' : 'Calendar day';
  const title = `${report.from} to ${report.to} · ${report.days} days · ${basis} · ${filterText}`;
  const t = report.total;
  const p = report.previous.total;

  // Summary: each stage with LPD and the change against the period before; then loss/gain.
  const stageRows: Array<[string, StagePair, StagePair, number | null]> = [
    ['Shops (Mobile Testers)', t.shops, p.shops, tsOf(t.shops)],
    ['ZMCC intake (Mobile Tester + HC)', intakeOf(t), intakeOf(p), t.ts.intake],
    ['  from Mobile Testers', t.receivedMot, p.receivedMot, tsOf(t.receivedMot)],
    ['  from HC suppliers', t.receivedHc, p.receivedHc, tsOf(t.receivedHc)],
    ...(t.receivedOther.liters || p.receivedOther.liters
      ? ([['  other tank receipts', t.receivedOther, p.receivedOther, tsOf(t.receivedOther)]] as Array<[string, StagePair, StagePair, number | null]>)
      : []),
    ['ZMCC dispatch', t.dispatchSlip, p.dispatchSlip, t.ts.slip],
    ['Plant received', t.plant, p.plant, t.ts.plant],
  ];
  const summary: Row[] = stageRows.map(([name, now, before, ts]) => ({
    part: name,
    liters: now.liters,
    at13: now.at13ts,
    ts,
    lpd: report.days ? now.liters / report.days : null,
    before: before.liters,
    change: pct(now.liters, before.liters),
  }));
  summary.push({});
  summary.push({ part: 'Loss / gain (later stage minus earlier; minus = loss)', __bold: true });
  summary.push({ part: 'Tester trip (journeys that reached the ZMCC: received minus shops)', liters: t.loss.motTrip.liters, at13: t.loss.motTrip.at13ts });
  summary.push({ part: 'Dispatch overstated (ZMCC dispatch claims more @13 TS than the milk had; not milk)', at13: t.loss.slipOver13ts });
  summary.push({ part: 'Road (plant minus what really left the ZMCC)', liters: t.loss.road.liters, at13: t.loss.road.at13ts });
  summary.push({ part: 'Trip + road (finished vehicles; not the Whole card)', liters: t.loss.whole.liters, at13: t.loss.whole.at13ts, before: p.loss.whole.at13ts, __bold: true });
  summary.push({});
  summary.push({ part: `Dispatches with dispatch TS above the tank milk: ${t.slipHighCycles} of ${t.cycleCount}` });
  summary.push({ part: `Tankers not yet at the plant (left out of plant, road, whole): ${t.pendingTankers}` });
  summary.push({ part: `Previous period for comparison: ${report.previous.from} to ${report.previous.to}` });
  sheet(
    wb,
    'Summary',
    title,
    [
      { header: 'Stage', key: 'part', width: 58 },
      { header: 'Litres', key: 'liters', width: 16, fmt: L2 },
      { header: '@13 TS litres', key: 'at13', width: 16, fmt: L2 },
      { header: 'TS', key: 'ts', width: 9, fmt: TS },
      { header: 'LPD (litres per day)', key: 'lpd', width: 16, fmt: L2 },
      { header: 'Previous period litres', key: 'before', width: 18, fmt: L2 },
      { header: 'Change %', key: 'change', width: 11, fmt: '0.0' },
    ],
    summary
  );

  // Per ZMCC.
  const perZmcc: Row[] = report.zmccs.map((z) => ({
    zmcc: z.zmccName,
    shopsL: z.shops.liters, shops13: z.shops.at13ts,
    inL: intakeOf(z).liters, in13: intakeOf(z).at13ts, mc13: z.receivedMot.at13ts, hc13: z.receivedHc.at13ts, other13: z.receivedOther.at13ts,
    adminIn13: z.adminIn.at13ts, adminOut13: z.adminOut.at13ts,
    inLpd: report.days ? intakeOf(z).liters / report.days : null,
    slipL: z.dispatchSlip.liters, slip13: z.dispatchSlip.at13ts,
    plantL: z.plant.liters, plant13: z.plant.at13ts,
    tsIn: z.ts.intake, tsSlip: z.ts.slip, tsPlant: z.ts.plant,
    trip: z.loss.motTrip.at13ts, onWay13: z.shopsOnWay.at13ts, over: z.loss.slipOver13ts, road: z.loss.road.at13ts, roadL: z.loss.road.liters,
    roadSlip: z.loss.roadVsSlip.at13ts, whole: z.loss.whole.at13ts,
    tankEnd: z.tankEnd.liters, pending: z.pendingTankers,
  }));
  const zmccCols: Col[] = [
    { header: 'ZMCC', key: 'zmcc', width: 22 },
    { header: 'Shops litres', key: 'shopsL', width: 14, fmt: L2 },
    { header: 'Shops @13 TS', key: 'shops13', width: 14, fmt: L2 },
    { header: 'Intake litres', key: 'inL', width: 14, fmt: L2 },
    { header: 'Intake @13 TS', key: 'in13', width: 14, fmt: L2 },
    { header: 'MC intake @13 TS', key: 'mc13', width: 14, fmt: L2 },
    { header: 'HC intake @13 TS', key: 'hc13', width: 14, fmt: L2 },
    { header: 'Other receipts @13 TS', key: 'other13', width: 14, fmt: L2 },
    { header: 'Admin added @13 TS', key: 'adminIn13', width: 14, fmt: L2 },
    { header: 'Admin removed @13 TS', key: 'adminOut13', width: 14, fmt: L2 },
    { header: 'Intake LPD (litres)', key: 'inLpd', width: 12, fmt: L2 },
    { header: 'Dispatch litres', key: 'slipL', width: 14, fmt: L2 },
    { header: 'Dispatch @13 TS', key: 'slip13', width: 14, fmt: L2 },
    { header: 'Plant litres', key: 'plantL', width: 14, fmt: L2 },
    { header: 'Plant @13 TS', key: 'plant13', width: 14, fmt: L2 },
    { header: 'TS intake', key: 'tsIn', width: 10, fmt: TS },
    { header: 'TS dispatch', key: 'tsSlip', width: 10, fmt: TS },
    { header: 'TS plant', key: 'tsPlant', width: 10, fmt: TS },
    { header: 'Tester trip @13 TS', key: 'trip', width: 14, fmt: L2 },
    { header: 'Shops not at ZMCC yet @13 TS', key: 'onWay13', width: 16, fmt: L2 },
    { header: 'Dispatch overstated @13 TS', key: 'over', width: 16, fmt: L2 },
    { header: 'Road @13 TS', key: 'road', width: 13, fmt: L2 },
    { header: 'Road litres', key: 'roadL', width: 12, fmt: L2 },
    { header: 'Road against slip @13 TS', key: 'roadSlip', width: 14, fmt: L2 },
    { header: 'Trip + road @13 TS', key: 'whole', width: 13, fmt: L2 },
    { header: 'Tank at end', key: 'tankEnd', width: 12, fmt: L2 },
    { header: 'Not at plant', key: 'pending', width: 11 },
  ];
  sheet(wb, 'Per ZMCC', title, zmccCols, perZmcc);

  // Per day, all ZMCCs together; and each ZMCC by day.
  const dayCols: Col[] = [
    { header: 'Day', key: 'day', width: 12 },
    { header: 'ZMCC', key: 'zmcc', width: 22 },
    { header: 'Shops @13 TS', key: 'shops', width: 14, fmt: L2 },
    { header: 'Intake litres', key: 'inL', width: 14, fmt: L2 },
    { header: 'Intake @13 TS', key: 'in13', width: 14, fmt: L2 },
    { header: 'MC intake @13 TS', key: 'mc13', width: 14, fmt: L2 },
    { header: 'HC intake @13 TS', key: 'hc13', width: 14, fmt: L2 },
    { header: 'Dispatch litres', key: 'slipL', width: 14, fmt: L2 },
    { header: 'Dispatch @13 TS', key: 'slip13', width: 14, fmt: L2 },
    { header: 'Plant litres', key: 'plantL', width: 14, fmt: L2 },
    { header: 'Plant @13 TS', key: 'plant13', width: 14, fmt: L2 },
    { header: 'TS intake', key: 'tsIn', width: 10, fmt: TS },
    { header: 'TS dispatch', key: 'tsSlip', width: 10, fmt: TS },
    { header: 'TS plant', key: 'tsPlant', width: 10, fmt: TS },
    { header: 'Dispatch overstated @13 TS', key: 'over', width: 16, fmt: L2 },
    { header: 'Road @13 TS', key: 'road', width: 13, fmt: L2 },
  ];
  const dayRow = (zmcc: string, d: StageChainReport['daily'][number]): Row => ({
    day: d.day, zmcc,
    shops: d.shops.at13ts, inL: d.intake.liters, in13: d.intake.at13ts, mc13: d.intakeMc.at13ts, hc13: d.intakeHc.at13ts + d.intakeOther.at13ts, slipL: d.dispatchSlip.liters, slip13: d.dispatchSlip.at13ts,
    plantL: d.plant.liters, plant13: d.plant.at13ts, tsIn: d.ts.intake, tsSlip: d.ts.slip, tsPlant: d.ts.plant,
    over: d.slipOver13ts, road: d.plant.liters ? d.road.at13ts : null,
  });
  sheet(wb, 'Per day', title, dayCols, report.daily.map((d) => dayRow('All', d)));
  sheet(
    wb,
    'ZMCC per day',
    title,
    dayCols,
    report.zmccs.flatMap((z) => z.daily.filter((d) => d.shops.liters || d.intake.liters || d.dispatchSlip.liters).map((d) => dayRow(z.zmccName, d)))
  );

  // Tank fills: every tank fill and its dispatch.
  const fills: Row[] = report.zmccs.flatMap((z) =>
    z.cycles.map((c) => ({
      zmcc: z.zmccName, day: c.day, tank: c.tankCode, tankers: c.tankers.map((x) => x.vehicleNumber ?? x.visitNumber).join(' + '),
      visits: c.tankers.map((x) => x.visitNumber ?? '').join(' + '),
      open: c.opening.liters, inL: c.intake.liters, in13: c.intake.at13ts, slipL: c.dispatchSlip.liters, slip13: c.dispatchSlip.at13ts,
      true13: c.dispatchTrue13ts, plantL: c.plant?.liters ?? null, plant13: c.plant?.at13ts ?? null, left: c.leftInTank.liters,
      tsTank: c.ts.tank, tsSlip: c.ts.slip, tsPlant: c.ts.plant, over: c.slipOver13ts, road: c.road?.at13ts ?? null, roadL: c.road?.liters ?? null,
    }))
  );
  sheet(
    wb,
    'Tank fills',
    title,
    [
      { header: 'ZMCC', key: 'zmcc', width: 20 },
      { header: 'Day', key: 'day', width: 12 },
      { header: 'Tank', key: 'tank', width: 10 },
      { header: 'Tanker', key: 'tankers', width: 18 },
      { header: 'Visit', key: 'visits', width: 20 },
      { header: 'Tank at start', key: 'open', width: 13, fmt: L2 },
      { header: 'Intake litres', key: 'inL', width: 13, fmt: L2 },
      { header: 'Intake @13 TS', key: 'in13', width: 13, fmt: L2 },
      { header: 'Dispatch litres', key: 'slipL', width: 13, fmt: L2 },
      { header: 'Dispatch @13 TS', key: 'slip13', width: 13, fmt: L2 },
      { header: 'True @13 TS (tank quality)', key: 'true13', width: 15, fmt: L2 },
      { header: 'Plant litres', key: 'plantL', width: 13, fmt: L2 },
      { header: 'Plant @13 TS', key: 'plant13', width: 13, fmt: L2 },
      { header: 'Left in tank', key: 'left', width: 12, fmt: L2 },
      { header: 'TS tank', key: 'tsTank', width: 9, fmt: TS },
      { header: 'TS dispatch', key: 'tsSlip', width: 10, fmt: TS },
      { header: 'TS plant', key: 'tsPlant', width: 9, fmt: TS },
      { header: 'Dispatch overstated @13 TS', key: 'over', width: 16, fmt: L2 },
      { header: 'Road @13 TS', key: 'road', width: 12, fmt: L2 },
      { header: 'Road litres', key: 'roadL', width: 12, fmt: L2 },
    ],
    fills
  );

  // Each tanker on its own row.
  const tankers: Row[] = report.zmccs.flatMap((z) =>
    z.cycles.flatMap((c) =>
      c.tankers.map((t) => ({
        zmcc: z.zmccName, day: c.day, tanker: t.vehicleNumber ?? '', visit: t.visitNumber ?? '',
        dL: t.dispatch.liters, d13: t.dispatch.at13ts, true13: t.dispatchTrue13ts,
        pL: t.plant?.liters ?? null, p13: t.plant?.at13ts ?? null,
        tsTank: c.ts.tank, tsD: t.ts.dispatch, tsP: t.ts.plant,
        over: t.overstated13ts, roadL: t.road?.liters ?? null, road: t.road?.at13ts ?? null,
      }))
    )
  );
  sheet(
    wb,
    'Tankers',
    title,
    [
      { header: 'ZMCC', key: 'zmcc', width: 20 },
      { header: 'Day', key: 'day', width: 12 },
      { header: 'Tanker', key: 'tanker', width: 14 },
      { header: 'Visit', key: 'visit', width: 20 },
      { header: 'Dispatch litres', key: 'dL', width: 14, fmt: L2 },
      { header: 'Dispatch @13 TS', key: 'd13', width: 14, fmt: L2 },
      { header: 'True @13 TS (tank quality)', key: 'true13', width: 15, fmt: L2 },
      { header: 'Plant litres', key: 'pL', width: 13, fmt: L2 },
      { header: 'Plant @13 TS', key: 'p13', width: 13, fmt: L2 },
      { header: 'TS tank', key: 'tsTank', width: 9, fmt: TS },
      { header: 'TS dispatch', key: 'tsD', width: 10, fmt: TS },
      { header: 'TS plant', key: 'tsP', width: 9, fmt: TS },
      { header: 'Dispatch overstated @13 TS', key: 'over', width: 16, fmt: L2 },
      { header: 'Road litres', key: 'roadL', width: 12, fmt: L2 },
      { header: 'Road @13 TS', key: 'road', width: 12, fmt: L2 },
    ],
    tankers
  );

  if (drill) {
    const motCols = (first: string): Col[] => [
      { header: first, key: 'name', width: 26 },
      { header: 'Code', key: 'code', width: 14 },
      { header: 'ZMCC', key: 'zmcc', width: 18 },
      { header: 'Journeys', key: 'journeys', width: 10 },
      { header: 'Not yet at ZMCC', key: 'open', width: 12 },
      { header: 'Shops', key: 'shops', width: 8 },
      { header: 'Rejected shops', key: 'rejected', width: 10 },
      { header: 'Collected litres', key: 'cL', width: 14, fmt: L2 },
      { header: 'Collected @13 TS', key: 'c13', width: 14, fmt: L2 },
      { header: 'Received litres', key: 'rL', width: 14, fmt: L2 },
      { header: 'Received @13 TS', key: 'r13', width: 14, fmt: L2 },
      { header: 'TS shops', key: 'tsC', width: 9, fmt: TS },
      { header: 'TS received', key: 'tsR', width: 10, fmt: TS },
      { header: 'Trip litres (arrived journeys)', key: 'tL', width: 14, fmt: L2 },
      { header: 'Trip @13 TS', key: 't13', width: 12, fmt: L2 },
      { header: 'Trip %', key: 'tPct', width: 9, fmt: '0.00' },
    ];
    const motRow = (r: StageMotRow): Row => ({
      name: r.name, code: r.code ?? '', zmcc: r.zmccName, journeys: r.journeys, open: r.notArrived, shops: r.shops, rejected: r.rejectedShops,
      cL: r.collected.liters, c13: r.collected.at13ts, rL: r.received.liters, r13: r.received.at13ts,
      tsC: r.ts.collected, tsR: r.ts.received, tL: r.trip.liters, t13: r.trip.at13ts,
      tPct: r.received.at13ts && r.received.at13ts - r.trip.at13ts ? (r.trip.at13ts / (r.received.at13ts - r.trip.at13ts)) * 100 : null,
    });
    sheet(wb, 'Mobile Testers', `${title} · by journey date`, motCols('Mobile Tester'), drill.testers.map(motRow));
    sheet(wb, 'Routes', `${title} · by journey date`, motCols('Route'), drill.routes.map(motRow));
    sheet(
      wb,
      'HC suppliers',
      title,
      [
        { header: 'HC supplier', key: 'name', width: 30 },
        { header: 'Code', key: 'code', width: 14 },
        { header: 'ZMCC', key: 'zmcc', width: 18 },
        { header: 'Arrivals', key: 'arrivals', width: 10 },
        { header: 'Accepted', key: 'accepted', width: 10 },
        { header: 'Rejected', key: 'rejected', width: 10 },
        { header: 'Left early', key: 'left', width: 10 },
        { header: 'Received litres', key: 'rL', width: 14, fmt: L2 },
        { header: 'Received @13 TS', key: 'r13', width: 14, fmt: L2 },
        { header: 'TS', key: 'ts', width: 8, fmt: TS },
      ],
      drill.hcSuppliers.map((r) => ({
        name: r.name, code: r.code ?? '', zmcc: r.zmccName, arrivals: r.arrivals, accepted: r.accepted, rejected: r.rejected,
        left: r.leftEarly, rL: r.received.liters, r13: r.received.at13ts, ts: r.ts,
      }))
    );
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
