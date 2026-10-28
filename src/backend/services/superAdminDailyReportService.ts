import { prisma } from '@core/db';
import ExcelJS from 'exceljs';
import { getSupplyChainLossHierarchy } from '@/backend/services/lossCalculationService';
import { QaWarningEscalationService } from '@/backend/services/qaWarningEscalationService';
import { writeAuditLog } from '@/backend/core/audit';
import type { ActingContext } from '@/types/acting';

export interface DailyReportFilter {
  date: string; // YYYY-MM-DD
  zmccId?: string | number;
}

export interface MotCollectionReportItem {
  id: string;
  collectionNumber: string;
  time: string;
  shopCode: string;
  shopName: string;
  routeCode: string | null;
  motName: string;
  sourceName: string;
  grossLiters: number;
  at13tsLiters: number;
  lr: number;
  fat: number;
  snf: number;
  ts: number;
  verdict: 'ACCEPTED' | 'WARNING' | 'REJECTED';
  warnings: string[];
  remarks: string | null;
  exceptionReasons: string[];
}

export interface ZmccPortionReportItem {
  id: string;
  sessionId: string;
  portionNumber: number;
  arrivalType: 'MC' | 'HC';
  tokenNo: string;
  vehicleNo: string;
  supplierName: string;
  grossLiters: number;
  lr: number | null;
  fat: number | null;
  temperature: number | null;
  verdict: 'ACCEPTED' | 'WARNING' | 'REJECTED';
  warnings: string[];
  remarks: string | null;
  performedByRole: string | null;
  time: string;
}

export interface ExceptionAuditReportItem {
  id: string;
  entityType: 'MOT_SHOP_COLLECTION' | 'ZMCC_LAB_PORTION' | 'PLANT_QA_PORTION';
  referenceNumber: string;
  zmccName: string;
  reason: string;
  submittedBy: string;
  submittedRole: string;
  reviewedBy: string | null;
  reviewedRole: string | null;
  decision: 'APPROVED' | 'REJECTED' | 'PENDING';
  remarks: string | null;
  timestamp: string;
}

export interface PlantQaReportItem {
  id: string;
  visitNumber: string;
  vehicleNumber: string;
  sourceName: string;
  portionNumber: number;
  grossLiters: number;
  mtdWarningCount: number;
  mtdThreshold: number;
  requiresAvpEscalation: boolean;
  verdict: 'ACCEPTED' | 'WARNING' | 'REJECTED';
  warnings: string[];
  decidedBy: string;
  remarks: string | null;
  time: string;
}

export interface DailyReportData {
  date: string;
  generatedAt: string;
  facilityScope: string;
  kpis: {
    mot: {
      totalLiters: number;
      totalCollections: number;
      passedCount: number;
      warningCount: number;
      rejectedCount: number;
      avgLr: number;
      avgFat: number;
      avgSnf: number;
    };
    zmcc: {
      totalLiters: number;
      totalPortions: number;
      passedCount: number;
      warningCount: number;
      rejectedCount: number;
    };
    plantQa: {
      totalTankers: number;
      totalLiters: number;
      acceptedCount: number;
      warningCount: number;
      rejectedCount: number;
      mtdWarningEscalations: number;
    };
    exceptions: {
      totalHandled: number;
      approvedCount: number;
      rejectedCount: number;
      pendingCount: number;
      byRole: Record<string, number>;
    };
    losses: {
      tier1LossLiters: number;
      tier1LossPercent: number;
      tier2LossLiters: number;
      tier2LossPercent: number;
      tier3LossLiters: number;
      tier3LossPercent: number;
    };
  };
  motCollections: MotCollectionReportItem[];
  zmccPortions: ZmccPortionReportItem[];
  exceptions: ExceptionAuditReportItem[];
  plantQaVisits: PlantQaReportItem[];
}

