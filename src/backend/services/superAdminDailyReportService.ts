import { getRoleLabel } from '@core/roles/labels';
import { prisma } from '@core/db';
import ExcelJS from 'exceljs';
import { getSupplyChainLossHierarchy } from '@/backend/services/lossCalculationService';
import { formatLossGainPercent, LOSS_GAIN_EXPORT_HEADER, LOSS_GAIN_EXPORT_PERCENT_HEADER } from '@/lib/lossGain';
import { QaWarningEscalationService } from '@/backend/services/qaWarningEscalationService';
import { writeAuditLog } from '@/backend/core/audit';
import { calculateGrossLiters } from '@/backend/utils/milkFormulas';
import { getPakistanDayWindow, plantVisitDateWhere, type DateBasis } from '@/backend/core/business-day';
import { isHcSession } from '@/backend/services/zmccTankService';
import type { ActingContext } from '@/types/acting';

const PAKISTAN_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: false });

/** A superior's verdict is final, so the tester's own Reject only counts until a final decision exists. */
function isRejectedVerdict(finalDecision: string | null | undefined, personDecision: string | null | undefined): boolean {
  return finalDecision === 'REJECTED' || (finalDecision !== 'ACCEPTED' && personDecision === 'REJECT');
}

export interface DailyReportFilter {
  date: string; // YYYY-MM-DD
  zmccId?: string | number;
  /** How plant vehicles are placed on the day. Other stages always use the calendar day. */
  dateBasis?: DateBasis;
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
  verdict: 'ACCEPTED' | 'WARNING' | 'REJECTED' | 'PENDING';
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
  /** Null until weighed, or when the quantity is in kg and there is no LR to convert it. */
  grossLiters: number | null;
  lr: number | null;
  fat: number | null;
  temperature: number | null;
  verdict: 'ACCEPTED' | 'WARNING' | 'REJECTED' | 'PENDING';
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
  /** Null when the quantity is in kg and the dispatch LR needed to convert it is missing. */
  grossLiters: number | null;
  mtdWarningCount: number;
  mtdThreshold: number;
  requiresAvpEscalation: boolean;
  verdict: 'ACCEPTED' | 'WARNING' | 'REJECTED' | 'PENDING';
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
    /** Received minus sent: negative is a loss, positive a gain. @13 TS is the main figure, gross beside it. */
    losses: {
      tier1SignedAt13tsLiters: number;
      tier1SignedAt13tsPercent: number;
      tier1SignedLiters: number;
      tier1SignedPercent: number;
      tier2SignedAt13tsLiters: number;
      tier2SignedAt13tsPercent: number;
      tier2SignedLiters: number;
      tier2SignedPercent: number;
      tier3SignedAt13tsLiters: number;
      tier3SignedAt13tsPercent: number;
      tier3SignedLiters: number;
      tier3SignedPercent: number;
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
  // startOfDay and endOfDay suit date-only columns. Timestamp columns hold real instants, so they use the Pakistan day.
  const pakistanDay = getPakistanDayWindow(targetDateStr);
  const zmccIdBigInt = filter.zmccId ? BigInt(filter.zmccId) : undefined;

  // All the day's reads start together; each takes only the columns the report shows.
  const motScope = {
    operational_date: { gte: startOfDay, lte: endOfDay },
    ...(zmccIdBigInt ? { zmcc_id: zmccIdBigInt } : {}),
  };
  const labScope = {
    created_at: { gte: pakistanDay.start, lte: pakistanDay.end },
    ...(zmccIdBigInt ? { lab_session: { zmcc_id: zmccIdBigInt } } : {}),
  };
  const [motCollectionsRaw, zmccPortionsRaw, motExceptions, labExceptions, plantPortionsRaw, lossResult] = await Promise.all([
    // 1. MOT Shop Collections
    prisma.motShopCollection.findMany({
      where: motScope,
      select: {
        id: true,
        collection_number: true,
        gross_liters: true,
        at_13ts_liters: true,
        lr: true,
        fat: true,
        snf: true,
        ts: true,
        decision_details: true,
        final_decision: true,
        person_decision: true,
        device_collected_at: true,
        server_received_at: true,
        milk_source_name_snapshot: true,
        decision_remarks: true,
        collection_notes: true,
        exception_reasons: true,
        stop: { select: { shop_code_snapshot: true, shop_name_snapshot: true } },
        shop: { select: { shop_code: true, shop_name: true } },
        journey: { select: { route: { select: { route_code: true } }, mot_profile: { select: { name: true } } } },
      },
      orderBy: { server_received_at: 'desc' },
    }),
    // 2. ZMCC Lab Portions
    prisma.zmccLabPortion.findMany({
      where: labScope,
      select: {
        id: true,
        lab_session_id: true,
        portion_number: true,
        gross_liters: true,
        quantity_value: true,
        quantity_unit: true,
        lr: true,
        fat: true,
        decision_details: true,
        final_decision: true,
        person_decision: true,
        decision_remarks: true,
        performed_as_role: true,
        decided_at: true,
        lab_session: {
          select: {
            arrival_type: true,
            zmcc: { select: { name: true } },
            mot_arrival: {
              select: { zmcc_token: true, journey: { select: { mot_vehicle: { select: { vehicle_number: true } } } } },
            },
            local_supplier_arrival: {
              select: { rmr_number: true, raw_milk_token_number: true, vehicle_number: true, local_supplier: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: { portion_number: 'asc' },
    }),
    // 3a. MOT exceptions with reviews
    prisma.motShopCollection.findMany({
      where: { ...motScope, review_status: { in: ['PENDING', 'APPROVED', 'REJECTED'] } },
      select: {
        id: true,
        collection_number: true,
        review_status: true,
        exception_reasons: true,
        reviewed_as_role: true,
        review_remarks: true,
        decision_remarks: true,
        reviewed_at: true,
        server_received_at: true,
        submitted_by: { select: { full_name: true, role: true } },
        reviewed_by: { select: { full_name: true, role: true } },
        shop: { select: { shop_name: true } },
        journey: { select: { mot_profile: { select: { name: true } } } },
      },
    }),
    // 3b. ZMCC Lab portions exceptions
    prisma.zmccLabPortion.findMany({
      where: { ...labScope, review_status: { in: ['PENDING', 'APPROVED', 'REJECTED'] } },
      select: {
        id: true,
        lab_session_id: true,
        portion_number: true,
        review_status: true,
        exception_reasons: true,
        reviewed_as_role: true,
        performed_as_role: true,
        review_remarks: true,
        decision_remarks: true,
        reviewed_at: true,
        decided_at: true,
        creator: { select: { full_name: true, role: true } },
        reviewer: { select: { full_name: true, role: true } },
        lab_session: { select: { zmcc: { select: { name: true } } } },
      },
    }),
    // 4. Plant QA Receptions
    prisma.visitPortion.findMany({
      where: {
        visit: {
          ...plantVisitDateWhere(filter.dateBasis ?? 'calendar', targetDateStr),
          current_status: { notIn: ['DRAFT_DISPATCH', 'CANCELLED'] },
          ...(zmccIdBigInt ? { procurement_source_id: zmccIdBigInt } : {}),
        },
      },
      select: {
        id: true,
        visit_id: true,
        portion_number: true,
        dispatch_quantity_value: true,
        dispatch_quantity_unit: true,
        plant_decision: true,
        plant_decided_as_role: true,
        plant_rejection_reason: true,
        plant_decided_at: true,
        visit: {
          select: {
            procurement_source_id: true,
            visit_number: true,
            vehicle_number: true,
            vehicle_dispatch_lr: true,
            procurement_source: { select: { name: true } },
          },
        },
        decided_by: { select: { full_name: true, role: true } },
        plant_lab_results: {
          select: { evaluation_status: true, numeric_value: true, text_value: true, lab_test: { select: { testName: true } } },
        },
      },
      orderBy: { portion_number: 'asc' },
    }),
    // 5. Supply chain losses
    getSupplyChainLossHierarchy({
      zmccId: zmccIdBigInt ? zmccIdBigInt.toString() : undefined,
      period: 'custom',
      from: targetDateStr,
      to: targetDateStr,
    }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    ),
  ]);

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
    const isRejected = isRejectedVerdict(c.final_decision, c.person_decision);

    let verdict: 'ACCEPTED' | 'WARNING' | 'REJECTED' | 'PENDING' = 'PENDING';
    if (isRejected) {
      verdict = 'REJECTED';
      motRejected++;
    } else if (c.final_decision === 'ACCEPTED') {
      if (isWarning) {
        verdict = 'WARNING';
        motWarnings++;
      } else {
        verdict = 'ACCEPTED';
        motPassed++;
      }
    }

    // Rejected milk stays listed with its verdict but is not intake, the same as the journey summary.
    if (!isRejected) {
      motTotalLiters += grossLiters;
      motSumLr += lr * grossLiters;
      motSumFat += fat * grossLiters;
      motSumSnf += snf * grossLiters;
    }

    motCollections.push({
      id: c.id.toString(),
      collectionNumber: c.collection_number,
      time: PAKISTAN_TIME.format(c.device_collected_at || c.server_received_at),
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

  const zmccPortions: ZmccPortionReportItem[] = [];
  let zmccTotalLiters = 0;
  let zmccPassed = 0;
  let zmccWarnings = 0;
  let zmccRejected = 0;

  for (const p of zmccPortionsRaw) {
    // A kg quantity is not litres: convert it, or leave it blank when there is no LR to convert with.
    const grossLiters = p.gross_liters != null
      ? Number(p.gross_liters)
      : calculateGrossLiters(
          p.quantity_value != null ? Number(p.quantity_value) : null,
          p.quantity_unit,
          p.lr != null ? Number(p.lr) : null,
        );
    const details = p.decision_details as any;
    const warningList: string[] = Array.isArray(details?.warnings) ? details.warnings : [];
    const isWarning = warningList.length > 0;
    const isRejected = isRejectedVerdict(p.final_decision, p.person_decision);

    let verdict: 'ACCEPTED' | 'WARNING' | 'REJECTED' | 'PENDING' = 'PENDING';
    if (isRejected) {
      verdict = 'REJECTED';
      zmccRejected++;
    } else if (p.final_decision === 'ACCEPTED') {
      if (isWarning) {
        verdict = 'WARNING';
        zmccWarnings++;
      } else {
        verdict = 'ACCEPTED';
        zmccPassed++;
      }
    }

    if (!isRejected) zmccTotalLiters += grossLiters ?? 0;

    const arrivalType: 'MC' | 'HC' = isHcSession(p.lab_session?.arrival_type ?? '') ? 'HC' : 'MC';
    const tokenNo =
      p.lab_session?.mot_arrival?.zmcc_token ||
      p.lab_session?.local_supplier_arrival?.rmr_number ||
      p.lab_session?.local_supplier_arrival?.raw_milk_token_number ||
      `S-${p.lab_session_id}`;
    const vehicleNo =
      p.lab_session?.mot_arrival?.journey?.mot_vehicle?.vehicle_number ||
      p.lab_session?.local_supplier_arrival?.vehicle_number ||
      'TRUCK';
    const supplierName = p.lab_session?.local_supplier_arrival?.local_supplier?.name || p.lab_session?.zmcc?.name || 'Procurement Center';

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
      performedByRole: getRoleLabel(p.performed_as_role || 'ZMCC_LAB_ATTENDANT'),
      time: p.decided_at ? PAKISTAN_TIME.format(p.decided_at) : '—',
    });
  }

  // 3. Exceptions & Approvals Audit
  const exceptions: ExceptionAuditReportItem[] = [];
  const exceptionRoleCounts: Record<string, number> = {};

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
      submittedRole: getRoleLabel('MOT'),
      reviewedBy: m.reviewed_by?.full_name || (dec === 'PENDING' ? 'Awaiting Review' : 'Manager'),
      reviewedRole: m.reviewed_as_role || m.reviewed_by?.role ? getRoleLabel(m.reviewed_as_role || m.reviewed_by?.role) : null,
      decision: dec,
      remarks: m.review_remarks || m.decision_remarks || null,
      timestamp: PAKISTAN_TIME.format(m.reviewed_at || m.server_received_at),
    });
  }

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
      submittedRole: getRoleLabel(l.performed_as_role || 'ZMCC_LAB_ATTENDANT'),
      reviewedBy: l.reviewer?.full_name || (dec === 'PENDING' ? 'Awaiting Review' : 'Manager'),
      reviewedRole: l.reviewed_as_role || l.reviewer?.role ? getRoleLabel(l.reviewed_as_role || l.reviewer?.role) : null,
      decision: dec,
      remarks: l.review_remarks || l.decision_remarks || null,
      timestamp: PAKISTAN_TIME.format(l.reviewed_at || l.decided_at || new Date()),
    });
  }

