import { Prisma } from '@prisma/client';
import { withReportTimeout } from '@/backend/core/reportQuery';
import { createTtlCache } from './ttlCache';
import { writeAuditLog } from '@/backend/core/audit';
import { prisma } from '@core/db';
import { getSupplyChainLossHierarchy, lossFilterCacheKey, type LossFilters } from './lossCalculationService';
import type { LossFigure, LossPair } from '@/lib/lossGain';
import type { LossFiltersEcho, LossLevels, WholeLines } from '@/backend/modules/management-reporting/lossLevelContracts';
import { listZmccExitOutcomes } from './zmccManagerOverviewService';
import { getTankPhysicalStock, getBatchTankPhysicalStock, getBatchTankCommercialStock } from './zmccTankService';
import { getPakistanDayWindow } from '@core/business-day';
import { calculateAt13TSLiters } from '@/backend/utils/milkFormulas';
import { findRoleResult, isRoleTest } from '@/backend/utils/roleAwareMatch';
import { loadSystemRoles, type PolicyDb } from './testPointPolicyService';
import { jsonRecord, jsonString } from '@/lib/json';

/**
 * Every figure below is computed from recorded data. A `null` means there is
 * nothing recorded for it (today, or at all); the dashboard shows it as "—".
 */

/** received minus sent: negative is a loss, positive a gain. The @13 TS figure is the commercial one. */
export interface LossTierTelemetry {
  lossLiters: number;
  lossPercent: number;
  /** Milk gained in this tier; a tier shows either a loss or a gain. */
  gainLiters: number;
  signedLiters: number;
  signedPercent: number;
  at13tsSignedLiters: number;
  at13tsSignedPercent: number;
  /** Each record's own loss and gain added up (set for the route and transit tiers). */
  grossLossLiters: number | null;
  grossGainLiters: number | null;
}

/** The Loss / Gain levels without their row lists: the figures the Command Center card shows. */
export interface LossLevelsOverview {
  filters: LossFiltersEcho;
  mot: LossFigure;
  area: LossFigure;
  transit: { atZmcc: LossFigure; onRoad: LossFigure; net: LossFigure; highLossCount: number };
  whole: { net: { at13ts: LossPair; gross: LossPair }; lines: WholeLines; reconciles: boolean };
  contractorTransit: LossFigure;
}

