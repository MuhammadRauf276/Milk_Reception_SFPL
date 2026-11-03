import { NextResponse } from 'next/server';
import { ACTING_AS_HEADER, requireRoles, scopeFailureResponse } from '@core/route-guards';
import { asRoleFields } from '@core/acting-context';
import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { createDispatchSchema } from '@/lib/validations/dispatch';
import { evaluateLabResult } from '@/lib/lab-rules';
import { generateReceptionNumber } from '@/lib/reception-number';
import { validateRequiredString } from '@/lib/validation-helpers';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';
import { calculateDensity, calculateGrossLiters, computeCanonicalMilkMetrics } from '@/backend/utils/milkFormulas';
import { getOrAssignDispatchTests } from '@/backend/services/labTestAssignmentService';
import { storedCalculatedValue } from '@/backend/services/dispatch/calculatedResultValue';
import { getOrFreezeDispatchQuantityPolicy } from '@/backend/modules/dispatch/quantity-policy/quantityPolicyService';
import { validateDispatchQuantities, QuantityMeasurementError } from '@/backend/modules/dispatch/quantity/dispatchQuantityService';
import { getPakistanCalendarDate } from '@/backend/core/business-day';

import { PaperReferenceService, PaperValidationError } from '@/backend/services/paperReferenceService';
import { PaperReferenceType } from '@prisma/client';
import { paperLinkedIdentity } from '@/backend/modules/paper-references';
import { getErrorCode, getErrorIssues, getErrorMessage, getErrorName } from '@/lib/errors';
import type { LabTestResultOption } from '@/lib/validations/labTest';
import { jsonString } from '@/lib/json';
import {
  DISPATCH_READ_ROLES,
  DISPATCH_SOURCE_FAILURE_MESSAGES,
  DISPATCH_WRITE_ROLES,
  checkDispatchSource,
  dispatchListFilter,
  dispatchSourceIdToLoad,
  isScopeFailure,
  resolveDispatchActing,
  dispatchPointFor,
  dispatchApproverRoleFor,
  canDecideDispatch,
  type DispatchSourceFailure,
} from '@/backend/services/dispatchScope';
import { writeAuditLog } from '@/backend/core/audit';
import { pickVehicleLrFat } from '@/backend/services/dispatch/vehicleQuality';
import {
  buildDispatchDecision,
  loadDispatchPolicy,
  issueDispatchFromZmccTankTx,
  zmccTankRemainingLiters,
  notifyDispatchApproversTx,
  auditActorOf,
  DISPATCH_STATUS,
  DispatchFlowError,
  type DispatchTestMode,
  type DispatchPortionInput,
} from '@/backend/services/dispatch/dispatchDecisionService';

function dispatchSourceFailureResponse(code: DispatchSourceFailure) {
  if (isScopeFailure(code)) return scopeFailureResponse(code);
  return NextResponse.json({ error: DISPATCH_SOURCE_FAILURE_MESSAGES[code], code }, { status: 400 });
}

const dispatchListInclude = {
  creator: true,
  procurement_source: true,
  mot_vehicle: true,
  mot_profile: true,
  portions: {
    include: {
      dispatch_info: true,
    },
    orderBy: { portion_number: 'asc' },
  },
  gate_log: true,
} satisfies Prisma.VehicleVisitInclude;

type DispatchListVisit = Prisma.VehicleVisitGetPayload<{ include: typeof dispatchListInclude }>;

