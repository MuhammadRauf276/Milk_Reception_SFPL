import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { createDispatchSchema } from '@/lib/validations/dispatch';
import { evaluateLabResult } from '@/lib/lab-rules';
import { generateReceptionNumber } from '@/lib/reception-number';
import { validateRequiredString } from '@/lib/validation-helpers';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';
import { calculateSNF, calculateRatio, calculateDensity, calculateGrossLiters } from '@/backend/utils/milkFormulas';
import { getOrAssignDispatchTests } from '@/backend/services/labTestAssignmentService';
import { getOrFreezeDispatchQuantityPolicy } from '@/backend/modules/dispatch/quantity-policy/quantityPolicyService';
import { validateDispatchQuantities, QuantityMeasurementError } from '@/backend/modules/dispatch/quantity/dispatchQuantityService';
import { getPakistanCalendarDate } from '@/backend/core/business-day';
import { getTankPhysicalStock } from '@/backend/services/zmccTankService';

function serializeDispatch(visit: any) {
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
    dispatch_timestamp: dispatchTimestamp,
    dispatch_date: dispatchDate,
    operational_date: visit.operational_date ? visit.operational_date.toISOString().split('T')[0] : null,
    current_status: visit.current_status,
    portion_count: portions.length,
    vehicle_dispatch_quantity_value: vehicleQuantityValue,
    vehicle_dispatch_quantity_unit: vehicleQuantityUnit,
    vehicle_dispatch_quantity_basis: vehicleQuantityBasis,
    vehicle_dispatch_lr: vehicleDispatchLr,
    vehicle_dispatch_density: vehicleDispatchDensity,
    vehicle_dispatch_gross_liters: vehicleDispatchGrossLiters,
    procurement_source_id: visit.procurement_source_id ? visit.procurement_source_id.toString() : null,
    zonal_contractor_name: visit.procurement_source?.name || 'Source unavailable',
    procurement_source_type: visit.procurement_source?.source_type || 'UNKNOWN',
    zonal_contractor_dispatch_time: firstDispatchInfo?.dispatch_timestamp
      ? new Date(firstDispatchInfo.dispatch_timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : null,
    dispatch_testing_mode: firstDispatchInfo?.dispatch_testing_mode || 'FULL',
    dispatch_testing_reason: firstDispatchInfo?.dispatch_testing_reason || null,
    has_gate_entry: !!gateLog?.entry_timestamp,
    portions: portions.map((p: any) => ({
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
  const authUser = await getCurrentUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ username: authUser.username }, { id: BigInt(authUser.id) }],
      is_active: true,
    },
    include: { procurement_source: true },
  });

  if (!dbUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  const whereClause: any = {
    current_status: statusFilter ? statusFilter : { notIn: ['CANCELLED', 'DRAFT_DISPATCH'] },
  };

  // SOURCE AUTHORIZATION FILTERING:
  // For ordinary MPD operators and source-scoped managers (ZMCC_MANAGER, CONTRACTOR_MANAGER),
  // strictly scope dispatches to their assigned procurement source at DB level (fail-closed if unbound).
  const isSourceScoped =
    dbUser.role === 'ZMCC_LAB_ATTENDANT' ||
    dbUser.role === 'CONTRACTOR_OPERATOR' ||
    dbUser.role === 'ZMCC_MANAGER' ||
    dbUser.role === 'CONTRACTOR_MANAGER';

  if (isSourceScoped) {
    if (dbUser.procurement_source_id) {
      whereClause.procurement_source_id = dbUser.procurement_source_id;
    } else {
      // Unbound source-scoped role gets zero dispatches (fail closed)
      whereClause.procurement_source_id = -1;
    }
  } else {
    // Privileged/Global roles may specify optional procurementSourceId query param
    const sourceParam = searchParams.get('procurementSourceId');
    if (sourceParam) {
      whereClause.procurement_source_id = BigInt(sourceParam);
    }
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

    if (isSourceScoped) {
      if (dbUser.procurement_source_id) {
        conditions.push(Prisma.sql`vv.procurement_source_id = ${dbUser.procurement_source_id}`);
      } else {
        conditions.push(Prisma.sql`vv.procurement_source_id = -1`);
      }
    } else {
      const sourceParam = searchParams.get('procurementSourceId');
      if (sourceParam) {
        conditions.push(Prisma.sql`vv.procurement_source_id = ${BigInt(sourceParam)}`);
      }
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

    let visits: any[] = [];
    if (idRows.length > 0) {
      const visitIds = idRows.map((r) => r.id);
      const fetchedVisits = await prisma.vehicleVisit.findMany({
        where: { id: { in: visitIds } },
        include: {
          creator: true,
          procurement_source: true,
          portions: {
            include: {
              dispatch_info: true,
            },
            orderBy: { portion_number: 'asc' },
          },
          gate_log: true,
        },
      });

      const visitMap = new Map(fetchedVisits.map((v) => [v.id.toString(), v]));
      visits = visitIds.map((id) => visitMap.get(id.toString())).filter(Boolean);
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
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch dispatches' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // 1. Read authenticated user from session
  const authUser = await getCurrentUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
  }

  // 2. Find corresponding User row in PostgreSQL database
  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ username: authUser.username }, { id: BigInt(authUser.id) }],
      is_active: true,
    },
    include: { procurement_source: true },
  });

  const allowedRoles = ['ZMCC_LAB_ATTENDANT', 'CONTRACTOR_OPERATOR', 'SUPER_ADMIN'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json(
      { error: 'Unauthorized. Authorized active ZMCC Lab Attendant or Contractor Operator required.' },
      { status: 403 }
    );
  }

  if (dbUser.role === 'ZMCC_LAB_ATTENDANT') {
    if (!dbUser.procurement_source_id || dbUser.procurement_source?.source_type !== 'ZMCC') {
      return NextResponse.json({ error: 'Unauthorized. ZMCC Lab Attendant must be bound to a ZMCC source.' }, { status: 403 });
    }
  } else if (dbUser.role === 'CONTRACTOR_OPERATOR') {
    if (!dbUser.procurement_source_id || dbUser.procurement_source?.source_type !== 'CONTRACTOR') {
      return NextResponse.json({ error: 'Unauthorized. Contractor Operator must be bound to a Contractor source.' }, { status: 403 });
    }
  }

  const userIdBigInt = dbUser.id;

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
    const firstPortionTs = validated.portions[0]?.dispatchTimestamp || new Date().toISOString();
    const chronoVal = validateOperationalTimestamp(firstPortionTs, null, 'Dispatch', 'Baseline');
    if (!chronoVal.isValid) {
      return NextResponse.json({ error: chronoVal.error }, { status: 400 });
    }

    // SOURCE AUTHORIZATION & DERIVATION:
    let resolvedSourceId: bigint | null = null;
    const isSourceBound = !!dbUser.procurement_source_id;

    if (isSourceBound) {
      if (dbUser.procurement_source && !dbUser.procurement_source.is_active) {
        return NextResponse.json(
          { error: 'Bound procurement source is inactive or unavailable.', code: 'PROCUREMENT_SOURCE_INACTIVE' },
          { status: 400 }
        );
      }
      resolvedSourceId = dbUser.procurement_source_id!;
      if (body.procurementSourceId && body.procurementSourceId !== dbUser.procurement_source_id!.toString()) {
        return NextResponse.json(
          { error: 'Unauthorized. Source-bound user cannot create visits for another procurement source.', code: 'FORBIDDEN_SOURCE' },
          { status: 403 }
        );
      }
    } else if (body.procurementSourceId) {
      const targetSrc = await prisma.procurementSource.findUnique({
        where: { id: BigInt(body.procurementSourceId) },
      });
      if (!targetSrc || !targetSrc.is_active) {
        return NextResponse.json(
          { error: 'Selected procurement source is inactive or does not exist.', code: 'PROCUREMENT_SOURCE_INVALID' },
          { status: 400 }
        );
      }
      resolvedSourceId = targetSrc.id;
    } else {
      return NextResponse.json(
        { error: 'Procurement source is required for dispatch creation.', code: 'PROCUREMENT_SOURCE_REQUIRED' },
        { status: 400 }
      );
    }

    const sourceRecord = await prisma.procurementSource.findUnique({
      where: { id: resolvedSourceId, is_active: true },
    });

    if (!sourceRecord) {
      return NextResponse.json(
        { error: 'Invalid or inactive procurement source.', code: 'PROCUREMENT_SOURCE_INVALID' },
        { status: 400 }
      );
    }

    const sourceType = sourceRecord.source_type || 'ZMCC';

    if (dbUser.role === 'ZMCC_LAB_ATTENDANT' && sourceType !== 'ZMCC') {
      return NextResponse.json({ error: 'Unauthorized. ZMCC Lab Attendant cannot dispatch for Contractor source.' }, { status: 403 });
    }
    if (dbUser.role === 'CONTRACTOR_OPERATOR' && sourceType !== 'CONTRACTOR') {
      return NextResponse.json({ error: 'Unauthorized. Contractor Operator cannot dispatch for ZMCC source.' }, { status: 403 });
    }

    // 1. Resolve visit assignments and FROZEN quantity policy snapshot from draft
    const existingVisit = await prisma.vehicleVisit.findUnique({
      where: { id: BigInt(validated.visitId) },
    });
    if (!existingVisit) {
      return NextResponse.json({ error: 'Referenced dispatch draft visit not found.', code: 'DRAFT_NOT_FOUND' }, { status: 404 });
    }
    if (existingVisit.current_status !== 'DRAFT_DISPATCH') {
      return NextResponse.json(
        { error: `Cannot submit dispatch for vehicle in status ${existingVisit.current_status}.`, code: 'DRAFT_ALREADY_PROGRESSED' },
        { status: 400 }
      );
    }
    // Validate draft ownership
    if (existingVisit.created_by?.toString() !== dbUser.id.toString()) {
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
    const assignedDispatchTests = await getOrAssignDispatchTests(prisma, existingVisit.id);
    const frozenPolicySnapshot = await getOrFreezeDispatchQuantityPolicy(prisma, existingVisit.id, resolvedSourceId);

    // 2. Validate Vehicle and Portion Quantity Facts against the visit's FROZEN policy snapshot
    const validatedQuantities = validateDispatchQuantities(
      frozenPolicySnapshot,
      validated.vehicleQuantity,
      validated.portions
    );

    const manualAssignedTests = assignedDispatchTests.filter((t) => t.result_type_snapshot !== 'CALCULATED');

    // Validate Portion Tests strictly against the visit's assigned snapshot
    for (const portion of validated.portions) {
      const submittedTestMap = new Map(portion.results.map((r) => [r.testId, r]));

      for (const reqTest of manualAssignedTests) {
        const reqId = reqTest.test_id.toString();
        const submitted = submittedTestMap.get(reqId);

        if (!submitted) {
          return NextResponse.json(
            { error: `Test "${reqTest.test_name_snapshot}" must be accounted for in Portion ${portion.portionNumber}.` },
            { status: 400 }
          );
        }

        if (submitted.performanceStatus === 'NOT_PERFORMED') {
          // Reason is mandatory for NOT_PERFORMED
          if (!submitted.notPerformedReason || !submitted.notPerformedReason.trim()) {
            return NextResponse.json(
              { error: `Reason required for unperformed test "${reqTest.test_name_snapshot}" in Portion ${portion.portionNumber}.` },
              { status: 400 }
            );
          }

          // Contradiction Check: NOT_PERFORMED must not have active numeric result
          if (submitted.numericValue !== null && submitted.numericValue !== undefined) {
            return NextResponse.json(
              { error: `Contradictory test result: NOT_PERFORMED test "${reqTest.test_name_snapshot}" cannot have a numeric value.` },
              { status: 400 }
            );
          }

          // Contradiction Check: NOT_PERFORMED must not have active text result
          if (submitted.textValue !== null && submitted.textValue !== undefined && submitted.textValue !== '') {
            return NextResponse.json(
              { error: `Contradictory test result: NOT_PERFORMED test "${reqTest.test_name_snapshot}" cannot have a text value.` },
              { status: 400 }
            );
          }
        } else if (submitted.performanceStatus === 'PERFORMED') {
          // Contradiction Check: PERFORMED must not have notPerformedReason
          if (submitted.notPerformedReason && submitted.notPerformedReason.trim() !== '') {
            return NextResponse.json(
              { error: `Contradictory test result: PERFORMED test "${reqTest.test_name_snapshot}" cannot have a not_performed_reason.` },
              { status: 400 }
            );
          }

          // Genuine Result Validation
          const snapshotOptions = (reqTest.result_options_snapshot as any[]) || null;
          if (Array.isArray(snapshotOptions) && snapshotOptions.length > 0) {
            const val = (submitted.textValue || '').trim().toUpperCase();
            const match = snapshotOptions.find((opt: any) => opt.value.trim().toUpperCase() === val);
            if (!match) {
              return NextResponse.json(
                { error: `Invalid option "${submitted.textValue}" for "${reqTest.test_name_snapshot}" in Portion ${portion.portionNumber}. Allowed options: ${snapshotOptions.map((o: any) => o.label || o.value).join(', ')}.` },
                { status: 400 }
              );
            }
          } else if (reqTest.result_type_snapshot === 'NUMERIC') {
            if (submitted.numericValue === null || submitted.numericValue === undefined || isNaN(submitted.numericValue) || submitted.numericValue < 0) {
              return NextResponse.json(
                { error: `Valid numeric result required for PERFORMED test "${reqTest.test_name_snapshot}" in Portion ${portion.portionNumber}.` },
                { status: 400 }
              );
            }
          } else if (reqTest.result_type_snapshot === 'OK_NOT_OK') {
            const val = (submitted.textValue || '').trim().toUpperCase();
            if (!val || !['OK', 'NOT_OK'].includes(val)) {
              return NextResponse.json(
                { error: `Option must be OK or NOT_OK for "${reqTest.test_name_snapshot}" in Portion ${portion.portionNumber}.` },
                { status: 400 }
              );
            }
          } else if (reqTest.result_type_snapshot === 'POSITIVE_NEGATIVE') {
            const val = (submitted.textValue || '').trim().toUpperCase();
            if (!val || !['POSITIVE', 'NEGATIVE'].includes(val)) {
              return NextResponse.json(
                { error: `Option must be POSITIVE or NEGATIVE for "${reqTest.test_name_snapshot}" in Portion ${portion.portionNumber}.` },
                { status: 400 }
              );
            }
          } else {
            if (!submitted.textValue || !submitted.textValue.trim()) {
              return NextResponse.json(
                { error: `Valid result text required for PERFORMED test "${reqTest.test_name_snapshot}" in Portion ${portion.portionNumber}.` },
                { status: 400 }
              );
            }
          }
        }
      }
    }

    // Determine testing mode
    let allPerformed = true;
    let allNotPerformed = true;
    for (const portion of validated.portions) {
      for (const res of portion.results) {
        if (res.performanceStatus === 'PERFORMED') {
          allNotPerformed = false;
        } else {
          allPerformed = false;
        }
      }
    }

    let testingMode: 'FULL' | 'PARTIAL' | 'NOT_PERFORMED' = 'PARTIAL';
    if (sourceType === 'ZMCC') {
      testingMode = 'FULL';
    } else if (allNotPerformed) {
      testingMode = 'NOT_PERFORMED';
    } else if (allPerformed) {
      testingMode = 'FULL';
    }

    let testingReason = validated.dispatchTestingReason ? validated.dispatchTestingReason.trim() : null;
    const testingRemarks = validated.dispatchTestingRemarks ? validated.dispatchTestingRemarks.trim() : null;

    if (testingMode === 'NOT_PERFORMED' && !testingReason) {
      testingReason = sourceType === 'CONTRACTOR' ? 'Contract Vehicle' : 'No dispatch testing provided';
    }

    // Calendar date derived in Pakistan local timezone (PKT) for month prefix
    const effectiveDispatchDate = chronoVal.date || new Date(firstPortionTs);
    const dispatchCalendarDateStr = getPakistanCalendarDate(effectiveDispatchDate);

    // Resolve authoritative vehicle LR:
    // 1. Explicit vehicleLr in payload
    // 2. Explicit lr in vehicleQuantity
    // 3. If portions.length === 1, from single portion's performed Lactometer/LR test
    let authoritativeVehicleLr: number | null = null;
    if (validated.vehicleLr !== undefined && validated.vehicleLr !== null && !isNaN(validated.vehicleLr) && validated.vehicleLr > 0) {
      authoritativeVehicleLr = Number(validated.vehicleLr);
    } else if (validated.vehicleQuantity.lr !== undefined && validated.vehicleQuantity.lr !== null && !isNaN(validated.vehicleQuantity.lr) && validated.vehicleQuantity.lr > 0) {
      authoritativeVehicleLr = Number(validated.vehicleQuantity.lr);
    } else if (validated.portions.length === 1) {
      const p1Results = validated.portions[0].results || [];
      for (const r of p1Results) {
        const assigned = assignedDispatchTests.find((t) => t.test_id.toString() === r.testId);
        if (assigned) {
          const tName = assigned.test_name_snapshot.toLowerCase();
          if ((tName.includes('lactometer') || tName.includes('lr')) && r.performanceStatus === 'PERFORMED' && r.numericValue !== null && r.numericValue !== undefined && !isNaN(r.numericValue) && r.numericValue > 0) {
            authoritativeVehicleLr = Number(r.numericValue);
            break;
          }
        }
      }
    }

    const vehicleQtyVal = Number(validatedQuantities.vehicleQuantity.value);
    const vehicleQtyUnit = validatedQuantities.vehicleQuantity.unit;

    let vehicleDensity: number | null = null;
    let vehicleGrossLiters: number | null = null;

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

    // For ZMCC source: physical tank ISSUE requires authoritative Gross Liters
    if (sourceType === 'ZMCC') {
      if (vehicleQtyUnit === 'KG' && authoritativeVehicleLr === null) {
        return NextResponse.json(
          {
            error: 'Authoritative vehicle/composite LR is required for ZMCC dispatch in KG to derive Gross Liters.',
            code: 'MISSING_AUTHORITATIVE_VEHICLE_LR',
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
    }

    // Execute Prisma Transaction for atomic creation or draft finalization
    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const receptionNumber = await generateReceptionNumber(tx, dispatchCalendarDateStr);

      const visitNumber = existingVisit.visit_number;
      const visit = await tx.vehicleVisit.update({
        where: { id: existingVisit.id },
        data: {
          vehicle_number: validated.vehicleNumber,
          reception_number: receptionNumber,
          operational_date: null,
          current_status: 'DISPATCHED',
          procurement_source_id: resolvedSourceId,
          vehicle_dispatch_quantity_value: new Prisma.Decimal(validatedQuantities.vehicleQuantity.value),
          vehicle_dispatch_quantity_unit: validatedQuantities.vehicleQuantity.unit,
          vehicle_dispatch_quantity_basis: validatedQuantities.vehicleQuantity.basis,
          vehicle_dispatch_lr: authoritativeVehicleLr !== null ? new Prisma.Decimal(authoritativeVehicleLr.toFixed(2)) : null,
          vehicle_dispatch_density: vehicleDensity !== null ? new Prisma.Decimal(vehicleDensity.toFixed(4)) : null,
          vehicle_dispatch_gross_liters: vehicleGrossLiters !== null ? new Prisma.Decimal(vehicleGrossLiters.toFixed(2)) : null,
        },
      });

      // Ensure assignments & policy snapshot are present
      await getOrAssignDispatchTests(tx, visit.id);
      await getOrFreezeDispatchQuantityPolicy(tx, visit.id, resolvedSourceId!);

      // ZMCC TANK ISSUE:
      // If dispatching from a ZMCC source, atomically deduct whole-vehicle measured quantity (Gross Liters)
      // from the active ZMCC tank using ZmccTankInventoryTransaction (transaction_type = 'ISSUE').
      if (sourceType === 'ZMCC') {
        const issueLiters = vehicleGrossLiters!;
        if (isNaN(issueLiters) || issueLiters <= 0) {
          throw new Error('INVALID_DISPATCH_QUANTITY: Authoritative Gross Liters must be greater than zero for ZMCC tank issue.');
        }

        const activeTanks = await tx.zmccTank.findMany({
          where: { zmcc_id: resolvedSourceId!, is_active: true },
          orderBy: { id: 'asc' },
        });

        if (activeTanks.length === 0) {
          throw new Error('ZMCC_TANK_CONFIGURATION_ERROR: No active ZMCC tank configured for this procurement source.');
        }
        if (activeTanks.length > 1) {
          throw new Error('ZMCC_TANK_CONFIGURATION_ERROR: Multiple active tanks exist for this ZMCC. Exactly one active tank is permitted.');
        }

        const targetTankId = activeTanks[0].id;

        // Row lock FOR UPDATE and revalidate active state under lock
        const lockedTankRows: Array<{ id: bigint; zmcc_id: bigint; capacity_liters: any; is_active: boolean }> = await tx.$queryRaw`
          SELECT id, zmcc_id, capacity_liters, is_active FROM zmcc_tank WHERE id = ${targetTankId} FOR UPDATE
        `;
        if (!lockedTankRows || lockedTankRows.length === 0) {
          throw new Error('ZMCC_TANK_NOT_FOUND: Active ZMCC tank could not be found.');
        }
        if (!lockedTankRows[0].is_active) {
          throw new Error('ZMCC_TANK_INACTIVE: Active ZMCC tank is inactive or unavailable.');
        }

        // Check physical stock from immutable ledger
        const currentStock = await getTankPhysicalStock(targetTankId, tx);
        if (issueLiters > currentStock) {
          const availStr = currentStock.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const reqStr = issueLiters.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          throw new Error(`INSUFFICIENT_TANK_STOCK: Insufficient physical tank stock (${availStr} L available, ${reqStr} L required).`);
        }

        // Idempotent ledger entry
        const idempotencyKey = `ZMCC_TANK_ISSUE:DISPATCH:${visit.id}`;
        const existingIssue = await tx.zmccTankInventoryTransaction.findUnique({
          where: { idempotency_key: idempotencyKey },
        });

        if (!existingIssue) {
          await tx.zmccTankInventoryTransaction.create({
            data: {
              tank_id: targetTankId,
              zmcc_id: resolvedSourceId!,
              transaction_type: 'ISSUE',
              quantity_liters: new Prisma.Decimal(issueLiters.toFixed(2)),
              dispatch_id: visit.id,
              reference_type: 'DISPATCH',
              reference_id: visit.id.toString(),
              idempotency_key: idempotencyKey,
              operational_timestamp: effectiveDispatchDate,
              performed_by_user_id: userIdBigInt,
              notes: `Whole-vehicle dispatch issue for visit ${visitNumber} (${validated.vehicleNumber})`,
            },
          });
        }
      }

      // 2. Create VisitPortion, DispatchInfo, and DispatchLabResult rows for each portion
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
            current_status: 'DISPATCHED',
            plant_decision: 'PENDING',
          },
        });

        // Create DispatchInfo with testing mode & reasons (portion-level)
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
          },
        });

        // Extract raw Fat and LR values submitted for this portion
        const submittedResultsMap = new Map<string, typeof portionInput.results[0]>();
        portionInput.results.forEach((r) => {
          submittedResultsMap.set(r.testId, r);
        });

        let submittedFat: number | null = null;
        let submittedLr: number | null = null;

        assignedDispatchTests.forEach((t) => {
          const idStr = t.test_id.toString();
          const tName = t.test_name_snapshot.toLowerCase();
          const res = submittedResultsMap.get(idStr);
          if (res && res.numericValue !== null && res.numericValue !== undefined && !isNaN(res.numericValue) && res.performanceStatus === 'PERFORMED') {
            if (tName.includes('fat') && !tName.includes('ratio') && !tName.includes('snf')) {
              submittedFat = res.numericValue;
            } else if (tName.includes('lactometer') || tName.includes('lr')) {
              submittedLr = res.numericValue;
            }
          }
        });

        // Create DispatchLabResult for every assigned test (manual + server-calculated)
        for (const testDef of assignedDispatchTests) {
          const testIdStr = testDef.test_id.toString();
          const submittedRes = submittedResultsMap.get(testIdStr);

          let numVal: number | null = null;
          let textVal: string | null = null;
          let perfStatus = 'NOT_PERFORMED';
          let notPerfReason: string | null = null;

          if (testDef.result_type_snapshot === 'CALCULATED') {
            // Server-side authoritative derivation for CALCULATED tests
            if (submittedFat !== null && submittedLr !== null) {
              const snf = calculateSNF(submittedLr, submittedFat);
              const ratio = calculateRatio(snf, submittedFat);
              numVal = ratio;
              textVal = ratio.toFixed(3);
              perfStatus = 'PERFORMED';
              notPerfReason = null;
            } else {
              numVal = null;
              textVal = null;
              perfStatus = 'NOT_PERFORMED';
              notPerfReason = 'Prerequisite tests (Fat / LR) not performed';
            }
          } else {
            if (!submittedRes) continue;
            perfStatus = submittedRes.performanceStatus || 'PERFORMED';
            notPerfReason = perfStatus === 'NOT_PERFORMED' ? (submittedRes.notPerformedReason?.trim() || 'Contract Vehicle') : null;
            numVal = perfStatus === 'PERFORMED' ? submittedRes.numericValue ?? null : null;
            textVal = perfStatus === 'PERFORMED' ? submittedRes.textValue ?? null : null;
          }

          const testSnapshotOptions = (testDef.result_options_snapshot as any[]) || null;
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

      return visit;
    });

    return NextResponse.json({ success: true, visitId: result.id.toString(), visitNumber: result.visit_number }, { status: 201 });
  } catch (error: any) {
    if (error instanceof QuantityMeasurementError || error?.name === 'QuantityMeasurementError' || error?.code?.startsWith('QUANTITY_') || error?.code?.startsWith('MISSING_') || error?.code === 'ZERO_PORTIONS_PROHIBITED') {
      return NextResponse.json({ error: error.message, code: error.code || 'QUANTITY_ERROR' }, { status: 400 });
    }
    if (
      error?.message?.startsWith('INSUFFICIENT_TANK_STOCK') ||
      error?.message?.startsWith('ZMCC_TANK_CONFIGURATION_ERROR') ||
      error?.message?.startsWith('MISSING_AUTHORITATIVE_VEHICLE_LR') ||
      error?.message?.startsWith('INVALID_GROSS_LITERS') ||
      error?.message?.startsWith('ZMCC_TANK_INACTIVE') ||
      error?.message?.startsWith('ZMCC_TANK_NOT_FOUND') ||
      error?.message?.startsWith('INVALID_DISPATCH_QUANTITY')
    ) {
      const code = error.message.split(':')[0].trim();
      return NextResponse.json({ error: error.message, code }, { status: 400 });
    }
    if (error?.name === 'ZodError' || Array.isArray(error?.issues)) {
      const firstMsg = error.issues?.[0]?.message || error.errors?.[0]?.message || 'Validation failed';
      return NextResponse.json({ error: firstMsg }, { status: 400 });
    }
    return NextResponse.json({ error: error?.message || 'Failed to create vehicle dispatch' }, { status: 500 });
  }
}
