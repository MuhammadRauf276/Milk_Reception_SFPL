import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { createDispatchSchema } from '@/lib/validations/dispatch';
import { evaluateLabResult } from '@/lib/lab-rules';
import { generateReceptionNumber } from '@/lib/reception-number';
import { validatePositiveDecimal, validateRequiredString } from '@/lib/validation-helpers';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';
import { calculateSNF, calculateRatio } from '@/backend/utils/milkFormulas';

function serializeDispatch(visit: any) {
  const portions = visit.portions || [];
  const totalDeclaredKg = portions.reduce(
    (sum: number, p: any) => sum + (p.declared_quantity_kg ? Number(p.declared_quantity_kg) : 0),
    0
  );
  const firstPortion = portions[0];
  const firstDispatchInfo = firstPortion?.dispatch_info;
  const gateLog = visit.gate_log;

  return {
    id: visit.id.toString(),
    visit_number: visit.visit_number,
    reception_number: visit.reception_number || null,
    vehicle_number: visit.vehicle_number,
    token_number: visit.token_number || null,
    operational_date: visit.operational_date ? visit.operational_date.toISOString().split('T')[0] : null,
    current_status: visit.current_status,
    portion_count: portions.length,
    total_declared_kg: totalDeclaredKg,
    zonal_contractor_name: visit.procurement_source?.name || 'Source unavailable',
    zonal_contractor_dispatch_time: firstDispatchInfo?.dispatch_timestamp
      ? new Date(firstDispatchInfo.dispatch_timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : null,
    has_gate_entry: !!gateLog?.entry_timestamp,
    portions: portions.map((p: any) => ({
      id: p.id.toString(),
      portion_number: p.portion_number,
      declared_quantity_kg: p.declared_quantity_kg ? Number(p.declared_quantity_kg) : 0,
      plant_decision: p.plant_decision || 'PENDING',
      current_status: p.current_status,
    })),
  };
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = new URL(req.url).searchParams;
  const range = searchParams.get('range') || '7d';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.max(1, Math.min(100, parseInt(searchParams.get('pageSize') || '20', 10)));
  const fromDateParam = searchParams.get('fromDate');
  const toDateParam = searchParams.get('toDate');
  const statusFilter = searchParams.get('status');

  const now = new Date();
  let gteDate: Date | undefined;
  let lteDate: Date | undefined;

  if (range === 'today') {
    gteDate = new Date();
    gteDate.setHours(0, 0, 0, 0);
    lteDate = new Date();
    lteDate.setHours(23, 59, 59, 999);
  } else if (range === '7d') {
    gteDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  } else if (range === '30d') {
    gteDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  } else if (range === 'custom') {
    if (fromDateParam) {
      gteDate = new Date(fromDateParam);
    }
    if (toDateParam) {
      const d = new Date(toDateParam);
      d.setHours(23, 59, 59, 999);
      lteDate = d;
    }
    if (gteDate && lteDate && gteDate > lteDate) {
      return NextResponse.json({ error: 'From Date cannot be after To Date' }, { status: 400 });
    }
  }

  const whereClause: any = {
    current_status: statusFilter ? statusFilter : { notIn: ['CANCELLED'] },
  };

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
  const authUser = await getCurrentUser();
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
  }

  // 2. Find corresponding User row in PostgreSQL database
  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [
        { username: authUser.username },
        { username: authUser.id },
      ],
      is_active: true,
    },
  });

  const allowedRoles = ['MPD_Operator', 'MPD', 'MPD_Zone_Manager', 'Admin', 'Correction_Officer'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json(
      { error: 'Unauthorized. Authorized active ZMCC or MPD operator user required.' },
      { status: 403 }
    );
  }

  // 3. Use dbUser.id (Prisma BigInt primary key) for relational fields
  const userIdBigInt = dbUser.id;

  try {
    const body = await req.json();
    const validated = createDispatchSchema.parse(body);

    // Validate Vehicle Number
    const vehValidation = validateRequiredString(validated.vehicleNumber, 'Vehicle Number', 50);
    if (!vehValidation.isValid) {
      return NextResponse.json({ error: vehValidation.error }, { status: 400 });
    }

    // Validate Dispatch portion quantity > 0 & finite
    for (const portion of validated.portions) {
      const qtyVal = validatePositiveDecimal(portion.declaredQuantityKg, `Portion ${portion.portionNumber} Quantity`);
      if (!qtyVal.isValid) {
        return NextResponse.json({ error: qtyVal.error }, { status: 400 });
      }
    }

    // Validate Dispatch operational timestamp <= serverNow
    const firstPortionTs = validated.portions[0]?.dispatchTimestamp || new Date().toISOString();
    const chronoVal = validateOperationalTimestamp(firstPortionTs, null, 'Dispatch', 'Baseline');
    if (!chronoVal.isValid) {
      return NextResponse.json({ error: chronoVal.error }, { status: 400 });
    }

    // Fetch active DISPATCH & BOTH lab tests from database
    const activeTests = await prisma.labTest.findMany({
      where: {
        isActive: true,
        testScope: { in: ['DISPATCH', 'BOTH'] },
      },
    });

    const activeTestMap = new Map<string, typeof activeTests[0]>();
    const requiredTestIds = new Set<string>();

    activeTests.forEach((t) => {
      const idStr = t.id.toString();
      activeTestMap.set(idStr, t);
      // Exclude CALCULATED tests from manual requirement check
      if (t.isRequired && t.resultType !== 'CALCULATED') {
        requiredTestIds.add(idStr);
      }
    });

    // Validate that all required manual active tests exist in every submitted portion
    for (const portion of validated.portions) {
      const submittedTestIds = new Set(portion.results.map((r) => r.testId));

      for (const reqId of Array.from(requiredTestIds)) {
        if (!submittedTestIds.has(reqId)) {
          const reqTest = activeTestMap.get(reqId);
          return NextResponse.json(
            {
              error: `Required test "${reqTest?.testName || reqId}" is missing for Portion ${portion.portionNumber}.`,
            },
            { status: 400 }
          );
        }
      }

      // Validate result types & categorical options for submitted manual results
      for (const res of portion.results) {
        const testDef = activeTestMap.get(res.testId);
        if (!testDef) continue;

        if (testDef.resultType === 'NUMERIC') {
          if (res.numericValue === null || res.numericValue === undefined || isNaN(res.numericValue)) {
            return NextResponse.json(
              { error: `Numeric value required for test "${testDef.testName}" in Portion ${portion.portionNumber}.` },
              { status: 400 }
            );
          }
        } else if (testDef.resultType === 'OK_NOT_OK') {
          const val = (res.textValue || '').trim().toUpperCase();
          if (!val || !['OK', 'NOT_OK'].includes(val)) {
            return NextResponse.json(
              { error: `Invalid option "${res.textValue}" for test "${testDef.testName}" in Portion ${portion.portionNumber}. Option must be OK or NOT_OK.` },
              { status: 400 }
            );
          }
        } else if (testDef.resultType === 'POSITIVE_NEGATIVE') {
          const val = (res.textValue || '').trim().toUpperCase();
          if (!val || !['NEGATIVE', 'POSITIVE'].includes(val)) {
            return NextResponse.json(
              { error: `Invalid option "${res.textValue}" for test "${testDef.testName}" in Portion ${portion.portionNumber}. Option must be NEGATIVE or POSITIVE.` },
              { status: 400 }
            );
          }
        } else if (testDef.resultType === 'CALCULATED') {
          // System-derived / read-only fields ignore manual text input spoofing
        } else if (testDef.resultType === 'TEXT' || testDef.resultType === 'QUALITATIVE' || testDef.resultType === 'BOOLEAN') {
          if (!res.textValue || res.textValue.trim() === '') {
            return NextResponse.json(
              { error: `Valid value required for test "${testDef.testName}" in Portion ${portion.portionNumber}.` },
              { status: 400 }
            );
          }
        }
      }
    }

    // Resolve mandatory ProcurementSource for new operational visits
    let resolvedSourceId: bigint | null = dbUser.procurement_source_id;
    if (!resolvedSourceId && body.procurementSourceId) {
      const pId = BigInt(body.procurementSourceId);
      const src = await prisma.procurementSource.findUnique({ where: { id: pId, is_active: true } });
      if (src) resolvedSourceId = src.id;
    }
    if (!resolvedSourceId) {
      const defaultSrc = await prisma.procurementSource.findFirst({ where: { is_active: true }, orderBy: { id: 'asc' } });
      if (defaultSrc) resolvedSourceId = defaultSrc.id;
    }
    if (!resolvedSourceId) {
      return NextResponse.json({ error: 'A valid active Procurement Source is required for dispatch creation.' }, { status: 400 });
    }

    // Execute Prisma Transaction for atomic creation
    const result = await prisma.$transaction(async (tx) => {
      const dateStr = validated.operationalDate;
      const opDate = new Date(dateStr);
      const now = new Date();

      // Generate unique visitNumber: VV-YYYYMMDD-XXXXXX
      const dateCode = dateStr.replace(/-/g, '');
      const countToday = await tx.vehicleVisit.count({
        where: {
          created_at: {
            gte: new Date(opDate.setHours(0, 0, 0, 0)),
            lte: new Date(opDate.setHours(23, 59, 59, 999)),
          },
        },
      });
      const seqStr = String(countToday + 1).padStart(4, '0');
      const visitNumber = `VV-${dateCode}-${seqStr}`;

      // Generate human-facing Milk Reception Number (concurrency safe)
      const receptionNumber = await generateReceptionNumber(tx, validated.operationalDate);

      // 1. Create VehicleVisit
      const visit = await tx.vehicleVisit.create({
        data: {
          visit_number: visitNumber,
          reception_number: receptionNumber,
          vehicle_number: validated.vehicleNumber,
          operational_date: new Date(validated.operationalDate),
          current_status: 'DISPATCHED',
          created_by: userIdBigInt,
          procurement_source_id: resolvedSourceId,
        },
      });

      // 2. Create VisitPortion, DispatchInfo, and DispatchLabResult rows for each portion
      for (const portionInput of validated.portions) {
        const portion = await tx.visitPortion.create({
          data: {
            visit_id: visit.id,
            portion_number: portionInput.portionNumber,
            declared_quantity_kg: portionInput.declaredQuantityKg,
            current_status: 'DISPATCHED',
            plant_decision: 'PENDING',
          },
        });

        // Create DispatchInfo with validated operational timestamp
        const portionChrono = validateOperationalTimestamp(portionInput.dispatchTimestamp || validated.operationalDate, null, 'Dispatch', 'Baseline');
        await tx.dispatchInfo.create({
          data: {
            portion_id: portion.id,
            dispatch_number: `DISP-${visitNumber}-P${portionInput.portionNumber}`,
            dispatch_timestamp: portionChrono.date || (portionInput.dispatchTimestamp ? new Date(portionInput.dispatchTimestamp) : now),
            recorded_by: userIdBigInt,
          },
        });

        // Extract raw Fat and LR values submitted for this portion
        const submittedResultsMap = new Map<string, { numericValue: number | null; textValue: string | null }>();
        portionInput.results.forEach((r) => {
          submittedResultsMap.set(r.testId, {
            numericValue: r.numericValue !== undefined && r.numericValue !== null ? r.numericValue : null,
            textValue: r.textValue ? r.textValue.trim() : null,
          });
        });

        // Find raw Fat & LR inputs
        let submittedFat: number | null = null;
        let submittedLr: number | null = null;

        activeTests.forEach((t) => {
          const idStr = t.id.toString();
          const tName = t.testName.toLowerCase();
          const res = submittedResultsMap.get(idStr);
          if (res && res.numericValue !== null && !isNaN(res.numericValue)) {
            if (tName.includes('fat') && !tName.includes('ratio') && !tName.includes('snf')) {
              submittedFat = res.numericValue;
            } else if (tName.includes('lactometer') || tName.includes('lr')) {
              submittedLr = res.numericValue;
            }
          }
        });

        // Create DispatchLabResult for every active test (submitted manual + server-calculated)
        for (const testDef of activeTests) {
          const testIdStr = testDef.id.toString();
          const submittedRes = submittedResultsMap.get(testIdStr);

          let numVal: number | null = submittedRes?.numericValue ?? null;
          let textVal: string | null = submittedRes?.textValue ?? null;

          // Server-side authoritative derivation for CALCULATED tests
          if (testDef.resultType === 'CALCULATED') {
            if (submittedFat !== null && submittedLr !== null) {
              const snf = calculateSNF(submittedLr, submittedFat);
              const ratio = calculateRatio(snf, submittedFat);
              numVal = ratio;
              textVal = ratio.toFixed(3);
            } else {
              numVal = null;
              textVal = null;
            }
          }

          // If test is not submitted and not calculated, skip unsubmitted optional tests
          if (!submittedRes && testDef.resultType !== 'CALCULATED') {
            continue;
          }

          const evalRes = evaluateLabResult(testDef.testCode, numVal, textVal, testDef.resultType);

          await tx.dispatchLabResult.create({
            data: {
              visit_id: visit.id,
              portion_id: portion.id,
              test_id: testDef.id,
              sample_timestamp: now,
              result_timestamp: now,
              numeric_value: numVal,
              text_value: textVal,
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
    if (error?.name === 'ZodError') {
      return NextResponse.json({ error: error.errors[0]?.message || 'Validation failed' }, { status: 400 });
    }
    return NextResponse.json({ error: error?.message || 'Failed to create vehicle dispatch' }, { status: 500 });
  }
}