function serializeDispatch(visit: DispatchListVisit) {
  const portions = visit.portions || [];
  const firstPortion = portions[0];
  const firstDispatchInfo = firstPortion?.dispatch_info;
  const gateLog = visit.gate_log;

  const vehicleQuantityValue = visit.vehicle_dispatch_quantity_value !== null && visit.vehicle_dispatch_quantity_value !== undefined
    ? Number(visit.vehicle_dispatch_quantity_value)
    : null;
  const vehicleQuantityUnit = visit.vehicle_dispatch_quantity_unit || null;
  const vehicleQuantityBasis = visit.vehicle_dispatch_quantity_basis || null;

  const vehicleDispatchLr = visit.vehicle_dispatch_lr !== null && visit.vehicle_dispatch_lr !== undefined
    ? Number(visit.vehicle_dispatch_lr)
    : null;
  const vehicleDispatchDensity = visit.vehicle_dispatch_density !== null && visit.vehicle_dispatch_density !== undefined
    ? Number(visit.vehicle_dispatch_density)
    : null;
  const vehicleDispatchGrossLiters = visit.vehicle_dispatch_gross_liters !== null && visit.vehicle_dispatch_gross_liters !== undefined
    ? Number(visit.vehicle_dispatch_gross_liters)
    : null;
  const vehicleDispatchFat = visit.vehicle_dispatch_fat !== null && visit.vehicle_dispatch_fat !== undefined
    ? Number(visit.vehicle_dispatch_fat)
    : null;
  const vehicleDispatchSnf = visit.vehicle_dispatch_snf !== null && visit.vehicle_dispatch_snf !== undefined
    ? Number(visit.vehicle_dispatch_snf)
    : null;
  const vehicleDispatchTs = visit.vehicle_dispatch_ts !== null && visit.vehicle_dispatch_ts !== undefined
    ? Number(visit.vehicle_dispatch_ts)
    : null;
  const vehicleDispatchAt13tsLiters = visit.vehicle_dispatch_at_13ts_liters !== null && visit.vehicle_dispatch_at_13ts_liters !== undefined
    ? Number(visit.vehicle_dispatch_at_13ts_liters)
    : null;

  const dispatchTimestamp = firstDispatchInfo?.dispatch_timestamp
    ? new Date(firstDispatchInfo.dispatch_timestamp).toISOString()
    : null;

  const dispatchDate = firstDispatchInfo?.dispatch_timestamp
    ? getPakistanCalendarDate(firstDispatchInfo.dispatch_timestamp)
    : null;

  return {
    id: visit.id.toString(),
    visit_number: visit.visit_number,
    reception_number: visit.reception_number || null,
    vehicle_number: visit.vehicle_number,
    token_number: visit.token_number || null,
    raw_milk_dispatch_note_number: visit.raw_milk_dispatch_note_number || null,
    identifiers: paperLinkedIdentity(
      { entity: 'vehicle_visit', id: visit.id.toString(), number: visit.visit_number },
      [{ type: 'RAW_MILK_DISPATCH_NOTE', value: visit.raw_milk_dispatch_note_number || null }]
    ),
    dispatch_timestamp: dispatchTimestamp,
    dispatch_date: dispatchDate,
    operational_date: visit.operational_date ? visit.operational_date.toISOString().split('T')[0] : null,
    current_status: visit.current_status,
    portion_count: portions.length,
    vehicle_dispatch_quantity_value: vehicleQuantityValue,
    vehicle_dispatch_quantity_unit: vehicleQuantityUnit,
    vehicle_dispatch_quantity_basis: vehicleQuantityBasis,
    vehicle_dispatch_lr: vehicleDispatchLr,
    vehicle_dispatch_fat: vehicleDispatchFat,
    vehicle_dispatch_density: vehicleDispatchDensity,
    vehicle_dispatch_gross_liters: vehicleDispatchGrossLiters,
    vehicle_dispatch_snf: vehicleDispatchSnf,
    vehicle_dispatch_ts: vehicleDispatchTs,
    vehicle_dispatch_at_13ts_liters: vehicleDispatchAt13tsLiters,
    vehicle_dispatch_calculation_version: visit.vehicle_dispatch_calculation_version || null,
    procurement_source_id: visit.procurement_source_id ? visit.procurement_source_id.toString() : null,
    zonal_contractor_name: visit.procurement_source?.name || 'Source unavailable',
    procurement_source_type: visit.procurement_source?.source_type || 'UNKNOWN',
    mot_vehicle_id: visit.mot_vehicle_id ? visit.mot_vehicle_id.toString() : null,
    mot_profile_id: visit.mot_profile_id ? visit.mot_profile_id.toString() : null,
    mot_name: visit.mot_profile?.name || null,
    mot_code: visit.mot_profile?.mot_code || null,
    driver_name: visit.driver_name || visit.mot_profile?.name || null,
    zonal_contractor_dispatch_time: firstDispatchInfo?.dispatch_timestamp
      ? new Date(firstDispatchInfo.dispatch_timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : null,
    dispatch_testing_mode: firstDispatchInfo?.dispatch_testing_mode || 'FULL',
    dispatch_testing_reason: firstDispatchInfo?.dispatch_testing_reason || null,
    has_gate_entry: !!gateLog?.entry_timestamp,
    portions: portions.map((p) => ({
      id: p.id.toString(),
      portion_number: p.portion_number,
      dispatch_quantity_value: p.dispatch_quantity_value !== null && p.dispatch_quantity_value !== undefined
        ? Number(p.dispatch_quantity_value)
        : null,
      dispatch_quantity_unit: p.dispatch_quantity_unit || null,
      dispatch_quantity_basis: p.dispatch_quantity_basis || null,
      plant_decision: p.plant_decision || 'PENDING',
      current_status: p.current_status,
    })),
  };
}


function shiftPakistanCalendarDate(dateStr: string, daysOffset: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + daysOffset));
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export async function GET(req: Request) {
  const guard = await requireRoles(req, DISPATCH_READ_ROLES);
  if ('response' in guard) return guard.response;

  const searchParams = new URL(req.url).searchParams;
  const range = searchParams.get('range') || '7d';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.max(1, Math.min(100, parseInt(searchParams.get('pageSize') || '20', 10)));
  const fromDateParam = searchParams.get('fromDate');
  const toDateParam = searchParams.get('toDate');
  const statusFilter = searchParams.get('status');

  let gteDate: Date | undefined;
  let lteDate: Date | undefined;

  const todayPkt = getPakistanCalendarDate(new Date());

  if (range === 'today') {
    gteDate = new Date(`${todayPkt}T00:00:00.000+05:00`);
    lteDate = new Date(`${todayPkt}T23:59:59.999+05:00`);
  } else if (range === '7d') {
    const startDatePkt = shiftPakistanCalendarDate(todayPkt, -6);
    gteDate = new Date(`${startDatePkt}T00:00:00.000+05:00`);
    lteDate = new Date(`${todayPkt}T23:59:59.999+05:00`);
  } else if (range === '30d') {
    const startDatePkt = shiftPakistanCalendarDate(todayPkt, -29);
    gteDate = new Date(`${startDatePkt}T00:00:00.000+05:00`);
    lteDate = new Date(`${todayPkt}T23:59:59.999+05:00`);
  } else if (range === 'custom') {
    if (fromDateParam) {
      gteDate = new Date(`${fromDateParam}T00:00:00.000+05:00`);
    }
    if (toDateParam) {
      lteDate = new Date(`${toDateParam}T23:59:59.999+05:00`);
    }
    if (gteDate && lteDate && gteDate > lteDate) {
      return NextResponse.json({ error: 'From Date cannot be after To Date' }, { status: 400 });
    }
  }

  const whereClause: Prisma.VehicleVisitWhereInput = {
    current_status: statusFilter ? statusFilter : { notIn: ['CANCELLED', 'DRAFT_DISPATCH'] },
  };

  // SOURCE AUTHORIZATION FILTERING (from the acting scope, fail closed):
  // SOURCE scope -> only the bound source; SYSTEM scope -> all, or the optional
  // procurementSourceId query param; anything else -> nothing.
  const listFilter = dispatchListFilter(guard.acting.scope, searchParams.get('procurementSourceId'));
  const listSourceId = listFilter.kind === 'SOURCE' ? listFilter.sourceId : listFilter.kind === 'NONE' ? BigInt(-1) : null;

  if (listSourceId !== null) {
    whereClause.procurement_source_id = listSourceId;
  }

  if (gteDate || lteDate) {
    whereClause.portions = {
      some: {
        dispatch_info: {
          dispatch_timestamp: {
            ...(gteDate ? { gte: gteDate } : {}),
            ...(lteDate ? { lte: lteDate } : {}),
          },
        },
      },
    };
  }

  try {
    const totalRecords = await prisma.vehicleVisit.count({ where: whereClause });
    const totalPages = Math.ceil(totalRecords / pageSize) || 1;

    // Construct dynamic parameterized SQL conditions mirroring whereClause
    const conditions: Prisma.Sql[] = [];

    if (statusFilter) {
      conditions.push(Prisma.sql`vv.current_status = ${statusFilter}`);
    } else {
      conditions.push(Prisma.sql`vv.current_status NOT IN ('CANCELLED', 'DRAFT_DISPATCH')`);
    }

    if (listSourceId !== null) {
      conditions.push(Prisma.sql`vv.procurement_source_id = ${listSourceId}`);
    }

    if (gteDate && lteDate) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM visit_portion vp2
        JOIN dispatch_info di2 ON di2.portion_id = vp2.id
        WHERE vp2.visit_id = vv.id
          AND di2.dispatch_timestamp >= ${gteDate}
          AND di2.dispatch_timestamp <= ${lteDate}
      )`);
    } else if (gteDate) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM visit_portion vp2
        JOIN dispatch_info di2 ON di2.portion_id = vp2.id
        WHERE vp2.visit_id = vv.id
          AND di2.dispatch_timestamp >= ${gteDate}
      )`);
    } else if (lteDate) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM visit_portion vp2
        JOIN dispatch_info di2 ON di2.portion_id = vp2.id
        WHERE vp2.visit_id = vv.id
          AND di2.dispatch_timestamp <= ${lteDate}
      )`);
    }

    const whereSql = conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;

    const offset = (page - 1) * pageSize;

    // Authoritative dispatch chronology: order newest-first by DispatchInfo.dispatch_timestamp
    // with deterministic visit.id DESC tie-breaker, NOT by vehicle_visit.created_at.
    const idRows = await prisma.$queryRaw<Array<{ id: bigint }>>`
      SELECT vv.id
      FROM vehicle_visit vv
      LEFT JOIN (
        SELECT vp.visit_id, MAX(di.dispatch_timestamp) AS max_disp_ts
        FROM visit_portion vp
        JOIN dispatch_info di ON di.portion_id = vp.id
        GROUP BY vp.visit_id
      ) disp ON disp.visit_id = vv.id
      ${whereSql}
      ORDER BY disp.max_disp_ts DESC NULLS LAST, vv.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    let visits: DispatchListVisit[] = [];
    if (idRows.length > 0) {
      const visitIds = idRows.map((r) => r.id);
      const fetchedVisits = await prisma.vehicleVisit.findMany({
        where: { id: { in: visitIds } },
        include: dispatchListInclude,
      });

      const visitMap = new Map(fetchedVisits.map((v) => [v.id.toString(), v]));
      visits = visitIds
        .map((id) => visitMap.get(id.toString()))
        .filter((v): v is DispatchListVisit => Boolean(v));
    }

    return NextResponse.json({
      dispatches: visits.map(serializeDispatch),
      pagination: {
        page,
        pageSize,
        totalRecords,
        totalPages,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) || 'Failed to fetch dispatches' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // 1. Authenticated, active dispatch role (ZMCC Lab Attendant / Contractor Operator, or a superior
  // doing their work). Source binding is checked against the acting scope below.
  const guard = await requireRoles(req, DISPATCH_WRITE_ROLES);
  if ('response' in guard) return guard.response;
  const requestedAs = req.headers.get(ACTING_AS_HEADER);

  // Real user is always stored; the acting role and delegation flag are stamped beside it.
  const userIdBigInt = guard.acting.userId;

  try {
    const body = await req.json();
    const validated = createDispatchSchema.parse(body);

    if (!validated.visitId) {
      return NextResponse.json(
        { error: 'Draft visitId is required for dispatch creation.', code: 'DRAFT_VISIT_REQUIRED' },
        { status: 400 }
      );
    }

    // Validate Vehicle Number
    const vehValidation = validateRequiredString(validated.vehicleNumber, 'Vehicle Number', 50);
    if (!vehValidation.isValid) {
      return NextResponse.json({ error: vehValidation.error }, { status: 400 });
    }

    // Validate Operational Timestamp
    const firstPortionTs = validated.portions[0]?.dispatchTimestamp || validated.operationalDate || new Date().toISOString();
    const chronoVal = validateOperationalTimestamp(firstPortionTs, null, 'Dispatch', 'Baseline');
    if (!chronoVal.isValid) {
      return NextResponse.json({ error: chronoVal.error }, { status: 400 });
    }

    // SOURCE AUTHORIZATION & DERIVATION (acting scope, never the stored role):
    const rawSourceId: unknown = body && typeof body === 'object' ? (body as Record<string, unknown>).procurementSourceId : undefined;
    const requestedSourceId = typeof rawSourceId === 'string' ? rawSourceId : typeof rawSourceId === 'number' ? String(rawSourceId) : null;
    const sourceToLoad = dispatchSourceIdToLoad(guard.acting.scope, requestedSourceId);
    if (!sourceToLoad.ok) return dispatchSourceFailureResponse(sourceToLoad.code);

    const sourceRecord = await prisma.procurementSource.findUnique({
      where: { id: sourceToLoad.sourceId },
    });

    const actingResult = resolveDispatchActing(guard.user, requestedAs, sourceRecord?.source_type);
    if (!actingResult.ok) {
      return actingResult.code === 'FORBIDDEN'
        ? NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
        : scopeFailureResponse(actingResult.code);
    }
    const acting = actingResult.ctx;

    const sourceCheck = checkDispatchSource(acting, requestedSourceId, sourceRecord);
    if (!sourceCheck.ok) return dispatchSourceFailureResponse(sourceCheck.code);
    const resolvedSourceId: bigint = sourceCheck.sourceId;
    const sourceType = sourceCheck.sourceType;

    // Validate Raw Milk Dispatch Note against operational policy
    const rawDispatchNoteInput = validated.rawMilkDispatchNoteNumber || validated.raw_milk_dispatch_note_number || jsonString(body, 'rawMilkDispatchNoteNumber') || jsonString(body, 'raw_milk_dispatch_note_number');
    let validatedDispatchNote: string | null = null;
    try {
      validatedDispatchNote = await PaperReferenceService.validateAndVerify(
        PaperReferenceType.RAW_MILK_DISPATCH_NOTE,
        rawDispatchNoteInput,
        {
          excludeEntityId: validated.visitId ? BigInt(validated.visitId) : undefined,
          scopeEntityId: resolvedSourceId,
        }
      );
    } catch (err) {
      return NextResponse.json({ error: getErrorMessage(err) || 'Invalid Raw Milk Dispatch Note number.' }, { status: 400 });
    }

    // 1. Resolve visit assignments and check status
    const existingVisit = await prisma.vehicleVisit.findUnique({
      where: { id: BigInt(validated.visitId) },
    });
    if (!existingVisit) {
      return NextResponse.json({ error: 'Referenced dispatch draft visit not found.', code: 'DRAFT_NOT_FOUND' }, { status: 404 });
    }
    if (existingVisit.current_status !== 'DRAFT_DISPATCH' && existingVisit.current_status !== 'REOPENED') {
      return NextResponse.json(
        { error: `Cannot submit dispatch for vehicle in status ${existingVisit.current_status}.`, code: 'DRAFT_ALREADY_PROGRESSED' },
        { status: 400 }
      );
    }
    // Validate draft ownership
    if (existingVisit.created_by?.toString() !== userIdBigInt.toString()) {
      return NextResponse.json(
        { error: 'Unauthorized. Draft visit belongs to another user.', code: 'DRAFT_OWNER_MISMATCH' },
        { status: 403 }
      );
    }

    // Validate draft source match
    if (existingVisit.procurement_source_id?.toString() !== resolvedSourceId.toString()) {
      return NextResponse.json(
        { error: 'Draft visit belongs to a different procurement source.', code: 'DRAFT_SOURCE_MISMATCH' },
        { status: 400 }
      );
    }

    // Validate Seal Numbers: required per portion, unique within vehicle
    for (const portion of validated.portions) {
      if (!portion.seal_number || !portion.seal_number.trim()) {
        return NextResponse.json(
          { error: `Seal number is required for Portion ${portion.portionNumber}.`, code: 'SEAL_REQUIRED' },
          { status: 400 }
        );
      }
    }
    const submittedSeals = validated.portions.map((p) => p.seal_number!.trim().toUpperCase());
    const duplicateSeal = submittedSeals.find((s, idx) => submittedSeals.indexOf(s) !== idx);
    if (duplicateSeal) {
      return NextResponse.json(
        {
          error: `Seal number ${duplicateSeal} is duplicated within this vehicle.`,
          code: 'SEAL_DUPLICATE',
          sealNumber: duplicateSeal,
        },
        { status: 409 }
      );
    }

    // Calendar date derived in Pakistan local timezone (PKT) for month prefix
    const effectiveDispatchDate = chronoVal.date || new Date(firstPortionTs);
    const dispatchCalendarDateStr = getPakistanCalendarDate(effectiveDispatchDate);

    // 2. Load Dispatch Policy & Evaluate Decision Rule (Phase 4c Stage 3)
    const policyPoint = dispatchPointFor(sourceType);
    const dispatchPolicy = await loadDispatchPolicy(policyPoint, effectiveDispatchDate);

    const testMode: DispatchTestMode = validated.testMode || (validated.portions.length === 1 ? 'COMPOSITE' : 'PORTION_WISE');

    const portionInputs: DispatchPortionInput[] = validated.portions.map((portion) => {
      const tests: Array<{ labTestId: string; value?: number | null; textValue?: string | null }> = [];
      if (portion.test_results && portion.test_results.length > 0) {
        for (const tr of portion.test_results) {
          tests.push({ labTestId: tr.lab_test_id, value: tr.value, textValue: tr.text_value });
        }
      } else if (portion.results && portion.results.length > 0) {
        for (const r of portion.results) {
          tests.push({ labTestId: r.testId, value: r.numericValue, textValue: r.textValue });
        }
      }
      const photos: Array<{ labTestId: string; captureId: string }> = (portion.photos || []).map((ph) => ({
        labTestId: ph.lab_test_id,
        captureId: ph.capture_id,
      }));
      return {
        portionNumber: portion.portionNumber,
        sealNumber: portion.seal_number!.trim(),
        quantityValue: Number(portion.quantity.value),
        quantityUnit: portion.quantity.unit,
        tests,
        photos,
      };
    });

    const deciderCanApprove = canDecideDispatch(acting.actorRole, sourceType);

    const { decision, details, totals } = buildDispatchDecision(dispatchPolicy, {
      testMode,
      portions: portionInputs,
      labReportCaptureId: validated.labReportCaptureId || null,
      personDecision: validated.personDecision ?? 'ACCEPT',
      remarks: validated.decisionRemarks || null,
      deciderCanApprove,
    });

    // If action === 'SUBMIT' and there is any exception: return HTTP 409 EXCEPTION_NEEDS_REQUEST
    const hasExceptions =
      details.ruleFailures.length > 0 ||
      details.missingCompulsory.length > 0 ||
      details.missingPhotos.length > 0;

    if (validated.action === 'SUBMIT' && hasExceptions) {
      return NextResponse.json(
        {
          error: 'This cannot be submitted normally due to exceptions. Please send a request to the approver.',
          code: 'EXCEPTION_NEEDS_REQUEST',
          decision,
        },
        { status: 409 }
      );
    }

    // 3. Resolve visit assignments and FROZEN quantity policy snapshot from draft
    const assignedDispatchTests = await getOrAssignDispatchTests(prisma, existingVisit.id);
    const frozenPolicySnapshot = await getOrFreezeDispatchQuantityPolicy(prisma, existingVisit.id, resolvedSourceId);

    // Validate Vehicle and Portion Quantity Facts against FROZEN policy snapshot
    const validatedQuantities = validateDispatchQuantities(
      frozenPolicySnapshot,
      validated.vehicleQuantity,
      validated.portions
    );

    // 4. Resolve Authoritative Quality & Milk Metrics (Server Calculated)
    // The server-computed values (from the lab results found by stored LR / Fat role) come first; client-sent
    // vehicle LR / Fat are only a fallback when the server has no test values.
    const p1 = validated.portions.length === 1 ? details.portions[0] : undefined;
    const picked = pickVehicleLrFat({
      serverWeightedLr: totals.weightedLr,
      serverWeightedFat: totals.weightedFat,
      singlePortionLr: p1?.lr ?? null,
      singlePortionFat: p1?.fat ?? null,
      clientLr: [validated.vehicleLr, validated.vehicleQuantity?.lr],
      clientFat: [validated.vehicleFat, validated.vehicleQuantity?.fat],
    });
    const authoritativeVehicleLr: number | null = picked.lr;
    const authoritativeVehicleFat: number | null = picked.fat;

    const vehicleQtyVal = Number(validatedQuantities.vehicleQuantity.value);
    const vehicleQtyUnit = validatedQuantities.vehicleQuantity.unit;
    const vehicleQtyBasis = validatedQuantities.vehicleQuantity.basis;

    let vehicleDensity: number | null = totals.density;
    let vehicleGrossLiters: number | null = totals.grossLiters > 0 ? totals.grossLiters : null;
    let vehicleSnf: number | null = totals.snf;
    let vehicleTs: number | null = totals.weightedTs > 0 ? totals.weightedTs : null;
    let vehicleAt13tsLiters: number | null = totals.weightedTs13 > 0 ? totals.weightedTs13 : null;
    let vehicleCalculationVersion: string | null = totals.calculationVersion;

    if (vehicleGrossLiters === null) {
      if (vehicleQtyUnit === 'LITER') {
        vehicleGrossLiters = Number(vehicleQtyVal.toFixed(2));
        if (authoritativeVehicleLr !== null) {
          vehicleDensity = Number(calculateDensity(authoritativeVehicleLr).toFixed(4));
        }
      } else if (vehicleQtyUnit === 'KG') {
        if (authoritativeVehicleLr !== null) {
          vehicleDensity = Number(calculateDensity(authoritativeVehicleLr).toFixed(4));
          const rawGross = calculateGrossLiters(vehicleQtyVal, 'KG', authoritativeVehicleLr);
          if (rawGross !== null) {
            vehicleGrossLiters = Number(rawGross.toFixed(2));
          }
        }
      }
    }

    // Server-side canonical commercial metrics calculation
    if (authoritativeVehicleLr !== null && authoritativeVehicleFat !== null && vehicleGrossLiters !== null && vehicleGrossLiters > 0) {
      const canonicalMetrics = computeCanonicalMilkMetrics(
        vehicleGrossLiters,
        'LITER',
        authoritativeVehicleLr,
        authoritativeVehicleFat
      );
      vehicleDensity = canonicalMetrics.density;
      vehicleGrossLiters = canonicalMetrics.grossLiters;
      vehicleSnf = canonicalMetrics.snf;
      vehicleTs = canonicalMetrics.ts;
      // Weighted 13% TS (proportional to portion net weights). Never trust client-sent 13% TS totals.
      vehicleAt13tsLiters = totals.weightedTs13 > 0 ? totals.weightedTs13 : canonicalMetrics.at13tsLiters;
      vehicleCalculationVersion = canonicalMetrics.calculationVersion;
    }

    // For ZMCC source: BOTH authoritative LR and Fat are required fail-closed (HTTP 400)
    if (sourceType === 'ZMCC') {
      if (authoritativeVehicleLr === null || authoritativeVehicleFat === null) {
        return NextResponse.json(
          {
            error: 'Authoritative whole-vehicle/composite LR and Fat are required for ZMCC dispatch to establish physical Gross Liters and commercial @13TS.',
            code: 'MISSING_AUTHORITATIVE_VEHICLE_QUALITY',
          },
          { status: 400 }
        );
      }
      if (vehicleGrossLiters === null || isNaN(vehicleGrossLiters) || vehicleGrossLiters <= 0) {
        return NextResponse.json(
          {
            error: 'Failed to derive canonical Gross Liters for ZMCC tank issue from measured vehicle quantity.',
            code: 'INVALID_GROSS_LITERS',
          },
          { status: 400 }
        );
      }
      if (vehicleAt13tsLiters === null || isNaN(vehicleAt13tsLiters) || vehicleAt13tsLiters <= 0) {
        return NextResponse.json(
          {
            error: 'Failed to derive canonical @13TS Liters for ZMCC tank issue from measured vehicle quantity and quality.',
            code: 'INVALID_COMMERCIAL_AT_13TS',
          },
          { status: 400 }
        );
      }
    }

    const isSendRequest = validated.action === 'SEND_REQUEST';
    const approverRole = dispatchApproverRoleFor(sourceType);
    let nextStatus: string;
    let approvalStatus: string;

    if (isSendRequest) {
      nextStatus = DISPATCH_STATUS.PENDING_APPROVAL;
      approvalStatus = 'PENDING';
    } else {
      nextStatus = validated.personDecision === 'REJECT' ? DISPATCH_STATUS.REJECTED : DISPATCH_STATUS.DISPATCHED;
      approvalStatus = 'NONE';
    }

    // Determine testing mode
    let anyTested = false;
    let allTested = true;
    for (const p of portionInputs) {
      if (p.tests.length > 0) anyTested = true;
      else allTested = false;
    }
    let testingMode: 'FULL' | 'PARTIAL' | 'NOT_PERFORMED' = 'PARTIAL';
    if (sourceType === 'ZMCC') {
      testingMode = 'FULL';
    } else if (!anyTested) {
      testingMode = 'NOT_PERFORMED';
    } else if (allTested) {
      testingMode = 'FULL';
    }
    if (validated.dispatchTestingMode) {
      testingMode = validated.dispatchTestingMode;
    }
    let testingReason = validated.dispatchTestingReason ? validated.dispatchTestingReason.trim() : null;
    const testingRemarks = validated.dispatchTestingRemarks ? validated.dispatchTestingRemarks.trim() : null;
    if (testingMode === 'NOT_PERFORMED' && !testingReason) {
      testingReason = sourceType === 'CONTRACTOR' ? 'Contract Vehicle' : 'No dispatch testing provided';
    }

    let effectiveMotVehicleId: bigint | null = null;
    let effectiveMotProfileId: bigint | null = null;
    let effectiveDriverName: string | null = validated.driverName?.trim() || null;

    if (sourceType === 'ZMCC') {
      if (validated.motVehicleId) {
        effectiveMotVehicleId = BigInt(validated.motVehicleId);
      } else {
        const foundV = await prisma.motVehicle.findFirst({
          where: {
            zmcc_id: resolvedSourceId,
            vehicle_number: { equals: validated.vehicleNumber, mode: 'insensitive' },
          },
          select: { id: true },
        });
        if (foundV) effectiveMotVehicleId = foundV.id;
      }

      if (validated.motProfileId) {
        effectiveMotProfileId = BigInt(validated.motProfileId);
        const motP = await prisma.motProfile.findUnique({
          where: { id: effectiveMotProfileId },
          select: { name: true },
        });
        if (motP && !effectiveDriverName) {
          effectiveDriverName = motP.name;
        }
      }
    }

    // 5. Atomic Transaction: Persist Dispatch & Issue Tank if ZMCC
    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const receptionNumber = existingVisit.reception_number || (await generateReceptionNumber(tx, dispatchCalendarDateStr));

      // Clean up previous portions/results if resubmitting a REOPENED visit
      await tx.dispatchLabResult.deleteMany({ where: { visit_id: existingVisit.id } });
      const oldPortions = await tx.visitPortion.findMany({ where: { visit_id: existingVisit.id }, select: { id: true } });
      if (oldPortions.length > 0) {
        await tx.dispatchInfo.deleteMany({ where: { portion_id: { in: oldPortions.map((p) => p.id) } } });
        await tx.visitPortion.deleteMany({ where: { visit_id: existingVisit.id } });
      }

      const visitNumber = existingVisit.visit_number;
      const visit = await tx.vehicleVisit.update({
        where: { id: existingVisit.id },
        data: {
          vehicle_number: validated.vehicleNumber,
          reception_number: receptionNumber,
          raw_milk_dispatch_note_number: validatedDispatchNote,
          operational_date: null,
          current_status: nextStatus,
          procurement_source_id: resolvedSourceId,
          mot_vehicle_id: effectiveMotVehicleId,
          mot_profile_id: effectiveMotProfileId,
          driver_name: effectiveDriverName,
          vehicle_dispatch_quantity_value: new Prisma.Decimal(vehicleQtyVal.toFixed(2)),
          vehicle_dispatch_quantity_unit: vehicleQtyUnit,
          vehicle_dispatch_quantity_basis: vehicleQtyBasis,
          vehicle_dispatch_lr: authoritativeVehicleLr !== null ? new Prisma.Decimal(authoritativeVehicleLr.toFixed(2)) : null,
          vehicle_dispatch_fat: authoritativeVehicleFat !== null ? new Prisma.Decimal(authoritativeVehicleFat.toFixed(2)) : null,
          vehicle_dispatch_density: vehicleDensity !== null ? new Prisma.Decimal(vehicleDensity.toFixed(4)) : null,
          vehicle_dispatch_gross_liters: vehicleGrossLiters !== null ? new Prisma.Decimal(vehicleGrossLiters.toFixed(2)) : null,
          vehicle_dispatch_snf: vehicleSnf !== null ? new Prisma.Decimal(vehicleSnf.toFixed(2)) : null,
          vehicle_dispatch_ts: vehicleTs !== null ? new Prisma.Decimal(vehicleTs.toFixed(2)) : null,
          vehicle_dispatch_at_13ts_liters: vehicleAt13tsLiters !== null ? new Prisma.Decimal(vehicleAt13tsLiters.toFixed(2)) : null,
          vehicle_dispatch_calculation_version: vehicleCalculationVersion,

          // Phase 4c Stage 3 decision and approval fields
          test_mode: testMode,
          approval_status: approvalStatus,
          approver_role: isSendRequest ? approverRole : null,
          approval_requested_by: isSendRequest ? userIdBigInt : null,
          approval_requested_at: isSendRequest ? now : null,
          approval_requested_as_role: isSendRequest ? acting.actingAs : null,
          approval_requested_is_delegated: isSendRequest ? acting.isDelegated : false,
          approval_request_remarks: isSendRequest ? (validated.decisionRemarks || null) : null,
          dispatch_person_decision: validated.personDecision ?? 'ACCEPT',
          dispatch_decision_remarks: validated.decisionRemarks || null,
          dispatch_system_outcome: decision.systemOutcome,
          dispatch_exception_reasons: decision.exceptionReasons as unknown as Prisma.InputJsonValue,
          dispatch_decision_details: details as unknown as Prisma.InputJsonValue,
          dispatch_lab_report_capture_id: validated.labReportCaptureId || null,
          dispatch_policy_version: dispatchPolicy.version,
          dispatch_submitted_by: userIdBigInt,
          dispatch_submitted_as_role: acting.actingAs,
          dispatch_submitted_is_delegated: acting.isDelegated,
          dispatch_submitted_at: now,
        },
      });

      // Ensure assignments & policy snapshot are present
      await getOrAssignDispatchTests(tx, visit.id);
      await getOrFreezeDispatchQuantityPolicy(tx, visit.id, resolvedSourceId!);

      // ZMCC TANK ISSUE: atomically deduct if ZMCC and DISPATCHED
      let tankRemainingLiters: number | null = null;
      if (sourceType === 'ZMCC') {
        if (nextStatus === DISPATCH_STATUS.DISPATCHED) {
          tankRemainingLiters = await issueDispatchFromZmccTankTx(tx, {
            zmccId: resolvedSourceId,
            visitId: visit.id,
            visitNumber: visit.visit_number,
            vehicleNumber: visit.vehicle_number,
            grossLiters: vehicleGrossLiters!,
            at13tsLiters: vehicleAt13tsLiters!,
            at: effectiveDispatchDate,
            userId: userIdBigInt,
          });
        } else {
          tankRemainingLiters = await zmccTankRemainingLiters(resolvedSourceId, tx);
        }
      }

      // Notify approvers if SEND_REQUEST
      if (isSendRequest) {
        await notifyDispatchApproversTx(tx, {
          visitId: visit.id,
          version: visit.dispatch_version,
          sourceId: resolvedSourceId,
          approverRole,
          dispatchNumber: receptionNumber,
          vehicleNumber: visit.vehicle_number,
          sourceName: sourceRecord?.name || 'Procurement Source',
        });
      }

      // Stored system roles of the assigned tests (the frozen assignment snapshot does not carry them).
      const assignedRoles = await tx.labTest.findMany({
        where: { id: { in: assignedDispatchTests.map((t) => t.test_id) } },
        select: { id: true, systemRole: true },
      });
      const systemRoleByTestId = new Map(assignedRoles.map((r) => [r.id.toString(), r.systemRole]));

      // Create portions, dispatchInfo, and lab results
      const createdPortions = [];
      for (const portionInput of validated.portions) {
        const portionQty = validatedQuantities.portionQuantities.find(
          (p) => p.portionNumber === portionInput.portionNumber
        )!;

        const portion = await tx.visitPortion.create({
          data: {
            visit_id: visit.id,
            portion_number: portionInput.portionNumber,
            dispatch_quantity_value: new Prisma.Decimal(portionQty.value),
            dispatch_quantity_unit: portionQty.unit,
            dispatch_quantity_basis: portionQty.basis,
            seal_number: portionInput.seal_number ? portionInput.seal_number.trim() : null,
            current_status: nextStatus,
            plant_decision: 'PENDING',
          },
        });
        createdPortions.push(portion);

        const portionChrono = validateOperationalTimestamp(portionInput.dispatchTimestamp || validated.operationalDate, null, 'Dispatch', 'Baseline');
        await tx.dispatchInfo.create({
          data: {
            portion_id: portion.id,
            dispatch_number: `DISP-${visitNumber}-P${portionInput.portionNumber}`,
            dispatch_timestamp: portionChrono.date || (portionInput.dispatchTimestamp ? new Date(portionInput.dispatchTimestamp) : now),
            dispatch_testing_mode: testingMode,
            dispatch_testing_reason: testingReason,
            dispatch_testing_remarks: testingRemarks,
            recorded_by: userIdBigInt,
            ...asRoleFields(acting, 'recorded'),
          },
        });

        const submittedResultsMap = new Map<string, { numericValue?: number | null; textValue?: string | null; performanceStatus?: string; notPerformedReason?: string | null }>();
        if (portionInput.test_results && portionInput.test_results.length > 0) {
          for (const tr of portionInput.test_results) {
            const hasVal = tr.value !== null && tr.value !== undefined && !isNaN(tr.value);
            const hasText = tr.text_value !== null && tr.text_value !== undefined && tr.text_value.trim().length > 0;
            submittedResultsMap.set(tr.lab_test_id, {
              numericValue: hasVal ? tr.value : null,
              textValue: hasText ? tr.text_value : null,
              performanceStatus: (hasVal || hasText) ? 'PERFORMED' : 'NOT_PERFORMED',
            });
          }
        }
        if (portionInput.results && portionInput.results.length > 0) {
          for (const r of portionInput.results) {
            submittedResultsMap.set(r.testId, {
              numericValue: r.numericValue,
              textValue: r.textValue,
              performanceStatus: r.performanceStatus,
              notPerformedReason: r.notPerformedReason,
            });
          }
        }

        const pDetail = details.portions.find((p) => p.portionNumber === portionInput.portionNumber);
        const submittedFat = pDetail?.fat ?? null;
        const submittedLr = pDetail?.lr ?? null;

        for (const testDef of assignedDispatchTests) {
          const testIdStr = testDef.test_id.toString();
          const submittedRes = submittedResultsMap.get(testIdStr);

          let numVal: number | null = null;
          let textVal: string | null = null;
          let perfStatus = 'NOT_PERFORMED';
          let notPerfReason: string | null = null;

          // Each calculated test is stored with ITS OWN server-computed value (SNF, Total Solids or ratio) from the
          // portion's LR and Fat; a client-sent value is ignored. Found by stored system role, not by code or name.
          const calculated = storedCalculatedValue(
            {
              testCode: testDef.test_code_snapshot,
              testName: testDef.test_name_snapshot,
              resultType: testDef.result_type_snapshot,
              systemRole: systemRoleByTestId.get(testIdStr) ?? null,
            },
            submittedLr,
            submittedFat
          );
          if (calculated) {
            if (calculated.value !== null) {
              numVal = calculated.value;
              textVal = calculated.value.toFixed(2);
              perfStatus = 'PERFORMED';
              notPerfReason = null;
            } else {
              numVal = null;
              textVal = null;
              perfStatus = 'NOT_PERFORMED';
              notPerfReason = 'Prerequisite tests (Fat / LR) not performed';
            }
          } else {
            if (!submittedRes) {
              perfStatus = 'NOT_PERFORMED';
              notPerfReason = sourceType === 'CONTRACTOR' ? 'Contract Vehicle' : 'Not performed at dispatch';
            } else {
              perfStatus = submittedRes.performanceStatus || 'PERFORMED';
              notPerfReason = perfStatus === 'NOT_PERFORMED' ? (submittedRes.notPerformedReason?.trim() || 'Not performed') : null;
              numVal = perfStatus === 'PERFORMED' ? submittedRes.numericValue ?? null : null;
              textVal = perfStatus === 'PERFORMED' ? submittedRes.textValue ?? null : null;
            }
          }

          const testSnapshotOptions = (testDef.result_options_snapshot as LabTestResultOption[] | null) || null;
          const evalRes = perfStatus === 'PERFORMED'
            ? evaluateLabResult(testDef.test_code_snapshot, numVal, textVal, testDef.result_type_snapshot, testSnapshotOptions)
            : { isPassed: null };

          await tx.dispatchLabResult.create({
            data: {
              visit_id: visit.id,
              portion_id: portion.id,
              test_id: testDef.test_id,
              sample_timestamp: now,
              result_timestamp: now,
              numeric_value: numVal,
              text_value: textVal,
              performance_status: perfStatus,
              not_performed_reason: notPerfReason,
              is_passed: evalRes.isPassed,
              tested_by: userIdBigInt,
            },
          });
        }
      }

      await writeAuditLog(tx, {
        tableName: 'vehicle_visit',
        recordId: visit.id,
        action: isSendRequest ? 'DISPATCH_REQUEST_SENT' : 'DISPATCH_SUBMITTED',
        oldValues: { current_status: existingVisit.current_status },
        newValues: {
          current_status: nextStatus,
          action: validated.action,
          person_decision: validated.personDecision,
          system_outcome: decision.systemOutcome,
          gross_liters: vehicleGrossLiters,
          at13ts_liters: vehicleAt13tsLiters,
        },
        actor: auditActorOf(acting),
      });

      return { visit, createdPortions, tankRemainingLiters };
    });

    return NextResponse.json(
      {
        success: true,
        visitId: result.visit.id.toString(),
        visitNumber: result.visit.visit_number,
        dispatch: {
          id: result.visit.id.toString(),
          visitId: result.visit.id.toString(),
          visitNumber: result.visit.visit_number,
          visit_number: result.visit.visit_number,
          receptionNumber: result.visit.reception_number,
          reception_number: result.visit.reception_number,
          vehicleNumber: result.visit.vehicle_number,
          vehicle_number: result.visit.vehicle_number,
          status: result.visit.current_status,
          current_status: result.visit.current_status,
          portions: result.createdPortions.map((p) => ({
            id: p.id.toString(),
            portionNumber: p.portion_number,
            portion_number: p.portion_number,
            sealNumber: p.seal_number,
            seal_number: p.seal_number,
          })),
        },
        decision,
        totals: {
          grossLiters: totals.grossLiters,
          weightedLr: totals.weightedLr,
          weightedFat: totals.weightedFat,
          weightedTs13: totals.weightedTs13,
        },
        tankRemainingLiters: result.tankRemainingLiters,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof DispatchFlowError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof PaperValidationError || getErrorName(error) === 'PaperValidationError') {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
    }
    if (error instanceof QuantityMeasurementError || getErrorName(error) === 'QuantityMeasurementError' || getErrorCode(error)?.startsWith('QUANTITY_') || getErrorCode(error)?.startsWith('MISSING_') || getErrorCode(error) === 'ZERO_PORTIONS_PROHIBITED') {
      return NextResponse.json({ error: getErrorMessage(error), code: getErrorCode(error) || 'QUANTITY_ERROR' }, { status: 400 });
    }
    if (
      getErrorMessage(error).startsWith('INSUFFICIENT_TANK_STOCK') ||
      getErrorMessage(error).startsWith('ZMCC_TANK_CONFIGURATION_ERROR') ||
      getErrorMessage(error).startsWith('MISSING_AUTHORITATIVE_VEHICLE_LR') ||
      getErrorMessage(error).startsWith('INVALID_GROSS_LITERS') ||
      getErrorMessage(error).startsWith('ZMCC_TANK_INACTIVE') ||
      getErrorMessage(error).startsWith('ZMCC_TANK_NOT_FOUND') ||
      getErrorMessage(error).startsWith('INVALID_DISPATCH_QUANTITY')
    ) {
      const code = getErrorMessage(error).split(':')[0].trim();
      return NextResponse.json({ error: getErrorMessage(error), code }, { status: 400 });
    }
    if (getErrorName(error) === 'ZodError' || Array.isArray(getErrorIssues(error))) {
      const firstMsg = getErrorIssues(error)?.[0]?.message || 'Validation failed';
      return NextResponse.json({ error: firstMsg }, { status: 400 });
    }
    return NextResponse.json({ error: getErrorMessage(error) || 'Failed to create vehicle dispatch' }, { status: 500 });
  }
}
