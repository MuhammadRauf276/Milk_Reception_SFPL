import type { Prisma } from '@prisma/client';
import { writeAuditLog } from '@/backend/core/audit';
import { prisma } from '@core/db';
import { getSupplyChainLossHierarchy } from './lossCalculationService';
import { listZmccExitOutcomes } from './zmccManagerOverviewService';
import { getTankPhysicalStock, getBatchTankPhysicalStock, getBatchTankCommercialStock } from './zmccTankService';
import { getPakistanCalendarDate } from '@core/business-day';
import { findRoleResult, isRoleTest } from '@/backend/utils/roleAwareMatch';
import { loadSystemRoles, type PolicyDb } from './testPointPolicyService';
import { jsonRecord, jsonString } from '@/lib/json';

/**
 * Every figure below is computed from recorded data. A `null` means there is
 * nothing recorded for it (today, or at all); the dashboard shows it as "—".
 */

export interface LossTierTelemetry {
  lossLiters: number;
  lossPercent: number;
}

export interface MpdExecutiveTelemetry {
  businessDate: string;
  calendarDate: string;
  summary: {
    totalIntakeLiters: number;
    weightedFatPercent: number | null;
    weightedLr: number | null;
    weightedSnfPercent: number | null;
    standardized13TsLiters: number | null;
    inTransitLiters: number;
    inTransitTankerCount: number;
    supplyChainLossPercent: number | null;
    supplyChainLossLiters: number | null;
    activeZmccCount: number;
    activeContractorCount: number;
  };
  /** Today's four-tier loss breakdown; null when the loss calculation could not run. */
  lossTiers: {
    tier1RouteLoss: LossTierTelemetry;
    tier2ZmccLoss: LossTierTelemetry;
    tier3TransitLoss: LossTierTelemetry;
    tier4TotalLoss: LossTierTelemetry;
  } | null;
  motRoutes: Array<{
    id: string;
    routeCode: string | null;
    routeName: string | null;
    vehicleNumber: string | null;
    motName: string | null;
    completedShops: number;
    totalShops: number;
    grossLiters: number;
    fatPercent: number | null;
    lr: number | null;
    status: string;
    etaOrArrival: string;
    latitude: number | null;
    longitude: number | null;
    lastFixAt: string | null;
    headingDeg: number | null;
    speedMps: number | null;
  }>;
  inTransitTankers: Array<{
    id: string;
    vehicleNumber: string;
    sourceName: string | null;
    sourceCode: string | null;
    departureTime: string;
    grossLiters: number;
    at13tsLiters: number | null;
    /** Average dispatch temperature test result across the tanker's portions. */
    temperatureCelsius: number | null;
    fatPercent: number | null;
    lr: number | null;
    status: string;
  }>;
  zmccCenters: Array<{
    id: string;
    code: string;
    name: string;
    /** Gross liters received into ZMCC tanks today (lab-accepted milk). */
    intakeLiters: number;
    /** Current physical stock across the ZMCC's active tanks (inventory ledger). */
    siloStockLiters: number;
    /** Current commercial stock @13TS across the ZMCC's active tanks. */
    siloStockAt13tsLiters: number;
    siloCapacityPercent: number | null;
    avgFatPercent: number | null;
    avgLr: number | null;
    dispatchedLiters: number;
    dispatchedTankerCount: number;
    isActive: boolean;
    /** Exit-outcome reporting (last 30 days): vehicles that left / were closed without full unloading. */
    leftWithoutFullUnloadingCount: number;
    pendingCloseRequestCount: number;
    /** Accepted by the lab but never received into a tank; excluded from loss. */
    acceptedNotReceivedLiters: number;
  }>;
  /** Today's received milk grouped by milk source (name always; ERP code only for owner/reporting roles). */
  intakeBySource: Array<{
    sourceId: string | null;
    sourceName: string;
    erpCode: string | null;
    netKg: number;
    grossLiters: number;
    at13tsLiters: number;
    avgLr: number | null;
    avgFatPercent: number | null;
    avgSnfPercent: number | null;
    avgTsPercent: number | null;
  }>;
  /** Totals of the exit-outcome counters across every ZMCC. */
  exitOutcomes: { leftWithoutFullUnloading: number; pendingCloseRequests: number; acceptedNotReceivedLiters: number };
  plantContractors: Array<{
    id: string;
    code: string;
    name: string;
    deliveredLiters: number;
    /** Mean of plant QA Fat/LR results across today's portions. */
    avgFatPercent: number | null;
    avgLr: number | null;
    qualityPassRatePercent: number | null;
  }>;
  qualityFunnel: {
    /** Shop-level rejection is not recorded by MOT collections, so it is always null. */
    villageShopRejectedLiters: number | null;
    villageShopRejectionPercent: number | null;
    zmccGateRejectedLiters: number;
    zmccGateRejectionPercent: number | null;
    plantGateRejectedLiters: number;
    plantGateRejectionPercent: number | null;
    incidents: {
      formalinCount: number;
      ureaCount: number;
      waterLowLrCount: number;
      cobPositiveCount: number;
    };
  };
  governanceOverrides: GovernanceOverride[];
  emergencySubstitutes: Array<{
    id: string;
    vehicleNumber: string;
    vehicleType: string | null;
    zmccName: string | null;
    registeredBy: string | null;
    timestamp: string;
    status: 'ACTIVE' | 'INACTIVE';
  }>;
}

