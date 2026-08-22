import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { Prisma } from '@prisma/client';
import { createDispatchSchema } from '@/lib/validations/dispatch';
import { evaluateLabResult } from '@/lib/lab-rules';
import { generateReceptionNumber } from '@/lib/reception-number';
import { validateRequiredString } from '@/lib/validation-helpers';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';
import { calculateSNF, calculateRatio } from '@/backend/utils/milkFormulas';
import { getOrAssignDispatchTests } from '@/backend/services/labTestAssignmentService';
import { getOrFreezeDispatchQuantityPolicy, resolveSourceQuantityPolicy } from '@/backend/modules/dispatch/quantity-policy/quantityPolicyService';
import { validateDispatchQuantities, QuantityMeasurementError } from '@/backend/modules/dispatch/quantity/dispatchQuantityService';
import { getOperationalBusinessDate } from '@/backend/core/business-day';

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
  const vehicleMeasurementMethod = visit.vehicle_dispatch_measurement_method || null;

  return {
    id: visit.id.toString(),
    visit_number: visit.visit_number,
    reception_number: visit.reception_number || null,
    vehicle_number: visit.vehicle_number,
    token_number: visit.token_number || null,
    operational_date: visit.operational_date ? visit.operational_date.toISOString().split('T')[0] : null,
    current_status: visit.current_status,
    portion_count: portions.length,
    vehicle_dispatch_quantity_value: vehicleQuantityValue,
    vehicle_dispatch_quantity_unit: vehicleQuantityUnit,
    vehicle_dispatch_quantity_basis: vehicleQuantityBasis,
    vehicle_dispatch_measurement_method: vehicleMeasurementMethod,
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
      dispatch_measurement_method: p.dispatch_measurement_method || null,
      plant_decision: p.plant_decision || 'PENDING',
      current_status: p.current_status,
    })),
  };
}


export async function GET(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [{ username: authUser.username }, { id: BigInt(authUser.id) }],
      is_active: true,
    },
    include: { procurement_source: true },
  });

  if (!dbUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Filter Dispatches by Date or Procurement Source
  const startDateStr = searchParams.get('startDate');
  const endDateStr = searchParams.get('endDate');

  let gteDate: Date | undefined;
  let lteDate: Date | undefined;

  if (startDateStr) {
    const sDate = new Date(startDateStr);
    sDate.setUTCHours(0, 0, 0, 0);
    gteDate = sDate;
  }
  if (endDateStr) {
    const eDate = new Date(endDateStr);
    eDate.setUTCHours(23, 59, 59, 999);
    lteDate = eDate;
  }

  const whereClause: any = {};
  if (dbUser.procurement_source_id) {
    whereClause.procurement_source_id = dbUser.procurement_source_id;
  } else {
    const sourceParam = searchParams.get('procurementSourceId');
    if (sourceParam) {
      whereClause.procurement_source_id = BigInt(sourceParam);
    }
  }

  if (gteDate || lteDate) {
    whereClause.created_at = {
      ...(gteDate ? { gte: gteDate } : {}),
      ...(lteDate ? { lte: lteDate } : {}),
    };
  }

  try {
    const totalRecords = await prisma.vehicleVisit.count({ where: whereClause });
    const totalPages = Math.ceil(totalRecords / pageSize) || 1;

    const visits = await prisma.vehicleVisit.findMany({
      where: whereClause,
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
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

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

  const allowedRoles = ['MPD_Operator', 'MPD', 'MPD_Zone_Manager', 'Admin', 'Correction_Officer', 'SUPER_ADMIN'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json(
      { error: 'Unauthorized. Authorized active ZMCC or MPD operator user required.' },
      { status: 403 }
    );
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

    // Authoritative Business Date derived on backend from authoritative dispatch timestamp (08:00 cutoff)
    const firstPortionTs = validated.portions[0]?.dispatchTimestamp || new Date().toISOString();
    const chronoVal = validateOperationalTimestamp(firstPortionTs, null, 'Dispatch', 'Baseline');
    const effectiveDispatchDate = chronoVal.isValid && chronoVal.date ? chronoVal.date : new Date(firstPortionTs);
    const canonicalBusinessDateStr = getOperationalBusinessDate(effectiveDispatchDate);

    // Execute Prisma Transaction for atomic creation or draft finalization
    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const receptionNumber = await generateReceptionNumber(tx, canonicalBusinessDateStr);

      const visitNumber = existingVisit.visit_number;
      const visit = await tx.vehicleVisit.update({
        where: { id: existingVisit.id },
        data: {
          vehicle_number: validated.vehicleNumber,
          reception_number: receptionNumber,
          operational_date: new Date(canonicalBusinessDateStr),
          current_status: 'DISPATCHED',
          procurement_source_id: resolvedSourceId,
          vehicle_dispatch_quantity_value: new Prisma.Decimal(validatedQuantities.vehicleQuantity.value),
          vehicle_dispatch_quantity_unit: validatedQuantities.vehicleQuantity.unit,
          vehicle_dispatch_quantity_basis: validatedQuantities.vehicleQuantity.basis,
          vehicle_dispatch_measurement_method: validatedQuantities.vehicleQuantity.method,
        },
      });

      // Ensure assignments & policy snapshot are present
      await getOrAssignDispatchTests(tx, visit.id);
      await getOrFreezeDispatchQuantityPolicy(tx, visit.id, resolvedSourceId!);

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
            dispatch_measurement_method: portionQty.method,
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
    if (error?.name === 'ZodError' || Array.isArray(error?.issues)) {
      const firstMsg = error.issues?.[0]?.message || error.errors?.[0]?.message || 'Validation failed';
      return NextResponse.json({ error: firstMsg }, { status: 400 });
    }
    return NextResponse.json({ error: error?.message || 'Failed to create vehicle dispatch' }, { status: 500 });
  }
}