export interface MpdExecutiveTelemetry {
  businessDate: string;
  calendarDate: string;
  summary: {
    totalIntakeLiters: number;
    /** @13 TS of the intake records that have one; records without it are counted, never filled from gross. */
    totalIntakeAt13tsLiters: number;
    totalIntakeMissing13tsCount: number;
    weightedFatPercent: number | null;
    weightedLr: number | null;
    weightedSnfPercent: number | null;
    standardized13TsLiters: number | null;
    inTransitLiters: number;
    inTransitTankerCount: number;
    inTransitAt13tsLiters: number;
    inTransitMissing13tsCount: number;
    /** Whole Loss / Gain (bought vs plant received): gain minus loss, @13 TS main and gross beside it. */
    wholeSignedAt13tsLiters: number | null;
    wholeSignedAt13tsPercent: number | null;
    wholeSignedLiters: number | null;
    wholeSignedPercent: number | null;
    /** The older tier-based figures, kept until the screens move to the whole fields above. */
    supplyChainSignedAt13tsLiters: number | null;
    supplyChainSignedAt13tsPercent: number | null;
    supplyChainSignedLiters: number | null;
    supplyChainSignedPercent: number | null;
    activeZmccCount: number;
    activeContractorCount: number;
  };
  /** The Loss / Gain levels for the chosen range (today unless a filter is sent); null when the calculation could not run. */
  lossLevels: LossLevelsOverview | null;
  /** The older four-tier breakdown (Tier 4 is Whole); null when the loss calculation could not run. */
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
    intakeAt13tsLiters: number;
    intakeMissing13tsCount: number;
    /** Current physical stock across the ZMCC's active tanks (inventory ledger). */
    siloStockLiters: number;
    /** Current commercial stock @13TS across the ZMCC's active tanks. */
    siloStockAt13tsLiters: number;
    siloCapacityPercent: number | null;
    avgFatPercent: number | null;
    avgLr: number | null;
    dispatchedLiters: number;
    dispatchedAt13tsLiters: number;
    dispatchedMissing13tsCount: number;
    dispatchedTankerCount: number;
    isActive: boolean;
    /** Exit-outcome reporting (last 30 days): vehicles that left / were closed without full unloading. */
    leftWithoutFullUnloadingCount: number;
    pendingCloseRequestCount: number;
    /** Accepted by the lab but never received into a tank; excluded from loss. */
    acceptedNotReceivedLiters: number;
    acceptedNotReceivedAt13tsLiters: number;
    acceptedNotReceivedMissing13tsCount: number;
  }>;
  /** Today's received milk grouped by milk source (name always; ERP code only for owner/reporting roles). */
  intakeBySource: Array<{
    sourceId: string | null;
    sourceName: string;
    erpCode: string | null;
    netKg: number;
    grossLiters: number;
    at13tsLiters: number;
    missing13tsCount: number;
    avgLr: number | null;
    avgFatPercent: number | null;
    avgSnfPercent: number | null;
    avgTsPercent: number | null;
  }>;
  /** Totals of the exit-outcome counters across every ZMCC. */
  exitOutcomes: {
    leftWithoutFullUnloading: number;
    pendingCloseRequests: number;
    acceptedNotReceivedLiters: number;
    acceptedNotReceivedAt13tsLiters: number;
    acceptedNotReceivedMissing13tsCount: number;
  };
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
    /** @13 TS of the rejected milk that has tests; the rest is counted as missing. */
    zmccGateRejectedAt13tsLiters: number;
    zmccGateRejectedMissing13tsCount: number;
    zmccGateRejectionPercent: number | null;
    plantGateRejectedLiters: number;
    plantGateRejectedAt13tsLiters: number;
    plantGateRejectedMissing13tsCount: number;
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