export type GovernanceAuditStatus = 'PENDING_AUDIT' | 'APPROVED' | 'FLAGGED';

export interface GovernanceOverride {
  /** `ZMCC-<lab session id>` or `PLANT-<portion id>`. */
  id: string;
  reference: string;
  sourceName: string | null;
  stage: 'ZMCC_GATE' | 'PLANT_RECEPTION';
  failedParameter: string;
  failedValue: string;
  toleranceLimit: string;
  systemOutcome: string | null;
  finalDecision: string | null;
  attendantNote: string | null;
  managerJustification: string | null;
  overruledBy: string | null;
  timestamp: string;
  status: GovernanceAuditStatus;
}

/** Manager overrides stay on the audit desk for this many days. */
const GOVERNANCE_WINDOW_DAYS = 30;
const GOVERNANCE_AUDIT_ACTIONS = {
  APPROVED: 'MPD_GOVERNANCE_AUDIT_APPROVED',
  FLAGGED: 'MPD_GOVERNANCE_AUDIT_FLAGGED',
} as const;
/** Manager review states that mean a human decision replaced the system result. */
const RESOLVED_REVIEW_STATUSES = ['APPROVED', 'REJECTED', 'REVIEWED_EXITED'];

type Numeric = Prisma.Decimal | number | string | null | undefined;

function toNumber(value: Numeric): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

/** Weighted mean of (value, weight) pairs, ignoring missing values; null when nothing is weighted. */
function weightedMean(pairs: Array<[number | null, number]>): number | null {
  let sum = 0;
  let weight = 0;
  for (const [value, w] of pairs) {
    if (value === null || !(w > 0)) continue;
    sum += value * w;
    weight += w;
  }
  return weight > 0 ? round(sum / weight) : null;
}

function mean(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? round(present.reduce((a, b) => a + b, 0) / present.length) : null;
}

function percentOf(part: number, whole: number): number | null {
  return whole > 0 ? round((part / whole) * 100) : null;
}

type TestLike = { testCode: string; testName: string; resultType: string; systemRole?: string | null };

function numericResultFor(
  results: Array<{ numeric_value: Numeric; lab_test: TestLike }>,
  role: 'LR' | 'FAT',
  roleHeld: boolean
): number | null {
  // The test holding the stored role wins; the older name/code match only applies while no test holds the role.
  const match = findRoleResult(results, role, roleHeld);
  return match ? toNumber(match.numeric_value) : null;
}

const isTemperatureTest = (test: TestLike) => test.testName.trim().toLowerCase() === 'temperature';

/** Liters for a portion's dispatch quantity; KG is converted with the vehicle's dispatch density. */
function portionLiters(
  portion: { dispatch_quantity_value: Numeric; dispatch_quantity_unit: string | null },
  density: number | null
): number | null {
  const value = toNumber(portion.dispatch_quantity_value);
  if (value === null) return null;
  if (portion.dispatch_quantity_unit === 'LITER') return value;
  if (portion.dispatch_quantity_unit === 'KG' && density && density > 0) return value / density;
  return null;
}

export type IncidentKind = 'formalin' | 'urea' | 'waterLowLr' | 'cobPositive';

/** Maps a failed test to the incident category it counts toward, if any. */
export function incidentKind(test: TestLike, lrRoleHeld = false): IncidentKind | null {
  const name = test.testName.trim().toLowerCase();
  if (name.includes('formalin')) return 'formalin';
  if (name === 'urea') return 'urea';
  if (name.includes('clot on boiling')) return 'cobPositive';
  if (isRoleTest(test, 'LR', lrRoleHeld)) return 'waterLowLr';
  return null;
}