export async function getSuperAdminDailyReportData(filter: DailyReportFilter): Promise<DailyReportData> {
  const targetDateStr = filter.date;
  const startOfDay = new Date(`${targetDateStr}T00:00:00.000Z`);
  const endOfDay = new Date(`${targetDateStr}T23:59:59.999Z`);
  const zmccIdBigInt = filter.zmccId ? BigInt(filter.zmccId) : undefined;

  // 1. MOT Shop Collections
  const motCollectionsRaw = await prisma.motShopCollection.findMany({
    where: {
      operational_date: { gte: startOfDay, lte: endOfDay },
      ...(zmccIdBigInt ? { zmcc_id: zmccIdBigInt } : {}),
    },
    include: {
      journey: {
        include: {
          mot_profile: true,
          route: true,
        },
      },
      stop: true,
      shop: true,
    },
    orderBy: { server_received_at: 'desc' },
  });

  const motCollections: MotCollectionReportItem[] = [];
  let motTotalLiters = 0;
  let motSumLr = 0;
  let motSumFat = 0;
  let motSumSnf = 0;
  let motPassed = 0;
  let motWarnings = 0;
  let motRejected = 0;

  for (const c of motCollectionsRaw) {
    const grossLiters = Number(c.gross_liters || 0);
    const lr = Number(c.lr || 0);
    const fat = Number(c.fat || 0);
    const snf = Number(c.snf || 0);
    const ts = Number(c.ts || 0);
    const at13ts = Number(c.at_13ts_liters || 0);

    const details = c.decision_details as any;
    const warningList: string[] = Array.isArray(details?.warnings) ? details.warnings : [];
    const isWarning = warningList.length > 0;
    const isRejected = c.final_decision === 'REJECTED' || c.person_decision === 'REJECT';

    let verdict: 'ACCEPTED' | 'WARNING' | 'REJECTED' = 'ACCEPTED';
    if (isRejected) {
      verdict = 'REJECTED';
      motRejected++;
    } else if (isWarning) {
      verdict = 'WARNING';
      motWarnings++;
    } else {
      motPassed++;
    }

    motTotalLiters += grossLiters;
    motSumLr += lr * grossLiters;
    motSumFat += fat * grossLiters;
    motSumSnf += snf * grossLiters;

    motCollections.push({
      id: c.id.toString(),
      collectionNumber: c.collection_number,
      time: (c.device_collected_at || c.server_received_at).toISOString().slice(11, 16),
      shopCode: c.stop?.shop_code_snapshot || c.shop?.shop_code || 'SHOP',
      shopName: c.stop?.shop_name_snapshot || c.shop?.shop_name || 'Village Shop',
      routeCode: c.journey?.route?.route_code || null,
      motName: c.journey?.mot_profile?.name || 'Mobile Tester',
      sourceName: c.milk_source_name_snapshot || 'Direct Dairy Supplier',
      grossLiters,
      at13tsLiters: at13ts,
      lr,
      fat,
      snf,
      ts,
      verdict,
      warnings: warningList,
      remarks: c.decision_remarks || c.collection_notes || null,
      exceptionReasons: Array.isArray(c.exception_reasons) ? (c.exception_reasons as string[]) : [],
    });
  }

  // 2. ZMCC Lab Portions
  const zmccPortionsRaw = await prisma.zmccLabPortion.findMany({
    where: {
      created_at: { gte: startOfDay, lte: endOfDay },
      ...(zmccIdBigInt ? { lab_session: { zmcc_id: zmccIdBigInt } } : {}),
    },
    include: {
      lab_session: {
        include: {
          mot_arrival: {
            include: {
              journey: {
                include: { mot_vehicle: true },
              },
            },
          },
          local_supplier_arrival: true,
          zmcc: true,
        },
      },
    },
    orderBy: { portion_number: 'asc' },
  });

  const zmccPortions: ZmccPortionReportItem[] = [];
  let zmccTotalLiters = 0;
  let zmccPassed = 0;
  let zmccWarnings = 0;
  let zmccRejected = 0;

  for (const p of zmccPortionsRaw) {
    const grossLiters = Number(p.gross_liters || p.quantity_value || 0);
    const details = p.decision_details as any;
    const warningList: string[] = Array.isArray(details?.warnings) ? details.warnings : [];
    const isWarning = warningList.length > 0;
    const isRejected = p.final_decision === 'REJECTED' || p.person_decision === 'REJECT';

    let verdict: 'ACCEPTED' | 'WARNING' | 'REJECTED' = 'ACCEPTED';
    if (isRejected) {
      verdict = 'REJECTED';
      zmccRejected++;
    } else if (isWarning) {
      verdict = 'WARNING';
      zmccWarnings++;
    } else {
      zmccPassed++;
    }

    zmccTotalLiters += grossLiters;

    const arrivalType: 'MC' | 'HC' = p.lab_session?.arrival_type === 'LOCAL_SUPPLIER' ? 'HC' : 'MC';
    const tokenNo =
      p.lab_session?.mot_arrival?.zmcc_token ||
      p.lab_session?.local_supplier_arrival?.rmr_number ||
      p.lab_session?.local_supplier_arrival?.raw_milk_token_number ||
      `S-${p.lab_session_id}`;
    const vehicleNo =
      p.lab_session?.mot_arrival?.journey?.mot_vehicle?.vehicle_number ||
      p.lab_session?.local_supplier_arrival?.vehicle_number ||
      'TRUCK';
    const supplierName = p.lab_session?.zmcc?.name || 'Procurement Center';

    let tempValue: number | null = null;
    if (Array.isArray(details?.tests)) {
      const tempTest = details.tests.find((t: any) => /TEMP/i.test(t.testCode || t.testName));
      if (tempTest && tempTest.value !== null) tempValue = Number(tempTest.value);
    }

    zmccPortions.push({
      id: p.id.toString(),
      sessionId: p.lab_session_id.toString(),
      portionNumber: p.portion_number,
      arrivalType,
      tokenNo,
      vehicleNo,
      supplierName,
      grossLiters,
      lr: p.lr !== null ? Number(p.lr) : null,
      fat: p.fat !== null ? Number(p.fat) : null,
      temperature: tempValue,
      verdict,
      warnings: warningList,
      remarks: p.decision_remarks || null,
      performedByRole: p.performed_as_role || 'ZMCC_LAB_ATTENDANT',
      time: p.decided_at ? p.decided_at.toISOString().slice(11, 16) : '—',
    });
  }

  // 3. Exceptions & Approvals Audit
  const exceptions: ExceptionAuditReportItem[] = [];
  const exceptionRoleCounts: Record<string, number> = {};

  // 3a. MOT exceptions with reviews
  const motExceptions = await prisma.motShopCollection.findMany({
    where: {
      operational_date: { gte: startOfDay, lte: endOfDay },
      review_status: { in: ['PENDING', 'APPROVED', 'REJECTED'] },
      ...(zmccIdBigInt ? { zmcc_id: zmccIdBigInt } : {}),
    },
    include: {
      submitted_by: { select: { full_name: true, role: true } },
      reviewed_by: { select: { full_name: true, role: true } },
      shop: { select: { shop_name: true } },
      journey: { include: { mot_profile: true } },
    },
  });

  for (const m of motExceptions) {
    const reasons = Array.isArray(m.exception_reasons) ? (m.exception_reasons as string[]) : [];
    const dec: 'APPROVED' | 'REJECTED' | 'PENDING' =
      m.review_status === 'APPROVED' ? 'APPROVED' : m.review_status === 'REJECTED' ? 'REJECTED' : 'PENDING';
    const role = m.reviewed_as_role || m.reviewed_by?.role || 'ZMCC_MANAGER';
    if (dec !== 'PENDING') {
      exceptionRoleCounts[role] = (exceptionRoleCounts[role] || 0) + 1;
    }
    exceptions.push({
      id: `mot-${m.id}`,
      entityType: 'MOT_SHOP_COLLECTION',
      referenceNumber: m.collection_number,
      zmccName: m.shop?.shop_name || 'Village Shop',
      reason: reasons.join(', ') || 'Tolerance Warning / Spec Hold',
      submittedBy: m.submitted_by?.full_name || m.journey?.mot_profile?.name || 'Mobile Tester',
      submittedRole: 'MOT',
      reviewedBy: m.reviewed_by?.full_name || (dec === 'PENDING' ? 'Awaiting Review' : 'Manager'),
      reviewedRole: m.reviewed_as_role || m.reviewed_by?.role || null,
      decision: dec,
      remarks: m.review_remarks || m.decision_remarks || null,
      timestamp: (m.reviewed_at || m.server_received_at).toISOString().slice(11, 16),
    });
  }

  // 3b. ZMCC Lab portions exceptions
  const labExceptions = await prisma.zmccLabPortion.findMany({
    where: {
      created_at: { gte: startOfDay, lte: endOfDay },
      review_status: { in: ['PENDING', 'APPROVED', 'REJECTED'] },
      ...(zmccIdBigInt ? { lab_session: { zmcc_id: zmccIdBigInt } } : {}),
    },
    include: {
      creator: { select: { full_name: true, role: true } },
      reviewer: { select: { full_name: true, role: true } },
      lab_session: { include: { zmcc: true } },
    },
  });

  for (const l of labExceptions) {
    const reasons = Array.isArray(l.exception_reasons) ? (l.exception_reasons as string[]) : [];
    const dec: 'APPROVED' | 'REJECTED' | 'PENDING' =
      l.review_status === 'APPROVED' ? 'APPROVED' : l.review_status === 'REJECTED' ? 'REJECTED' : 'PENDING';
    const role = l.reviewed_as_role || l.reviewer?.role || 'ZMCC_MANAGER';
    if (dec !== 'PENDING') {
      exceptionRoleCounts[role] = (exceptionRoleCounts[role] || 0) + 1;
    }
    exceptions.push({
      id: `lab-${l.id}`,
      entityType: 'ZMCC_LAB_PORTION',
      referenceNumber: `Session #${l.lab_session_id} Port ${l.portion_number}`,
      zmccName: l.lab_session?.zmcc?.name || 'ZMCC Hub',
      reason: reasons.join(', ') || 'Lab Quality Exception',
      submittedBy: l.creator?.full_name || 'Lab Attendant',
      submittedRole: l.performed_as_role || 'ZMCC_LAB_ATTENDANT',
      reviewedBy: l.reviewer?.full_name || (dec === 'PENDING' ? 'Awaiting Review' : 'Manager'),
      reviewedRole: l.reviewed_as_role || l.reviewer?.role || null,
      decision: dec,
      remarks: l.review_remarks || l.decision_remarks || null,
      timestamp: (l.reviewed_at || l.decided_at || new Date()).toISOString().slice(11, 16),
    });
  }

  // 4. Plant QA Receptions
  const plantPortionsRaw = await prisma.visitPortion.findMany({
    where: {
      visit: {
        operational_date: { gte: startOfDay, lte: endOfDay },
        ...(zmccIdBigInt ? { procurement_source_id: zmccIdBigInt } : {}),
      },
    },
    include: {
      visit: {
        include: {
          procurement_source: true,
        },
      },
      decided_by: { select: { full_name: true, role: true } },
      plant_lab_results: {
        include: { lab_test: true },
      },
    },
    orderBy: { portion_number: 'asc' },
  });

  const plantQaVisits: PlantQaReportItem[] = [];
  let plantTotalLiters = 0;
  let plantAccepted = 0;
  let plantWarnings = 0;
  let plantRejected = 0;
  let plantMtdEscalations = 0;
  const uniqueTankers = new Set<string>();

  for (const p of plantPortionsRaw) {
    const grossLiters = Number(p.dispatch_quantity_value || 0);
    plantTotalLiters += grossLiters;
    uniqueTankers.add(p.visit.vehicle_number);

    const warningEntries = p.plant_lab_results.filter((r) => r.evaluation_status === 'WARNING');
    const warningList = warningEntries.map((r) => `${r.lab_test.testName}: ${r.numeric_value ?? r.text_value}`);
    const isWarning = warningList.length > 0;
    const isRejected = p.plant_decision === 'REJECTED';

    let verdict: 'ACCEPTED' | 'WARNING' | 'REJECTED' = 'ACCEPTED';
    if (isRejected) {
      verdict = 'REJECTED';
      plantRejected++;
    } else if (isWarning) {
      verdict = 'WARNING';
      plantWarnings++;
    } else if (p.plant_decision === 'ACCEPTED') {
      plantAccepted++;
    }

    // Evaluate MTD threshold
    const escalation = await QaWarningEscalationService.evaluateWarningEscalation(
      p.visit.procurement_source_id,
      isWarning,
      p.plant_decided_as_role || 'QA_LAB_ATTENDANT',
      startOfDay
    );

    if (escalation.requiresAvpEscalation) {
      plantMtdEscalations++;
    }

    plantQaVisits.push({
      id: p.id.toString(),
      visitNumber: p.visit.visit_number,
      vehicleNumber: p.visit.vehicle_number,
      sourceName: p.visit.procurement_source?.name || 'Supply Source',
      portionNumber: p.portion_number,
      grossLiters,
      mtdWarningCount: escalation.currentMtdCount,
      mtdThreshold: escalation.threshold,
      requiresAvpEscalation: escalation.requiresAvpEscalation,
      verdict,
      warnings: warningList,
      decidedBy: p.decided_by?.full_name || p.plant_decided_as_role || 'QA Attendant',
      remarks: p.plant_rejection_reason || null,
      time: p.plant_decided_at ? p.plant_decided_at.toISOString().slice(11, 16) : '—',
    });
  }

  // 5. Supply Chain Losses
  let lossSummary = {
    tier1LossLiters: 0,
    tier1LossPercent: 0,
    tier2LossLiters: 0,
    tier2LossPercent: 0,
    tier3LossLiters: 0,
    tier3LossPercent: 0,
  };

  try {
    const losses = await getSupplyChainLossHierarchy({
      zmccId: zmccIdBigInt ? zmccIdBigInt.toString() : undefined,
      period: 'custom',
      from: targetDateStr,
      to: targetDateStr,
    });
    if (losses?.summary) {
      lossSummary = {
        tier1LossLiters: losses.summary.tier1RouteLoss.lossLiters,
        tier1LossPercent: losses.summary.tier1RouteLoss.lossPercent,
        tier2LossLiters: losses.summary.tier2ZmccLoss.lossLiters,
        tier2LossPercent: losses.summary.tier2ZmccLoss.lossPercent,
        tier3LossLiters: losses.summary.tier3TransitLoss.lossLiters,
        tier3LossPercent: losses.summary.tier3TransitLoss.lossPercent,
      };
    }
  } catch (err) {
    console.warn('Supply chain loss calculation fallback:', err);
  }

  const approvedExCount = exceptions.filter((e) => e.decision === 'APPROVED').length;
  const rejectedExCount = exceptions.filter((e) => e.decision === 'REJECTED').length;
  const pendingExCount = exceptions.filter((e) => e.decision === 'PENDING').length;

  return {
    date: targetDateStr,
    generatedAt: new Date().toISOString(),
    facilityScope: zmccIdBigInt ? `ZMCC #${zmccIdBigInt}` : 'All Procurement Facilities',
    kpis: {
      mot: {
        totalLiters: Math.round(motTotalLiters),
        totalCollections: motCollections.length,
        passedCount: motPassed,
        warningCount: motWarnings,
        rejectedCount: motRejected,
        avgLr: motTotalLiters > 0 ? Number((motSumLr / motTotalLiters).toFixed(1)) : 0,
        avgFat: motTotalLiters > 0 ? Number((motSumFat / motTotalLiters).toFixed(2)) : 0,
        avgSnf: motTotalLiters > 0 ? Number((motSumSnf / motTotalLiters).toFixed(2)) : 0,
      },
      zmcc: {
        totalLiters: Math.round(zmccTotalLiters),
        totalPortions: zmccPortions.length,
        passedCount: zmccPassed,
        warningCount: zmccWarnings,
        rejectedCount: zmccRejected,
      },
      plantQa: {
        totalTankers: uniqueTankers.size,
        totalLiters: Math.round(plantTotalLiters),
        acceptedCount: plantAccepted,
        warningCount: plantWarnings,
        rejectedCount: plantRejected,
        mtdWarningEscalations: plantMtdEscalations,
      },
      exceptions: {
        totalHandled: approvedExCount + rejectedExCount,
        approvedCount: approvedExCount,
        rejectedCount: rejectedExCount,
        pendingCount: pendingExCount,
        byRole: exceptionRoleCounts,
      },
      losses: lossSummary,
    },
    motCollections,
    zmccPortions,
    exceptions,
    plantQaVisits,
  };
}