/** Litres the plant received and accepted from a visit. In-transit and rejected milk is not delivered. */
function deliveredVisitLiters(visit: {
  current_status: string;
  vehicle_dispatch_gross_liters: Numeric;
  vehicle_dispatch_density: Numeric;
  portions: Array<{ plant_decision: string | null; dispatch_quantity_value: Numeric; dispatch_quantity_unit: string | null }>;
}): number {
  if (visit.current_status === 'REJECTED') return 0;
  const accepted = visit.portions.filter((p) => p.plant_decision === 'ACCEPTED');
  if (accepted.length === 0) return 0;
  if (accepted.length === visit.portions.length) return toNumber(visit.vehicle_dispatch_gross_liters) ?? 0;
  const density = toNumber(visit.vehicle_dispatch_density);
  return accepted.reduce((sum, p) => sum + (portionLiters(p, density) ?? 0), 0);
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

/** The latest GPS fix of each journey, picked in the database so only one row per journey is read. */
async function loadLastJourneyFixes(journeyIds: bigint[]) {
  return withReportTimeout((tx) =>
    tx.$queryRaw<Array<{
      journey_id: bigint;
      latitude: number | null;
      longitude: number | null;
      heading_deg: number | null;
      speed_mps: number | null;
      device_recorded_at: Date;
    }>>`
      SELECT DISTINCT ON (journey_id) journey_id, latitude::float8 AS latitude, longitude::float8 AS longitude,
             heading_deg::float8 AS heading_deg, speed_mps::float8 AS speed_mps, device_recorded_at
      FROM mot_journey_location
      WHERE journey_id IN (${Prisma.join(journeyIds)})
      ORDER BY journey_id, device_recorded_at DESC, id DESC`
  );
}

/**
 * Command Center overview, shared between screens. Every open Command Center polls this every 30 s; the figures are
 * the same for everyone except the ERP code column and the Loss / Gain filter, so one computation per variant
 * (ERP column + filter) is reused for a few seconds. Nothing else is scoped to a ZMCC or a user.
 */
export const MPD_OVERVIEW_CACHE_TTL_MS = 15_000;
const overviewCache = createTtlCache<MpdExecutiveTelemetry>({ ttlMs: MPD_OVERVIEW_CACHE_TTL_MS });

export function clearMpdExecutiveTelemetryCache(): void {
  overviewCache.clear();
}

export interface MpdOverviewOptions {
  includeErpCode?: boolean;
  /** Narrows only the Loss / Gain figures: range, ZMCCs, contractors, Mobile Tester. Default is today, every ZMCC. */
  lossFilter?: LossFilters;
}

export async function getMpdExecutiveTelemetry(options: MpdOverviewOptions = {}): Promise<MpdExecutiveTelemetry> {
  const key = `${options.includeErpCode ? 'erp' : 'no-erp'}|${lossFilterCacheKey(options.lossFilter ?? { preset: 'TODAY' })}`;
  return overviewCache.get(key, () => computeMpdExecutiveTelemetry(options));
}

function overviewOfLevels(levels: LossLevels): LossLevelsOverview {
  return {
    filters: levels.filters,
    mot: levels.mot.total,
    area: levels.area.total,
    transit: {
      atZmcc: levels.transit.atZmcc,
      onRoad: levels.transit.onRoad,
      net: levels.transit.net,
      highLossCount: levels.transit.highLossCount,
    },
    whole: { net: levels.whole.net, lines: levels.whole.lines, reconciles: levels.whole.reconciles },
    contractorTransit: levels.contractorTransit.total,
  };
}

export async function computeMpdExecutiveTelemetry(options: MpdOverviewOptions = {}): Promise<MpdExecutiveTelemetry> {
  // Same Pakistan day as the Loss / Gain service, so figures agree.
  const day = getPakistanDayWindow();
  const calendarDate = day.calendarDate;
  const today = { gte: day.start, lte: day.end };
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
      where: { operational_date: { gte: day.dateStart, lte: day.dateEnd } },
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
      select: { final_decision: true, decision: true, gross_liters: true, at_13ts_liters: true },
    }),
    // 6. Plant reception decisions made today
    prisma.visitPortion.findMany({
      where: { plant_decided_at: today, plant_decision: { in: ['ACCEPTED', 'REJECTED'] } },
      select: {
        plant_decision: true,
        dispatch_quantity_value: true,
        dispatch_quantity_unit: true,
        visit: { select: { vehicle_dispatch_density: true, vehicle_dispatch_ts: true } },
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
    getSupplyChainLossHierarchy({ preset: 'TODAY', ...(options.lossFilter ?? {}) }).catch(() => null),
  ]);

  // ZMCC centers
  const zmccSources = activeSources.filter((s) => s.source_type === 'ZMCC');
  const allTankIds = zmccSources.flatMap((z) => z.zmcc_tanks.map((t) => t.id));
  const exitItems = [...exitData.left, ...exitData.pending];
  const exitSessionIds = [...new Set(exitItems.map((x) => x.sessionId))].map((id) => BigInt(id));
  const [tankStocks, tankCommercialStocks, notReceivedPortions] = await Promise.all([
    getBatchTankPhysicalStock(allTankIds),
    getBatchTankCommercialStock(allTankIds),
    // @13 TS of the milk accepted but never unloaded, from the portions' own tests.
    exitSessionIds.length
      ? prisma.zmccLabPortion.findMany({
          where: { lab_session_id: { in: exitSessionIds }, final_decision: 'ACCEPTED', status: { notIn: ['WEIGHED', 'LOADED'] } },
          select: { lab_session_id: true, gross_liters: true, ts: true, at_13ts_liters: true },
        })
      : Promise.resolve([]),
  ]);
  const notReceivedBySession = new Map<string, { at13ts: number; missing: number }>();
  for (const p of notReceivedPortions) {
    const gross = toNumber(p.gross_liters);
    const ts = toNumber(p.ts);
    const stored = toNumber(p.at_13ts_liters);
    const at13 = stored ?? (gross !== null && ts !== null && ts > 0 ? calculateAt13TSLiters(gross, ts) : null);
    const entry = notReceivedBySession.get(p.lab_session_id.toString()) ?? { at13ts: 0, missing: 0 };
    if (at13 === null) entry.missing += 1;
    else entry.at13ts += at13;
    notReceivedBySession.set(p.lab_session_id.toString(), entry);
  }
  const notReceived13 = (items: typeof exitItems) => {
    let at13ts = 0;
    let missing = 0;
    for (const x of items) {
      const e = notReceivedBySession.get(x.sessionId);
      if (!e) continue;
      at13ts += e.at13ts;
      missing += e.missing;
    }
    return { at13ts: round(at13ts), missing };
  };

  const zmccCenters = zmccSources.map((zmcc) => {
    const received = tankReceipts.filter((r) => r.zmcc_id === zmcc.id);
    const dispatched = zmcc.visits.map((v) => ({
      liters: toNumber(v.vehicle_dispatch_gross_liters) ?? 0,
      at13ts: toNumber(v.vehicle_dispatch_at_13ts_liters),
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
      intakeAt13tsLiters: round(received.reduce((sum, r) => sum + (toNumber(r.at_13ts_liters) ?? 0), 0)),
      intakeMissing13tsCount: received.filter((r) => toNumber(r.at_13ts_liters) === null).length,
      siloStockLiters: round(stock),
      siloStockAt13tsLiters: round(commercialStock),
      siloCapacityPercent: capacity > 0 ? Math.round((stock / capacity) * 100) : null,
      avgFatPercent: weightedMean(dispatched.map((d) => [d.fat, d.liters])),
      avgLr: weightedMean(dispatched.map((d) => [d.lr, d.liters])),
      dispatchedLiters: round(dispatched.reduce((sum, d) => sum + d.liters, 0)),
      dispatchedAt13tsLiters: round(dispatched.reduce((sum, d) => sum + (d.at13ts ?? 0), 0)),
      dispatchedMissing13tsCount: dispatched.filter((d) => d.at13ts === null).length,
      dispatchedTankerCount: dispatched.length,
      isActive: zmcc.is_active,
      leftWithoutFullUnloadingCount: exitData.left.filter((x) => x.zmccId === zmcc.id.toString()).length,
      pendingCloseRequestCount: exitData.pending.filter((x) => x.zmccId === zmcc.id.toString()).length,
      acceptedNotReceivedLiters: round(
        exitItems.filter((x) => x.zmccId === zmcc.id.toString()).reduce((t, x) => t + x.acceptedNotReceivedLiters, 0)
      ),
      acceptedNotReceivedAt13tsLiters: notReceived13(exitItems.filter((x) => x.zmccId === zmcc.id.toString())).at13ts,
      acceptedNotReceivedMissing13tsCount: notReceived13(exitItems.filter((x) => x.zmccId === zmcc.id.toString())).missing,
    };
  });

  // Received milk by source (net kg from weighed portions via receipt quantity)
  const bySource = new Map<string, {
    sourceId: string | null; sourceName: string; erpCode: string | null; netKg: number; gross: number; at13: number; missing13: number;
    lr: Array<[number | null, number]>; fat: Array<[number | null, number]>; snf: Array<[number | null, number]>; ts: Array<[number | null, number]>;
  }>();
  for (const r of tankReceipts) {
    const name = r.milk_source?.name ?? r.milk_source_name_snapshot ?? (r.milk_source_id ? 'Unknown source' : 'MC collections (per shop source)');
    const key = r.milk_source_id ? r.milk_source_id.toString() : `none:${name}`;
    const netKg = toNumber(r.quantity_value) ?? 0;
    const entry = bySource.get(key) ?? {
      sourceId: r.milk_source_id ? r.milk_source_id.toString() : null, sourceName: name,
      erpCode: options.includeErpCode ? r.milk_source?.erp_code ?? null : null, netKg: 0, gross: 0, at13: 0, missing13: 0, lr: [], fat: [], snf: [], ts: [],
    };
    entry.netKg += r.quantity_unit === 'KG' ? netKg : 0;
    entry.gross += toNumber(r.gross_liters) ?? 0;
    entry.at13 += toNumber(r.at_13ts_liters) ?? 0;
    if (toNumber(r.at_13ts_liters) === null) entry.missing13 += 1;
    const w = r.quantity_unit === 'KG' ? netKg : toNumber(r.gross_liters) ?? 0;
    entry.lr.push([toNumber(r.lr), w]); entry.fat.push([toNumber(r.fat), w]); entry.snf.push([toNumber(r.snf), w]); entry.ts.push([toNumber(r.ts), w]);
    bySource.set(key, entry);
  }
  const intakeBySource = [...bySource.values()].map((e) => ({
    sourceId: e.sourceId, sourceName: e.sourceName, erpCode: e.erpCode,
    netKg: round(e.netKg), grossLiters: round(e.gross), at13tsLiters: round(e.at13), missing13tsCount: e.missing13,
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
      deliveredLiters: round(c.visits.reduce((sum, v) => sum + deliveredVisitLiters(v), 0)),
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
  const lastFixes = activeJourneys.length ? await loadLastJourneyFixes(activeJourneys.map((j) => j.id)) : [];
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
    ...contractorVisits.flatMap((v) => {
      const liters = deliveredVisitLiters(v);
      if (liters <= 0) return [];
      const ts = toNumber(v.vehicle_dispatch_ts);
      const fullVisit = liters === toNumber(v.vehicle_dispatch_gross_liters);
      return [{
        liters,
        fat: toNumber(v.vehicle_dispatch_fat),
        lr: toNumber(v.vehicle_dispatch_lr),
        snf: toNumber(v.vehicle_dispatch_snf),
        at13ts: fullVisit ? toNumber(v.vehicle_dispatch_at_13ts_liters) : ts !== null ? calculateAt13TSLiters(liters, ts) : null,
      }];
    }),
  ];
  const totalIntakeLiters = round(intakeRows.reduce((sum, r) => sum + r.liters, 0));
  const at13tsKnown = intakeRows.length > 0 && intakeRows.every((r) => r.at13ts !== null);
  const intakeAt13ts = round(intakeRows.reduce((sum, r) => sum + (r.at13ts ?? 0), 0));
  const intakeMissing13ts = intakeRows.filter((r) => r.at13ts === null).length;

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
  // @13 TS of rejected milk: only where a test (TS) exists; the rest is counted as missing, never taken from gross.
  const rejectedLabSessions = zmccLabSessionsToday.filter((s) => (s.final_decision ?? s.decision) === 'REJECTED');
  const zmccRejected13 = rejectedLabSessions.reduce((sum, s) => sum + (toNumber(s.at_13ts_liters) ?? 0), 0);
  const zmccRejectedMissing13 = rejectedLabSessions.filter((s) => toNumber(s.at_13ts_liters) === null).length;
  let plantRejected13 = 0;
  let plantRejectedMissing13 = 0;
  for (const p of plantPortionsToday) {
    if (p.plant_decision !== 'REJECTED') continue;
    const liters = portionLiters(p, toNumber(p.visit.vehicle_dispatch_density));
    const ts = toNumber(p.visit.vehicle_dispatch_ts);
    if (liters === null || ts === null || !(ts > 0)) plantRejectedMissing13 += 1;
    else plantRejected13 += calculateAt13TSLiters(liters, ts);
  }

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
  const levels = lossData?.levels ?? null;
  const exitTotals13 = notReceived13(exitItems);
  const tier = (t: {
    lossLiters: number;
    lossPercent: number;
    gainLiters: number;
    signedVarianceLiters: number;
    signedVariancePercent: number;
    signedVarianceAt13tsLiters: number;
    signedVarianceAt13tsPercent: number;
    grossLossLiters?: number;
    grossGainLiters?: number;
  }) => ({
    lossLiters: round(t.lossLiters),
    lossPercent: round(t.lossPercent),
    gainLiters: round(t.gainLiters),
    signedLiters: round(t.signedVarianceLiters),
    signedPercent: round(t.signedVariancePercent),
    at13tsSignedLiters: round(t.signedVarianceAt13tsLiters),
    at13tsSignedPercent: round(t.signedVarianceAt13tsPercent),
    grossLossLiters: t.grossLossLiters != null ? round(t.grossLossLiters) : null,
    grossGainLiters: t.grossGainLiters != null ? round(t.grossGainLiters) : null,
  });

  return {
    businessDate: calendarDate,
    calendarDate,
    summary: {
      totalIntakeLiters,
      totalIntakeAt13tsLiters: intakeAt13ts,
      totalIntakeMissing13tsCount: intakeMissing13ts,
      weightedFatPercent: weightedMean(intakeRows.map((r) => [r.fat, r.liters])),
      weightedLr: weightedMean(intakeRows.map((r) => [r.lr, r.liters])),
      weightedSnfPercent: weightedMean(intakeRows.map((r) => [r.snf, r.liters])),
      standardized13TsLiters: at13tsKnown ? round(intakeRows.reduce((sum, r) => sum + (r.at13ts ?? 0), 0)) : null,
      inTransitLiters: round(inTransitTankers.reduce((sum, t) => sum + t.grossLiters, 0)),
      inTransitTankerCount: inTransitTankers.length,
      inTransitAt13tsLiters: round(inTransitTankers.reduce((sum, t) => sum + (t.at13tsLiters ?? 0), 0)),
      inTransitMissing13tsCount: inTransitTankers.filter((t) => t.at13tsLiters === null).length,
      wholeSignedAt13tsLiters: levels ? round(levels.whole.net.at13ts.signed) : null,
      wholeSignedAt13tsPercent: levels && levels.whole.net.at13ts.percent !== null ? round(levels.whole.net.at13ts.percent) : null,
      wholeSignedLiters: levels ? round(levels.whole.net.gross.signed) : null,
      wholeSignedPercent: levels && levels.whole.net.gross.percent !== null ? round(levels.whole.net.gross.percent) : null,
      supplyChainSignedAt13tsLiters: loss ? round(loss.tier4TotalLoss.signedVarianceAt13tsLiters) : null,
      supplyChainSignedAt13tsPercent: loss ? round(loss.tier4TotalLoss.signedVarianceAt13tsPercent) : null,
      supplyChainSignedLiters: loss ? round(loss.tier4TotalLoss.signedVarianceLiters) : null,
      supplyChainSignedPercent: loss ? round(loss.tier4TotalLoss.signedVariancePercent) : null,
      activeZmccCount: zmccCenters.length,
      activeContractorCount: plantContractors.length,
    },
    lossLevels: levels ? overviewOfLevels(levels) : null,
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
      acceptedNotReceivedLiters: round(exitItems.reduce((t, x) => t + x.acceptedNotReceivedLiters, 0)),
      acceptedNotReceivedAt13tsLiters: exitTotals13.at13ts,
      acceptedNotReceivedMissing13tsCount: exitTotals13.missing,
    },
    plantContractors,
    qualityFunnel: {
      villageShopRejectedLiters: null,
      villageShopRejectionPercent: null,
      zmccGateRejectedLiters: round(zmccRejectedLiters),
      zmccGateRejectedAt13tsLiters: round(zmccRejected13),
      zmccGateRejectedMissing13tsCount: zmccRejectedMissing13,
      zmccGateRejectionPercent: percentOf(zmccRejectedLiters, zmccTestedLiters),
      plantGateRejectedLiters: round(plantRejectedLiters),
      plantGateRejectedAt13tsLiters: round(plantRejected13),
      plantGateRejectedMissing13tsCount: plantRejectedMissing13,
      plantGateRejectionPercent: percentOf(plantRejectedLiters, plantDecidedLiters),
      incidents,
    },
    governanceOverrides,
    emergencySubstitutes,
  };
}