function formatResultValue(numericValue: Numeric, textValue: string | null, unit: string | null): string {
  const n = toNumber(numericValue);
  if (n !== null) return unit ? `${n} ${unit}` : String(n);
  return textValue || '—';
}

function formatRuleLimit(
  rule: { min_value: Numeric; max_value: Numeric; acceptable_option: string | null } | null
): string {
  if (!rule) return '—';
  const min = toNumber(rule.min_value);
  const max = toNumber(rule.max_value);
  if (min !== null && max !== null) return `${min}–${max}`;
  if (min !== null) return `≥ ${min}`;
  if (max !== null) return `≤ ${max}`;
  return rule.acceptable_option || '—';
}

function personName(user: { full_name: string | null; username: string } | null | undefined): string | null {
  return user ? user.full_name || user.username : null;
}

async function loadAuditStatuses(
  tableName: string,
  recordIds: bigint[]
): Promise<Map<string, GovernanceAuditStatus>> {
  const statuses = new Map<string, GovernanceAuditStatus>();
  if (recordIds.length === 0) return statuses;
  const audits = await prisma.auditLog.findMany({
    where: {
      table_name: tableName,
      record_id: { in: recordIds },
      action: { in: Object.values(GOVERNANCE_AUDIT_ACTIONS) },
    },
    orderBy: { id: 'asc' },
  });
  // Latest audit decision wins.
  for (const audit of audits) {
    statuses.set(
      audit.record_id.toString(),
      audit.action === GOVERNANCE_AUDIT_ACTIONS.APPROVED ? 'APPROVED' : 'FLAGGED'
    );
  }
  return statuses;
}

/**
 * Manager decisions that replaced the attendant/system result within the audit window,
 * at ZMCC lab gates and at plant reception, newest first.
 */