/**
 * Builds a multi-sheet formatted Excel workbook (.xlsx)
 */
export async function generateDailyReportExcel(data: DailyReportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Shakarganj Food Products';
  workbook.created = new Date();

  const brandFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A8A' }, // Deep Navy
  };

  const tableHeaderFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF1F5F9' }, // Slate 100
  };

  const headerFont: Partial<ExcelJS.Font> = {
    name: 'Arial',
    size: 10,
    bold: true,
    color: { argb: 'FF1E293B' },
  };

  const regularFont: Partial<ExcelJS.Font> = {
    name: 'Arial',
    size: 9.5,
  };

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  };

  // SHEET 1: EXECUTIVE SUMMARY
  const s1 = workbook.addWorksheet('Executive Summary');
  s1.views = [{ showGridLines: true }];

  s1.mergeCells('A1:G1');
  const titleCell = s1.getCell('A1');
  titleCell.value = 'SHAKARGANJ FOOD PRODUCTS - DAILY OPERATIONS & QUALITY REPORT';
  titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = brandFill;
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  s1.getRow(1).height = 36;

  s1.getCell('A3').value = 'Operational Date:';
  s1.getCell('B3').value = data.date;
  s1.getCell('D3').value = 'Generated Timestamp:';
  s1.getCell('E3').value = data.generatedAt;
  s1.getCell('A4').value = 'Scope:';
  s1.getCell('B4').value = data.facilityScope;

  ['A3', 'A4', 'D3'].forEach((c) => (s1.getCell(c).font = { bold: true, size: 10 }));

  // Summary Table: Volumes & Verdicts
  s1.getCell('A6').value = '1. Stage Intake Volumes & Verdicts Summary';
  s1.getCell('A6').font = { bold: true, size: 11, color: { argb: 'FF0F172A' } };

  s1.getRow(7).values = ['Stage', 'Intake Liters', 'Units/Entries', 'Passed', 'Warnings', 'Rejected', 'Success Rate'];
  s1.getRow(7).font = headerFont;
  for (let c = 1; c <= 7; c++) {
    const cell = s1.getRow(7).getCell(c);
    cell.fill = tableHeaderFill;
    cell.border = thinBorder;
  }

  const stageRows = [
    [
      'MOT Village Collections',
      data.kpis.mot.totalLiters,
      data.kpis.mot.totalCollections,
      data.kpis.mot.passedCount,
      data.kpis.mot.warningCount,
      data.kpis.mot.rejectedCount,
      data.kpis.mot.totalCollections > 0
        ? `${(((data.kpis.mot.passedCount + data.kpis.mot.warningCount) / data.kpis.mot.totalCollections) * 100).toFixed(1)}%`
        : '0%',
    ],
    [
      'ZMCC Reception Lab',
      data.kpis.zmcc.totalLiters,
      data.kpis.zmcc.totalPortions,
      data.kpis.zmcc.passedCount,
      data.kpis.zmcc.warningCount,
      data.kpis.zmcc.rejectedCount,
      data.kpis.zmcc.totalPortions > 0
        ? `${(((data.kpis.zmcc.passedCount + data.kpis.zmcc.warningCount) / data.kpis.zmcc.totalPortions) * 100).toFixed(1)}%`
        : '0%',
    ],
    [
      'Plant QA Reception',
      data.kpis.plantQa.totalLiters,
      data.kpis.plantQa.totalTankers,
      data.kpis.plantQa.acceptedCount,
      data.kpis.plantQa.warningCount,
      data.kpis.plantQa.rejectedCount,
      data.kpis.plantQa.totalTankers > 0
        ? `${(((data.kpis.plantQa.acceptedCount + data.kpis.plantQa.warningCount) / data.kpis.plantQa.totalTankers) * 100).toFixed(1)}%`
        : '0%',
    ],
  ];

  stageRows.forEach((r, idx) => {
    const row = s1.getRow(8 + idx);
    row.values = r;
    row.font = regularFont;
    for (let c = 1; c <= 7; c++) {
      const cell = row.getCell(c);
      cell.border = thinBorder;
      if (c === 2) cell.numFmt = '#,##0';
    }
  });

  // Summary Table: Exceptions
  s1.getCell('A13').value = '2. Exceptions Handled Audit Summary';
  s1.getCell('A13').font = { bold: true, size: 11, color: { argb: 'FF0F172A' } };

  s1.getRow(14).values = ['Total Handled', 'Approved', 'Overruled / Rejected', 'Pending Review', 'Top Handling Role'];
  s1.getRow(14).font = headerFont;
  for (let c = 1; c <= 5; c++) {
    const cell = s1.getRow(14).getCell(c);
    cell.fill = tableHeaderFill;
    cell.border = thinBorder;
  }

  const topRole = Object.entries(data.kpis.exceptions.byRole).sort((a, b) => b[1] - a[1])[0]?.[0] || 'ZMCC_MANAGER';
  const exRow = s1.getRow(15);
  exRow.values = [
    data.kpis.exceptions.totalHandled,
    data.kpis.exceptions.approvedCount,
    data.kpis.exceptions.rejectedCount,
    data.kpis.exceptions.pendingCount,
    topRole,
  ];
  exRow.font = regularFont;
  for (let c = 1; c <= 5; c++) exRow.getCell(c).border = thinBorder;

  // Summary Table: Supply Chain Losses
  s1.getCell('A18').value = '3. Supply Chain 3-Tier Losses';
  s1.getCell('A18').font = { bold: true, size: 11, color: { argb: 'FF0F172A' } };

  s1.getRow(19).values = ['Tier Level', 'Description', 'Loss (Liters)', 'Loss (%)', 'Alert Threshold', 'Status'];
  s1.getRow(19).font = headerFont;
  for (let c = 1; c <= 6; c++) {
    const cell = s1.getRow(19).getCell(c);
    cell.fill = tableHeaderFill;
    cell.border = thinBorder;
  }

  const lossRows = [
    ['Tier 1', 'MOT Route / Area Loss (Shop vs ZMCC Gate)', data.kpis.losses.tier1LossLiters, `${data.kpis.losses.tier1LossPercent.toFixed(2)}%`, '0.50%', data.kpis.losses.tier1LossPercent > 0.5 ? 'HIGH' : 'NORMAL'],
    ['Tier 2', 'ZMCC Process & Chilling Loss', data.kpis.losses.tier2LossLiters, `${data.kpis.losses.tier2LossPercent.toFixed(2)}%`, '0.75%', data.kpis.losses.tier2LossPercent > 0.75 ? 'HIGH' : 'NORMAL'],
    ['Tier 3', 'Road Transit Loss (ZMCC to Plant)', data.kpis.losses.tier3LossLiters, `${data.kpis.losses.tier3LossPercent.toFixed(2)}%`, '1.00%', data.kpis.losses.tier3LossPercent > 1.0 ? 'HIGH' : 'NORMAL'],
  ];

  lossRows.forEach((r, idx) => {
    const row = s1.getRow(20 + idx);
    row.values = r;
    row.font = regularFont;
    for (let c = 1; c <= 6; c++) {
      const cell = row.getCell(c);
      cell.border = thinBorder;
      if (c === 3) cell.numFmt = '#,##0.00';
    }
  });

  s1.columns = [{ width: 28 }, { width: 34 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 16 }];

  // SHEET 2: MOT SHOP COLLECTIONS
  const s2 = workbook.addWorksheet('MOT Collections');
  s2.views = [{ showGridLines: true }];
  s2.getRow(1).values = [
    'Collection #',
    'Time',
    'Shop Code',
    'Shop Name',
    'Route',
    'Mobile Tester',
    'Milk Source',
    'Gross Liters',
    '13% TS Liters',
    'LR',
    'Fat %',
    'SNF %',
    'TS %',
    'Verdict',
    'Tolerance Warnings',
    'Attendant Remarks',
  ];
  s2.getRow(1).font = headerFont;
  for (let c = 1; c <= 16; c++) {
    const cell = s2.getRow(1).getCell(c);
    cell.fill = tableHeaderFill;
    cell.border = thinBorder;
  }

  data.motCollections.forEach((m, idx) => {
    const row = s2.getRow(2 + idx);
    row.values = [
      m.collectionNumber,
      m.time,
      m.shopCode,
      m.shopName,
      m.routeCode || '—',
      m.motName,
      m.sourceName,
      m.grossLiters,
      m.at13tsLiters,
      m.lr,
      m.fat,
      m.snf,
      m.ts,
      m.verdict,
      m.warnings.join('; ') || '—',
      m.remarks || '—',
    ];
    row.font = regularFont;
    for (let c = 1; c <= 16; c++) {
      const cell = row.getCell(c);
      cell.border = thinBorder;
      if (c === 8 || c === 9) cell.numFmt = '#,##0.00';
      if (c === 10 || c === 11 || c === 12 || c === 13) cell.numFmt = '0.00';
    }
  });

  s2.columns = [
    { width: 18 },
    { width: 8 },
    { width: 12 },
    { width: 22 },
    { width: 12 },
    { width: 20 },
    { width: 22 },
    { width: 14 },
    { width: 14 },
    { width: 8 },
    { width: 8 },
    { width: 8 },
    { width: 8 },
    { width: 12 },
    { width: 30 },
    { width: 25 },
  ];

  // SHEET 3: ZMCC LAB INTAKE
  const s3 = workbook.addWorksheet('ZMCC Lab Portions');
  s3.views = [{ showGridLines: true }];
  s3.getRow(1).values = [
    'Session #',
    'Time',
    'Type',
    'Token #',
    'Vehicle #',
    'Supplier / Center',
    'Portion #',
    'Gross Liters',
    'LR',
    'Fat %',
    'Temp (°C)',
    'Verdict',
    'Tolerance Warnings',
    'Remarks',
    'Tested By Role',
  ];
  s3.getRow(1).font = headerFont;
  for (let c = 1; c <= 15; c++) {
    const cell = s3.getRow(1).getCell(c);
    cell.fill = tableHeaderFill;
    cell.border = thinBorder;
  }

  data.zmccPortions.forEach((p, idx) => {
    const row = s3.getRow(2 + idx);
    row.values = [
      p.sessionId,
      p.time,
      p.arrivalType,
      p.tokenNo,
      p.vehicleNo,
      p.supplierName,
      p.portionNumber,
      p.grossLiters,
      p.lr ?? '—',
      p.fat ?? '—',
      p.temperature ?? '—',
      p.verdict,
      p.warnings.join('; ') || '—',
      p.remarks || '—',
      p.performedByRole || '—',
    ];
    row.font = regularFont;
    for (let c = 1; c <= 15; c++) {
      const cell = row.getCell(c);
      cell.border = thinBorder;
      if (c === 8) cell.numFmt = '#,##0.00';
    }
  });

  s3.columns = [
    { width: 12 },
    { width: 8 },
    { width: 8 },
    { width: 12 },
    { width: 14 },
    { width: 24 },
    { width: 10 },
    { width: 14 },
    { width: 8 },
    { width: 8 },
    { width: 10 },
    { width: 12 },
    { width: 30 },
    { width: 25 },
    { width: 22 },
  ];

  // SHEET 4: EXCEPTIONS AUDIT
  const s4 = workbook.addWorksheet('Exceptions Log');
  s4.views = [{ showGridLines: true }];
  s4.getRow(1).values = [
    'Entity Type',
    'Reference #',
    'Time',
    'Source / ZMCC',
    'Exception Trigger / Reason',
    'Submitted By',
    'Submitter Role',
    'Resolved By',
    'Approver Role',
    'Decision',
    'Approval Remarks',
  ];
  s4.getRow(1).font = headerFont;
  for (let c = 1; c <= 11; c++) {
    const cell = s4.getRow(1).getCell(c);
    cell.fill = tableHeaderFill;
    cell.border = thinBorder;
  }

  data.exceptions.forEach((e, idx) => {
    const row = s4.getRow(2 + idx);
    row.values = [
      e.entityType,
      e.referenceNumber,
      e.timestamp,
      e.zmccName,
      e.reason,
      e.submittedBy,
      e.submittedRole,
      e.reviewedBy || '—',
      e.reviewedRole || '—',
      e.decision,
      e.remarks || '—',
    ];
    row.font = regularFont;
    for (let c = 1; c <= 11; c++) {
      row.getCell(c).border = thinBorder;
    }
  });

  s4.columns = [
    { width: 22 },
    { width: 20 },
    { width: 8 },
    { width: 22 },
    { width: 32 },
    { width: 20 },
    { width: 14 },
    { width: 20 },
    { width: 16 },
    { width: 14 },
    { width: 30 },
  ];

  // SHEET 5: PLANT QA RECEPTION
  const s5 = workbook.addWorksheet('Plant QA Reception');
  s5.views = [{ showGridLines: true }];
  s5.getRow(1).values = [
    'Visit #',
    'Time',
    'Vehicle #',
    'Origin ZMCC',
    'Portion #',
    'Gross Liters',
    'MTD Warning Count',
    'AVP Escalated?',
    'Verdict',
    'Tolerance Warnings',
    'Decided By',
    'Remarks',
  ];
  s5.getRow(1).font = headerFont;
  for (let c = 1; c <= 12; c++) {
    const cell = s5.getRow(1).getCell(c);
    cell.fill = tableHeaderFill;
    cell.border = thinBorder;
  }

  data.plantQaVisits.forEach((p, idx) => {
    const row = s5.getRow(2 + idx);
    row.values = [
      p.visitNumber,
      p.time,
      p.vehicleNumber,
      p.sourceName,
      p.portionNumber,
      p.grossLiters,
      `${p.mtdWarningCount} / ${p.mtdThreshold}`,
      p.requiresAvpEscalation ? 'YES (Limit Exceeded)' : 'NO',
      p.verdict,
      p.warnings.join('; ') || '—',
      p.decidedBy,
      p.remarks || '—',
    ];
    row.font = regularFont;
    for (let c = 1; c <= 12; c++) {
      const cell = row.getCell(c);
      cell.border = thinBorder;
      if (c === 6) cell.numFmt = '#,##0.00';
    }
  });

  s5.columns = [
    { width: 16 },
    { width: 8 },
    { width: 14 },
    { width: 24 },
    { width: 10 },
    { width: 14 },
    { width: 18 },
    { width: 16 },
    { width: 12 },
    { width: 30 },
    { width: 20 },
    { width: 25 },
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Generates email content and logs audit entry for Super Admin Daily Report dispatch
 */
export async function sendSuperAdminDailyReportEmail(input: {
  recipients: string[];
  date: string;
  note?: string;
  reportData: DailyReportData;
  actingContext: ActingContext;
}): Promise<{ success: boolean; message: string; previewText: string }> {
  const { recipients, date, note, reportData, actingContext } = input;

  const kpis = reportData.kpis;
  const previewText = `Shakarganj Daily Quality & Operations Report (${date}):
• MOT Village Intake: ${kpis.mot.totalLiters.toLocaleString()} L (${kpis.mot.totalCollections} collections, ${kpis.mot.warningCount} warnings, ${kpis.mot.rejectedCount} rejected)
• ZMCC Lab Intake: ${kpis.zmcc.totalLiters.toLocaleString()} L (${kpis.zmcc.totalPortions} portions, ${kpis.zmcc.warningCount} warnings)
• Plant QA Intake: ${kpis.plantQa.totalLiters.toLocaleString()} L (${kpis.plantQa.totalTankers} tankers, ${kpis.plantQa.mtdWarningEscalations} MTD escalations)
• Exceptions Handled: ${kpis.exceptions.totalHandled} (${kpis.exceptions.approvedCount} approved, ${kpis.exceptions.rejectedCount} rejected)
• Supply Chain Losses: Tier 1: ${kpis.losses.tier1LossPercent.toFixed(2)}% | Tier 2: ${kpis.losses.tier2LossPercent.toFixed(2)}% | Tier 3: ${kpis.losses.tier3LossPercent.toFixed(2)}%
${note ? `Note: ${note}` : ''}`;

  await writeAuditLog(prisma, {
    tableName: 'super_admin_report_dispatch',
    recordId: BigInt(Date.now()),
    action: 'DAILY_REPORT_DISPATCHED_TO_EXECUTIVES',
    oldValues: null,
    newValues: {
      date,
      recipients,
      motLiters: kpis.mot.totalLiters,
      zmccLiters: kpis.zmcc.totalLiters,
      plantLiters: kpis.plantQa.totalLiters,
      exceptionsHandled: kpis.exceptions.totalHandled,
      note: note || null,
    },
    actor: {
      userId: actingContext.userId,
      actorRole: actingContext.actorRole,
      performedAsRole: actingContext.actingAs,
      isDelegated: actingContext.isDelegated,
    },
  });

  return {
    success: true,
    message: `Report successfully dispatched to ${recipients.length} recipient(s).`,
    previewText,
  };
}