  const plantQaVisits: PlantQaReportItem[] = [];
  let plantTotalLiters = 0;
  let plantAccepted = 0;
  let plantWarnings = 0;
  let plantRejected = 0;
  let plantMtdEscalations = 0;
  const uniqueTankers = new Set<string>();
  const escalationCache = new Map<string, ReturnType<typeof QaWarningEscalationService.evaluateWarningEscalation>>();

  for (const p of plantPortionsRaw) {
    // The dispatch quantity may be in kg: Liters = Kg / Density.
    const grossLiters = calculateGrossLiters(
      p.dispatch_quantity_value != null ? Number(p.dispatch_quantity_value) : null,
      p.dispatch_quantity_unit,
      p.visit.vehicle_dispatch_lr != null ? Number(p.visit.vehicle_dispatch_lr) : null,
    );
    if (p.plant_decision !== 'REJECTED') plantTotalLiters += grossLiters ?? 0;
    // By visit: one truck making two trips in a day is two tankers received.
    uniqueTankers.add(p.visit_id.toString());

    const warningEntries = p.plant_lab_results.filter((r) => r.evaluation_status === 'WARNING');
    const warningList = warningEntries.map((r) => `${r.lab_test.testName}: ${r.numeric_value ?? r.text_value}`);
    const isWarning = warningList.length > 0;
    const isRejected = p.plant_decision === 'REJECTED';

    let verdict: 'ACCEPTED' | 'WARNING' | 'REJECTED' | 'PENDING' = 'PENDING';
    if (isRejected) {
      verdict = 'REJECTED';
      plantRejected++;
    } else if (p.plant_decision === 'ACCEPTED') {
      if (isWarning) {
        verdict = 'WARNING';
        plantWarnings++;
      } else {
        verdict = 'ACCEPTED';
        plantAccepted++;
      }
    } else if (isWarning) {
      plantWarnings++;
    }

    // Evaluate MTD threshold (same source, warning flag and role give the same answer on this day, so ask once)
    const escalationRole = p.plant_decided_as_role || 'QA_LAB_ATTENDANT';
    const escalationKey = `${p.visit.procurement_source_id ?? ''}|${isWarning}|${escalationRole}`;
    let escalationPromise = escalationCache.get(escalationKey);
    if (!escalationPromise) {
      escalationPromise = QaWarningEscalationService.evaluateWarningEscalation(
        p.visit.procurement_source_id,
        isWarning,
        escalationRole,
        startOfDay
      );
      escalationCache.set(escalationKey, escalationPromise);
    }
    const escalation = await escalationPromise;

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
      time: p.plant_decided_at ? PAKISTAN_TIME.format(p.plant_decided_at) : '—',
    });
  }

  // 5. Supply Chain Losses
  let lossSummary: DailyReportData['kpis']['losses'] = {
    tier1SignedAt13tsLiters: 0,
    tier1SignedAt13tsPercent: 0,
    tier1SignedLiters: 0,
    tier1SignedPercent: 0,
    tier2SignedAt13tsLiters: 0,
    tier2SignedAt13tsPercent: 0,
    tier2SignedLiters: 0,
    tier2SignedPercent: 0,
    tier3SignedAt13tsLiters: 0,
    tier3SignedAt13tsPercent: 0,
    tier3SignedLiters: 0,
    tier3SignedPercent: 0,
  };

  try {
    if (!lossResult.ok) throw lossResult.error;
    const losses = lossResult.value;
    if (losses?.summary) {
      const s = losses.summary;
      lossSummary = {
        tier1SignedAt13tsLiters: s.tier1RouteLoss.signedVarianceAt13tsLiters,
        tier1SignedAt13tsPercent: s.tier1RouteLoss.signedVarianceAt13tsPercent,
        tier1SignedLiters: s.tier1RouteLoss.signedVarianceLiters,
        tier1SignedPercent: s.tier1RouteLoss.signedVariancePercent,
        tier2SignedAt13tsLiters: s.tier2ZmccLoss.signedVarianceAt13tsLiters,
        tier2SignedAt13tsPercent: s.tier2ZmccLoss.signedVarianceAt13tsPercent,
        tier2SignedLiters: s.tier2ZmccLoss.signedVarianceLiters,
        tier2SignedPercent: s.tier2ZmccLoss.signedVariancePercent,
        tier3SignedAt13tsLiters: s.tier3TransitLoss.signedVarianceAt13tsLiters,
        tier3SignedAt13tsPercent: s.tier3TransitLoss.signedVarianceAt13tsPercent,
        tier3SignedLiters: s.tier3TransitLoss.signedVarianceLiters,
        tier3SignedPercent: s.tier3TransitLoss.signedVariancePercent,
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
      // Accepted and warning counts are portions, so the rate is out of portions too, not tankers.
      data.plantQaVisits.length > 0
        ? `${(((data.kpis.plantQa.acceptedCount + data.kpis.plantQa.warningCount) / data.plantQaVisits.length) * 100).toFixed(1)}%`
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
  s1.getCell('A18').value = '3. Supply Chain 3-Tier Loss / Gain';
  s1.getCell('A18').font = { bold: true, size: 11, color: { argb: 'FF0F172A' } };

  s1.getRow(19).values = ['Tier Level', 'Description', 'Gain (+) / Loss (-) @13% TS L', 'Gain (+) / Loss (-) @13% TS %', LOSS_GAIN_EXPORT_HEADER, LOSS_GAIN_EXPORT_PERCENT_HEADER, 'Loss Alert At', 'Status'];
  s1.getRow(19).font = headerFont;
  for (let c = 1; c <= 8; c++) {
    const cell = s1.getRow(19).getCell(c);
    cell.fill = tableHeaderFill;
    cell.border = thinBorder;
  }

  // Signed numbers (negative = loss) so a column adds up. The alert looks at loss only: a gain is never HIGH.
  const L = data.kpis.losses;
  const lossRows = [
    ['Tier 1', 'MOT Route / Area (Shop vs ZMCC Gate)', L.tier1SignedAt13tsLiters, L.tier1SignedAt13tsPercent / 100, L.tier1SignedLiters, L.tier1SignedPercent / 100, '0.50%', -L.tier1SignedPercent > 0.5 ? 'HIGH LOSS' : 'NORMAL'],
    ['Tier 2', 'ZMCC Process & Chilling', L.tier2SignedAt13tsLiters, L.tier2SignedAt13tsPercent / 100, L.tier2SignedLiters, L.tier2SignedPercent / 100, '0.75%', -L.tier2SignedPercent > 0.75 ? 'HIGH LOSS' : 'NORMAL'],
    ['Tier 3', 'Road Transit (ZMCC to Plant)', L.tier3SignedAt13tsLiters, L.tier3SignedAt13tsPercent / 100, L.tier3SignedLiters, L.tier3SignedPercent / 100, '1.00%', -L.tier3SignedPercent > 1.0 ? 'HIGH LOSS' : 'NORMAL'],
  ];

  lossRows.forEach((r, idx) => {
    const row = s1.getRow(20 + idx);
    row.values = r;
    row.font = regularFont;
    for (let c = 1; c <= 8; c++) {
      const cell = row.getCell(c);
      cell.border = thinBorder;
      if (c === 3 || c === 5) cell.numFmt = '#,##0.00;[Red]-#,##0.00';
      if (c === 4 || c === 6) cell.numFmt = '0.00%;[Red]-0.00%';
    }
  });

  s1.columns = [{ width: 28 }, { width: 34 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 16 }, { width: 16 }];

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
      p.grossLiters ?? '—',
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
      p.grossLiters ?? '—',
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
• Supply Chain Loss / Gain @13% TS: Tier 1: ${formatLossGainPercent(kpis.losses.tier1SignedAt13tsPercent)} | Tier 2: ${formatLossGainPercent(kpis.losses.tier2SignedAt13tsPercent)} | Tier 3: ${formatLossGainPercent(kpis.losses.tier3SignedAt13tsPercent)}
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