export async function listGovernanceOverrides(now: Date = new Date()): Promise<GovernanceOverride[]> {
  const since = new Date(now.getTime() - GOVERNANCE_WINDOW_DAYS * 86400000);
  const userSelect = { select: { full_name: true, username: true } } as const;

  const [labSessions, plantPortions] = await Promise.all([
    prisma.zmccLabSession.findMany({
      where: { manager_review_status: { in: RESOLVED_REVIEW_STATUSES }, manager_reviewed_at: { gte: since } },
      include: {
        zmcc: { select: { name: true } },
        manager_reviewer: userSelect,
        results: { where: { is_passed: false }, include: { applied_rule: true } },
        mot_arrival: { select: { zmcc_token: true } },
        local_supplier_arrival: { select: { zmcc_token: true, vehicle_number: true } },
      },
      orderBy: { manager_reviewed_at: 'desc' },
    }),
    prisma.visitPortion.findMany({
      where: { manager_review_status: { in: RESOLVED_REVIEW_STATUSES }, manager_reviewed_at: { gte: since } },
      include: {
        visit: { select: { visit_number: true, vehicle_number: true, procurement_source: { select: { name: true } } } },
        manager_reviewer: userSelect,
        plant_lab_results: { where: { is_passed: false }, include: { lab_test: true, applied_rule: true } },
      },
      orderBy: { manager_reviewed_at: 'desc' },
    }),
  ]);

  const [labStatuses, portionStatuses] = await Promise.all([
    loadAuditStatuses('zmcc_lab_session', labSessions.map((s) => s.id)),
    loadAuditStatuses('visit_portion', plantPortions.map((p) => p.id)),
  ]);

  const overrides: GovernanceOverride[] = [
    ...labSessions.map((s): GovernanceOverride => {
      const arrival = s.mot_arrival ?? s.local_supplier_arrival;
      const vehicle = s.local_supplier_arrival?.vehicle_number;
      return {
        id: `ZMCC-${s.id}`,
        reference: [arrival?.zmcc_token, vehicle].filter(Boolean).join(' · ') || `Lab session #${s.id}`,
        sourceName: s.zmcc?.name ?? null,
        stage: 'ZMCC_GATE',
        failedParameter: s.results.map((r) => r.test_name_snapshot).join(', ') || 'No failed test recorded',
        failedValue: s.results.map((r) => formatResultValue(r.numeric_value, r.text_value, r.unit_snapshot)).join(', ') || '—',
        toleranceLimit: s.results.map((r) => formatRuleLimit(r.applied_rule)).join(', ') || '—',
        systemOutcome: s.system_quality_outcome,
        finalDecision: s.final_decision ?? s.manager_requested_decision,
        attendantNote: s.rejection_reason,
        managerJustification: s.manager_review_reason,
        overruledBy: personName(s.manager_reviewer),
        timestamp: (s.manager_reviewed_at ?? s.updated_at).toISOString(),
        status: labStatuses.get(s.id.toString()) ?? 'PENDING_AUDIT',
      };
    }),
    ...plantPortions.map((p): GovernanceOverride => ({
      id: `PLANT-${p.id}`,
      reference: `${p.visit.visit_number} · ${p.visit.vehicle_number} · Portion ${p.portion_number}`,
      sourceName: p.visit.procurement_source?.name ?? null,
      stage: 'PLANT_RECEPTION',
      failedParameter: p.plant_lab_results.map((r) => r.lab_test.testName).join(', ') || 'No failed test recorded',
      failedValue:
        p.plant_lab_results.map((r) => formatResultValue(r.numeric_value, r.text_value, r.lab_test.unit)).join(', ') || '—',
      toleranceLimit: p.plant_lab_results.map((r) => formatRuleLimit(r.applied_rule)).join(', ') || '—',
      systemOutcome: p.system_quality_outcome,
      finalDecision: p.plant_decision ?? p.manager_requested_decision,
      attendantNote: p.plant_rejection_reason,
      managerJustification: p.manager_review_reason,
      overruledBy: personName(p.manager_reviewer),
      timestamp: (p.manager_reviewed_at ?? p.updated_at).toISOString(),
      status: portionStatuses.get(p.id.toString()) ?? 'PENDING_AUDIT',
    })),
  ];

  return overrides.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/** Parses a governance override id into the audited table and record. */
export function parseGovernanceOverrideId(id: string): { tableName: 'zmcc_lab_session' | 'visit_portion'; recordId: bigint } | null {
  const match = /^(ZMCC|PLANT)-(\d+)$/.exec(id.trim());
  if (!match) return null;
  return { tableName: match[1] === 'ZMCC' ? 'zmcc_lab_session' : 'visit_portion', recordId: BigInt(match[2]) };
}

/** Records an MPD/QA Head audit decision on a manager override in the audit log. */
export async function recordGovernanceAudit(params: {
  overrideId: string;
  action: 'APPROVED' | 'FLAGGED';
  remarks: string | null;
  userId: bigint;
  actorRole?: string | null;
}): Promise<{ status: number; error?: string; auditedAt?: string }> {
  const parsed = parseGovernanceOverrideId(params.overrideId);
  if (!parsed) return { status: 400, error: 'Invalid override id.' };

  const exists =
    parsed.tableName === 'zmcc_lab_session'
      ? await prisma.zmccLabSession.count({
          where: { id: parsed.recordId, manager_review_status: { in: RESOLVED_REVIEW_STATUSES } },
        })
      : await prisma.visitPortion.count({
          where: { id: parsed.recordId, manager_review_status: { in: RESOLVED_REVIEW_STATUSES } },
        });
  if (!exists) return { status: 404, error: 'Override record not found.' };

  const audit = await writeAuditLog(prisma, {
    tableName: parsed.tableName,
    recordId: parsed.recordId,
    action: GOVERNANCE_AUDIT_ACTIONS[params.action],
    newValues: { decision: params.action, remarks: params.remarks },
    actor: { userId: params.userId, actorRole: params.actorRole ?? null },
  });
  const stored = await prisma.auditLog.findUniqueOrThrow({ where: { id: audit.id }, select: { created_at: true } });
  return { status: 200, auditedAt: stored.created_at.toISOString() };
}

export async function getMpdExecutiveTelemetry(options: { includeErpCode?: boolean } = {}): Promise<MpdExecutiveTelemetry> {
  const calendarDate = getPakistanCalendarDate();
  // Same day-window convention as the supply-chain loss service, so figures agree.
  const todayStart = new Date(`${calendarDate}T00:00:00.000Z`);
  const todayEnd = new Date(`${calendarDate}T23:59:59.999Z`);
  const today = { gte: todayStart, lte: todayEnd };
  const substituteSince = new Date(Date.now() - GOVERNANCE_WINDOW_DAYS * 86400000);
  // Whether any lab test holds the stored LR / Fat role (then look-alike tests no longer count as LR / Fat).
  const storedRoles = [...(await loadSystemRoles(prisma as unknown as PolicyDb)).values()];
  const lrRoleHeld = storedRoles.includes('LR');
  const fatRoleHeld = storedRoles.includes('FAT');

  const [
    activeSources,
    tankReceipts,
    activeJourneys,
    inTransitVisits,
    zmccLabSessionsToday,
    plantPortionsToday,
    failedResultsToday,
    substituteAudits,
    governanceOverrides,
    exitData,
    lossData,
  ] = await Promise.all([
    // 1. Active procurement sources with today's dispatches
    prisma.procurementSource.findMany({
      where: { is_active: true },
      include: {
        zmcc_tanks: { where: { is_active: true } },
        visits: {
          // Unsubmitted drafts and cancelled visits are not dispatches.
          where: { created_at: today, current_status: { notIn: ['DRAFT_DISPATCH', 'CANCELLED'] } },
          include: {
            portions: {
              include: { plant_lab_results: { include: { lab_test: true } } },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    }),
    // 2. Milk received into ZMCC tanks today
    prisma.zmccTankReceipt.findMany({
      where: { received_at: today },
      select: {
        zmcc_id: true, gross_liters: true, lr: true, fat: true, snf: true, ts: true, at_13ts_liters: true,
        quantity_value: true, quantity_unit: true, density: true, milk_source_id: true, milk_source_name_snapshot: true,
        milk_source: { select: { erp_code: true, name: true } },
      },
    }),
    // 3. Today's MOT journeys
    prisma.motJourney.findMany({
      where: { operational_date: today },
      include: {
        route: true,
        mot_vehicle: true,
        mot_profile: true,
        summary: true,
        _count: { select: { stops: true, collections: true } },
      },
      orderBy: { created_at: 'desc' },
    }),
    // 4. Tankers dispatched but not yet weighed in at the plant
    prisma.vehicleVisit.findMany({
      where: {
        current_status: { in: ['DISPATCHED', 'IN_TRANSIT', 'GATE_ENTRY_PENDING', 'WEIGHMENT_GROSS_PENDING'] },
      },
      include: {
        procurement_source: true,
        dispatch_lab_results: { include: { lab_test: true } },
      },
      orderBy: { created_at: 'desc' },
    }),
    // 5. ZMCC lab decisions made today
    prisma.zmccLabSession.findMany({
      where: { status: 'COMPLETED', completed_at: today },
      select: { final_decision: true, decision: true, gross_liters: true },
    }),
    // 6. Plant reception decisions made today
    prisma.visitPortion.findMany({
      where: { plant_decided_at: today, plant_decision: { in: ['ACCEPTED', 'REJECTED'] } },
      select: {
        plant_decision: true,
        dispatch_quantity_value: true,
        dispatch_quantity_unit: true,
        visit: { select: { vehicle_dispatch_density: true } },
      },
    }),
    // 7. Failed tests recorded today at dispatch, plant and ZMCC labs
    Promise.all([
      prisma.dispatchLabResult.findMany({ where: { is_passed: false, created_at: today }, select: { lab_test: true } }),
      prisma.plantLabResult.findMany({ where: { is_passed: false, created_at: today }, select: { lab_test: true } }),
      prisma.zmccLabResult.findMany({ where: { is_passed: false, created_at: today }, select: { lab_test: true } }),
    ]),
    // 8. Emergency substitute vehicles registered recently
    prisma.auditLog.findMany({
      where: { table_name: 'mot_vehicle', action: 'EMERGENCY_SUBSTITUTE_VEHICLE_REGISTERED', created_at: { gte: substituteSince } },
      include: { user: { select: { full_name: true, username: true } } },
      orderBy: { created_at: 'desc' },
    }),
    listGovernanceOverrides(),
    listZmccExitOutcomes(),
    getSupplyChainLossHierarchy({ period: 'today' }).catch(() => null),
  ]);

  // ZMCC centers
  const zmccSources = activeSources.filter((s) => s.source_type === 'ZMCC');
  const allTankIds = zmccSources.flatMap((z) => z.zmcc_tanks.map((t) => t.id));
  const [tankStocks, tankCommercialStocks] = await Promise.all([
    getBatchTankPhysicalStock(allTankIds),
    getBatchTankCommercialStock(allTankIds),
  ]);

  const zmccCenters = zmccSources.map((zmcc) => {
    const received = tankReceipts.filter((r) => r.zmcc_id === zmcc.id);
    const dispatched = zmcc.visits.map((v) => ({
      liters: toNumber(v.vehicle_dispatch_gross_liters) ?? 0,
      fat: toNumber(v.vehicle_dispatch_fat),
      lr: toNumber(v.vehicle_dispatch_lr),
    }));
    const stock = zmcc.zmcc_tanks.reduce((sum, t) => sum + (tankStocks.get(t.id.toString()) ?? 0), 0);
    const commercialStock = zmcc.zmcc_tanks.reduce((sum, t) => sum + (tankCommercialStocks.get(t.id.toString()) ?? 0), 0);
    const capacity = zmcc.zmcc_tanks.reduce((sum, t) => sum + (toNumber(t.capacity_liters) ?? 0), 0);

    return {
      id: zmcc.id.toString(),
      code: zmcc.code,
      name: zmcc.name,
      intakeLiters: round(received.reduce((sum, r) => sum + (toNumber(r.gross_liters) ?? 0), 0)),
      siloStockLiters: round(stock),
      siloStockAt13tsLiters: round(commercialStock),
      siloCapacityPercent: capacity > 0 ? Math.round((stock / capacity) * 100) : null,
      avgFatPercent: weightedMean(dispatched.map((d) => [d.fat, d.liters])),
      avgLr: weightedMean(dispatched.map((d) => [d.lr, d.liters])),
      dispatchedLiters: round(dispatched.reduce((sum, d) => sum + d.liters, 0)),
      dispatchedTankerCount: dispatched.length,
      isActive: zmcc.is_active,
      leftWithoutFullUnloadingCount: exitData.left.filter((x) => x.zmccId === zmcc.id.toString()).length,
      pendingCloseRequestCount: exitData.pending.filter((x) => x.zmccId === zmcc.id.toString()).length,
      acceptedNotReceivedLiters: round(
        [...exitData.left, ...exitData.pending].filter((x) => x.zmccId === zmcc.id.toString()).reduce((t, x) => t + x.acceptedNotReceivedLiters, 0)
      ),
    };
  });

  // Received milk by source (net kg from weighed portions via receipt quantity)
  const bySource = new Map<string, {
    sourceId: string | null; sourceName: string; erpCode: string | null; netKg: number; gross: number; at13: number;
    lr: Array<[number | null, number]>; fat: Array<[number | null, number]>; snf: Array<[number | null, number]>; ts: Array<[number | null, number]>;
  }>();
  for (const r of tankReceipts) {
    const name = r.milk_source?.name ?? r.milk_source_name_snapshot ?? (r.milk_source_id ? 'Unknown source' : 'MC collections (per shop source)');
    const key = r.milk_source_id ? r.milk_source_id.toString() : `none:${name}`;
    const netKg = toNumber(r.quantity_value) ?? 0;
    const entry = bySource.get(key) ?? {
      sourceId: r.milk_source_id ? r.milk_source_id.toString() : null, sourceName: name,
      erpCode: options.includeErpCode ? r.milk_source?.erp_code ?? null : null, netKg: 0, gross: 0, at13: 0, lr: [], fat: [], snf: [], ts: [],
    };
    entry.netKg += r.quantity_unit === 'KG' ? netKg : 0;
    entry.gross += toNumber(r.gross_liters) ?? 0;
    entry.at13 += toNumber(r.at_13ts_liters) ?? 0;
    const w = r.quantity_unit === 'KG' ? netKg : toNumber(r.gross_liters) ?? 0;
    entry.lr.push([toNumber(r.lr), w]); entry.fat.push([toNumber(r.fat), w]); entry.snf.push([toNumber(r.snf), w]); entry.ts.push([toNumber(r.ts), w]);
    bySource.set(key, entry);
  }
  const intakeBySource = [...bySource.values()].map((e) => ({
    sourceId: e.sourceId, sourceName: e.sourceName, erpCode: e.erpCode,
    netKg: round(e.netKg), grossLiters: round(e.gross), at13tsLiters: round(e.at13),
    avgLr: weightedMean(e.lr), avgFatPercent: weightedMean(e.fat), avgSnfPercent: weightedMean(e.snf), avgTsPercent: weightedMean(e.ts),
  }));

  // Plant contractors (direct to plant)
  const contractorSources = activeSources.filter((s) => s.source_type === 'CONTRACTOR');
  const plantContractors = contractorSources.map((c) => {
    const portions = c.visits.flatMap((v) => v.portions);
    const decided = portions.filter((p) => p.plant_decision === 'ACCEPTED' || p.plant_decision === 'REJECTED');
    return {
      id: c.id.toString(),
      code: c.code,
      name: c.name,
      deliveredLiters: round(c.visits.reduce((sum, v) => sum + (toNumber(v.vehicle_dispatch_gross_liters) ?? 0), 0)),
      avgFatPercent: weightedMean(portions.map((p) => [numericResultFor(p.plant_lab_results, 'FAT', fatRoleHeld), toNumber(p.dispatch_quantity_value) ?? 1])),
      avgLr: weightedMean(portions.map((p) => [numericResultFor(p.plant_lab_results, 'LR', lrRoleHeld), toNumber(p.dispatch_quantity_value) ?? 1])),
      qualityPassRatePercent: percentOf(decided.filter((p) => p.plant_decision === 'ACCEPTED').length, decided.length),
    };
  });

  // Tankers in transit to the plant
  const inTransitTankers = inTransitVisits.map((v) => ({
    id: v.id.toString(),
    vehicleNumber: v.vehicle_number,
    sourceName: v.procurement_source?.name ?? null,
    sourceCode: v.procurement_source?.code ?? null,
    departureTime: v.created_at.toISOString(),
    grossLiters: toNumber(v.vehicle_dispatch_gross_liters) ?? 0,
    at13tsLiters: toNumber(v.vehicle_dispatch_at_13ts_liters),
    temperatureCelsius: mean(
      v.dispatch_lab_results.filter((r) => isTemperatureTest(r.lab_test)).map((r) => toNumber(r.numeric_value))
    ),
    fatPercent: toNumber(v.vehicle_dispatch_fat),
    lr: toNumber(v.vehicle_dispatch_lr),
    status: v.current_status,
  }));

  // MOT routes
  const lastFixes = activeJourneys.length
    ? await prisma.motJourneyLocation.findMany({
        where: { journey_id: { in: activeJourneys.map((j) => j.id) } },
        orderBy: { device_recorded_at: 'desc' },
        distinct: ['journey_id'],
      })
    : [];
  const lastFixByJourney = new Map(lastFixes.map((f) => [f.journey_id.toString(), f]));
  const motRoutes = activeJourneys.map((j) => ({
    latitude: toNumber(lastFixByJourney.get(j.id.toString())?.latitude),
    longitude: toNumber(lastFixByJourney.get(j.id.toString())?.longitude),
    lastFixAt: lastFixByJourney.get(j.id.toString())?.device_recorded_at.toISOString() ?? null,
    headingDeg: toNumber(lastFixByJourney.get(j.id.toString())?.heading_deg),
    speedMps: toNumber(lastFixByJourney.get(j.id.toString())?.speed_mps),
    id: j.id.toString(),
    routeCode: j.route?.route_code ?? null,
    routeName: j.route?.name ?? null,
    vehicleNumber: j.mot_vehicle?.vehicle_number ?? null,
    motName: j.mot_profile?.name ?? null,
    completedShops: j._count.collections,
    totalShops: j._count.stops,
    grossLiters: toNumber(j.summary?.total_gross_liters) ?? 0,
    fatPercent: toNumber(j.summary?.weighted_avg_fat),
    lr: toNumber(j.summary?.weighted_avg_lr),
    status: j.status,
    etaOrArrival: j.status === 'COMPLETED' ? 'Arrived ZMCC' : j.status === 'CANCELLED' ? 'Cancelled' : 'Collecting',
  }));

  // Division intake: ZMCC tank receipts + contractor deliveries, with their quality
  const contractorVisits = contractorSources.flatMap((c) => c.visits);
  const intakeRows = [
    ...tankReceipts.map((r) => ({
      liters: toNumber(r.gross_liters) ?? 0,
      fat: toNumber(r.fat),
      lr: toNumber(r.lr),
      snf: toNumber(r.snf),
      at13ts: toNumber(r.at_13ts_liters),
    })),
    ...contractorVisits.map((v) => ({
      liters: toNumber(v.vehicle_dispatch_gross_liters) ?? 0,
      fat: toNumber(v.vehicle_dispatch_fat),
      lr: toNumber(v.vehicle_dispatch_lr),
      snf: toNumber(v.vehicle_dispatch_snf),
      at13ts: toNumber(v.vehicle_dispatch_at_13ts_liters),
    })),
  ];
  const totalIntakeLiters = round(intakeRows.reduce((sum, r) => sum + r.liters, 0));
  const at13tsKnown = intakeRows.length > 0 && intakeRows.every((r) => r.at13ts !== null);

  // Quality funnel
  const zmccTestedLiters = zmccLabSessionsToday.reduce((sum, s) => sum + (toNumber(s.gross_liters) ?? 0), 0);
  const zmccRejectedLiters = zmccLabSessionsToday
    .filter((s) => (s.final_decision ?? s.decision) === 'REJECTED')
    .reduce((sum, s) => sum + (toNumber(s.gross_liters) ?? 0), 0);
  const plantDecided = plantPortionsToday.map((p) => ({
    rejected: p.plant_decision === 'REJECTED',
    liters: portionLiters(p, toNumber(p.visit.vehicle_dispatch_density)) ?? 0,
  }));
  const plantDecidedLiters = plantDecided.reduce((sum, p) => sum + p.liters, 0);
  const plantRejectedLiters = plantDecided.filter((p) => p.rejected).reduce((sum, p) => sum + p.liters, 0);

  const incidents = { formalinCount: 0, ureaCount: 0, waterLowLrCount: 0, cobPositiveCount: 0 };
  for (const result of failedResultsToday.flat()) {
    const kind = incidentKind(result.lab_test, lrRoleHeld);
    if (kind === 'formalin') incidents.formalinCount++;
    else if (kind === 'urea') incidents.ureaCount++;
    else if (kind === 'waterLowLr') incidents.waterLowLrCount++;
    else if (kind === 'cobPositive') incidents.cobPositiveCount++;
  }

  // Emergency substitute vehicles
  const substituteVehicleIds = substituteAudits.map((a) => a.record_id);
  const substituteZmccIds = substituteAudits
    .map((a) => jsonString(a.new_values, 'zmcc_id'))
    .filter((id): id is string => Boolean(id))
    .map((id) => BigInt(id));
  const [substituteVehicles, substituteZmccs] = await Promise.all([
    prisma.motVehicle.findMany({ where: { id: { in: substituteVehicleIds } }, select: { id: true, is_active: true } }),
    prisma.procurementSource.findMany({ where: { id: { in: substituteZmccIds } }, select: { id: true, name: true } }),
  ]);
  const emergencySubstitutes = substituteAudits.map((a) => {
    const values = jsonRecord(a.new_values);
    const zmccId = jsonString(values, 'zmcc_id');
    const vehicle = substituteVehicles.find((v) => v.id === a.record_id);
    return {
      id: a.id.toString(),
      vehicleNumber: jsonString(values, 'vehicle_number') || `Vehicle #${a.record_id}`,
      vehicleType: jsonString(values, 'vehicle_type') || null,
      zmccName: substituteZmccs.find((z) => z.id.toString() === zmccId)?.name ?? null,
      registeredBy: personName(a.user),
      timestamp: a.created_at.toISOString(),
      status: (vehicle?.is_active ? 'ACTIVE' : 'INACTIVE') as 'ACTIVE' | 'INACTIVE',
    };
  });

  const loss = lossData?.summary ?? null;
  const tier = (t: { lossLiters: number; lossPercent: number }) => ({
    lossLiters: round(t.lossLiters),
    lossPercent: round(t.lossPercent),
  });

  return {
    businessDate: calendarDate,
    calendarDate,
    summary: {
      totalIntakeLiters,
      weightedFatPercent: weightedMean(intakeRows.map((r) => [r.fat, r.liters])),
      weightedLr: weightedMean(intakeRows.map((r) => [r.lr, r.liters])),
      weightedSnfPercent: weightedMean(intakeRows.map((r) => [r.snf, r.liters])),
      standardized13TsLiters: at13tsKnown ? round(intakeRows.reduce((sum, r) => sum + (r.at13ts ?? 0), 0)) : null,
      inTransitLiters: round(inTransitTankers.reduce((sum, t) => sum + t.grossLiters, 0)),
      inTransitTankerCount: inTransitTankers.length,
      supplyChainLossPercent: loss ? round(loss.tier4TotalLoss.lossPercent) : null,
      supplyChainLossLiters: loss ? round(loss.tier4TotalLoss.lossLiters) : null,
      activeZmccCount: zmccCenters.length,
      activeContractorCount: plantContractors.length,
    },
    lossTiers: loss
      ? {
          tier1RouteLoss: tier(loss.tier1RouteLoss),
          tier2ZmccLoss: tier(loss.tier2ZmccLoss),
          tier3TransitLoss: tier(loss.tier3TransitLoss),
          tier4TotalLoss: tier(loss.tier4TotalLoss),
        }
      : null,
    motRoutes,
    inTransitTankers,
    zmccCenters,
    intakeBySource,
    exitOutcomes: {
      leftWithoutFullUnloading: exitData.left.length,
      pendingCloseRequests: exitData.pending.length,
      acceptedNotReceivedLiters: round([...exitData.left, ...exitData.pending].reduce((t, x) => t + x.acceptedNotReceivedLiters, 0)),
    },
    plantContractors,
    qualityFunnel: {
      villageShopRejectedLiters: null,
      villageShopRejectionPercent: null,
      zmccGateRejectedLiters: round(zmccRejectedLiters),
      zmccGateRejectionPercent: percentOf(zmccRejectedLiters, zmccTestedLiters),
      plantGateRejectedLiters: round(plantRejectedLiters),
      plantGateRejectionPercent: percentOf(plantRejectedLiters, plantDecidedLiters),
      incidents,
    },
    governanceOverrides,
    emergencySubstitutes,
  };
}
