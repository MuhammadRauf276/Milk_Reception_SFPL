import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';
import { isCorrectionAuthority } from '@/backend/core/roles/capabilities';
import { writeAuditLog, auditActorFromUser } from '@/backend/core/audit';
import { correctShopCollection } from '@/backend/services/mot/motCore';
import { correctCompletedSession } from '@/backend/services/zmccLabService';
import { computeCanonicalMilkMetrics } from '@/backend/utils/milkFormulas';
import { getTankPhysicalStock } from '@/backend/services/zmccTankService';
import { Prisma } from '@prisma/client';
import { toJsonInput } from '@/lib/json';
import { getErrorMessage } from '@/lib/errors';
import { z } from 'zod';

export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  if (!isCorrectionAuthority(user.role)) {
    return NextResponse.json(
      { error: 'Forbidden. Only Data Executive or Super Admin may access historical records for correction.' },
      { status: 403 }
    );
  }

  const url = new URL(req.url);
  const stage = url.searchParams.get('stage') || '1';
  const search = (url.searchParams.get('search') || '').trim();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(100, Math.max(5, parseInt(url.searchParams.get('pageSize') || '25', 10)));
  const skip = (page - 1) * pageSize;

  try {
    if (stage === '1') {
      // Stage 1: MOT Shop Collections
      const where: Prisma.MotShopCollectionWhereInput = {};
      if (search) {
        where.OR = [
          { collection_number: { contains: search, mode: 'insensitive' } },
          { shop_rmr_number: { contains: search, mode: 'insensitive' } },
          { shop: { shop_name: { contains: search, mode: 'insensitive' } } },
          { route: { name: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const [total, items] = await Promise.all([
        prisma.motShopCollection.count({ where }),
        prisma.motShopCollection.findMany({
          where,
          include: {
            shop: { select: { shop_name: true, shop_code: true } },
            route: { select: { name: true, route_code: true } },
            zmcc: { select: { name: true, code: true } },
            submitted_by: { select: { full_name: true, username: true } },
          },
          orderBy: { server_received_at: 'desc' },
          skip,
          take: pageSize,
        }),
      ]);

      const serialized = items.map((c) => ({
        id: c.id.toString(),
        stage: 'STAGE_1',
        collection_number: c.collection_number,
        token: c.shop_rmr_number || c.collection_number,
        shop_name: c.shop?.shop_name || 'Unknown Shop',
        route_name: c.route?.name || 'Unknown Route',
        zmcc_name: c.zmcc?.name || 'Unknown ZMCC',
        quantity_value: Number(c.quantity_value),
        quantity_unit: c.quantity_unit,
        gross_liters: Number(c.gross_liters),
        density: Number(c.density),
        lr: Number(c.lr),
        fat: Number(c.fat),
        snf: Number(c.snf),
        ts: Number(c.ts),
        at_13ts_liters: Number(c.at_13ts_liters),
        operational_date: c.operational_date.toISOString().split('T')[0],
        correction_count: c.correction_count,
        submitted_by: c.submitted_by?.full_name || c.submitted_by?.username || 'MOT',
      }));

      return NextResponse.json({
        stage: '1',
        total,
        page,
        pageSize,
        items: serialized,
      });
    }

    if (stage === '2') {
      // Stage 2: ZMCC Intake & Lab Sessions
      const where: Prisma.ZmccLabSessionWhereInput = {};
      if (search) {
        where.OR = [
          { mot_arrival: { zmcc_token: { contains: search, mode: 'insensitive' } } },
          { local_supplier_arrival: { zmcc_token: { contains: search, mode: 'insensitive' } } },
          { local_supplier_arrival: { vehicle_number: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const [total, items] = await Promise.all([
        prisma.zmccLabSession.count({ where }),
        prisma.zmccLabSession.findMany({
          where,
          include: {
            zmcc: { select: { name: true, code: true } },
            mot_arrival: {
              select: {
                id: true,
                zmcc_token: true,
                journey: {
                  select: {
                    mot_vehicle: { select: { vehicle_number: true } },
                  },
                },
              },
            },
            local_supplier_arrival: {
              select: {
                id: true,
                zmcc_token: true,
                vehicle_number: true,
                local_supplier: { select: { name: true, local_supplier_code: true } },
                milk_source: { select: { name: true, erp_code: true } },
              },
            },
            results: {
              select: {
                id: true,
                test_id: true,
                test_name_snapshot: true,
                test_code_snapshot: true,
                numeric_value: true,
                text_value: true,
                unit_snapshot: true,
                result_type_snapshot: true,
              },
            },
            portions: {
              select: {
                id: true,
                portion_number: true,
                decision: true,
                first_weight_kg: true,
                second_weight_kg: true,
                net_weight_kg: true,
              },
            },
          },
          orderBy: { started_at: 'desc' },
          skip,
          take: pageSize,
        }),
      ]);

      const serialized = items.map((s) => {
        const arrivalToken = s.mot_arrival?.zmcc_token || s.local_supplier_arrival?.zmcc_token || `SESSION-${s.id}`;
        const vehicleNumber =
          s.mot_arrival?.journey?.mot_vehicle?.vehicle_number ||
          s.local_supplier_arrival?.vehicle_number ||
          'N/A';
        const supplierName =
          s.local_supplier_arrival?.local_supplier?.name ||
          (s.arrival_type === 'MOT' ? 'Mobile Tester Route Bulk' : 'HC Supplier');
        const milkSource = s.local_supplier_arrival?.milk_source?.name || null;

        return {
          id: s.id.toString(),
          stage: 'STAGE_2',
          arrival_type: s.arrival_type,
          token: arrivalToken,
          vehicle_number: vehicleNumber,
          supplier_name: supplierName,
          milk_source: milkSource,
          zmcc_name: s.zmcc?.name || 'ZMCC',
          decision: s.final_decision || s.decision || 'PENDING',
          rejection_reason: s.rejection_reason || null,
          quantity_value: s.quantity_value ? Number(s.quantity_value) : null,
          quantity_unit: s.quantity_unit || 'KG',
          density: s.density ? Number(s.density) : null,
          gross_liters: s.gross_liters ? Number(s.gross_liters) : null,
          snf: s.snf ? Number(s.snf) : null,
          ts: s.ts ? Number(s.ts) : null,
          at_13ts_liters: s.at_13ts_liters ? Number(s.at_13ts_liters) : null,
          started_at: s.started_at.toISOString(),
          completed_at: s.completed_at ? s.completed_at.toISOString() : null,
          correction_count: s.correction_count,
          results: s.results.map((r) => ({
            id: r.id.toString(),
            test_id: r.test_id.toString(),
            test_name: r.test_name_snapshot,
            test_code: r.test_code_snapshot,
            numeric_value: r.numeric_value ? Number(r.numeric_value) : null,
            text_value: r.text_value || null,
            unit: r.unit_snapshot || '',
            result_type: r.result_type_snapshot,
          })),
          portions: s.portions.map((p) => ({
            id: p.id.toString(),
            portion_number: p.portion_number,
            decision: p.decision,
            first_weight_kg: p.first_weight_kg ? Number(p.first_weight_kg) : null,
            second_weight_kg: p.second_weight_kg ? Number(p.second_weight_kg) : null,
            net_weight_kg: p.net_weight_kg ? Number(p.net_weight_kg) : null,
          })),
        };
      });

      return NextResponse.json({
        stage: '2',
        total,
        page,
        pageSize,
        items: serialized,
      });
    }

    if (stage === '3') {
      // Stage 3: ZMCC & Contractor Dispatches to Plant
      const where: Prisma.VehicleVisitWhereInput = {
        OR: [
          { raw_milk_dispatch_note_number: { not: null } },
          { procurement_source: { source_type: { in: ['ZMCC', 'CONTRACTOR'] } } },
        ],
      };

      if (search) {
        where.AND = [
          {
            OR: [
              { visit_number: { contains: search, mode: 'insensitive' } },
              { vehicle_number: { contains: search, mode: 'insensitive' } },
              { raw_milk_dispatch_note_number: { contains: search, mode: 'insensitive' } },
              { token_number: { contains: search, mode: 'insensitive' } },
            ],
          },
        ];
      }

      const [total, items] = await Promise.all([
        prisma.vehicleVisit.count({ where }),
        prisma.vehicleVisit.findMany({
          where,
          include: {
            procurement_source: { select: { name: true, source_type: true, erp_code: true } },
            portions: {
              select: {
                id: true,
                portion_number: true,
                dispatch_seal_number: true,
                net_weight_kg: true,
              },
            },
          },
          orderBy: { created_at: 'desc' },
          skip,
          take: pageSize,
        }),
      ]);

      const serialized = items.map((v) => ({
        id: v.id.toString(),
        stage: 'STAGE_3',
        visit_number: v.visit_number,
        token: v.raw_milk_dispatch_note_number || v.visit_number,
        vehicle_number: v.vehicle_number,
        raw_milk_dispatch_note_number: v.raw_milk_dispatch_note_number,
        source_name: v.procurement_source?.name || 'Direct / Plant',
        source_type: v.procurement_source?.source_type || 'N/A',
        quantity_value: v.vehicle_dispatch_quantity_value ? Number(v.vehicle_dispatch_quantity_value) : null,
        quantity_unit: v.vehicle_dispatch_quantity_unit || 'KG',
        gross_liters: v.vehicle_dispatch_gross_liters ? Number(v.vehicle_dispatch_gross_liters) : null,
        density: v.vehicle_dispatch_density ? Number(v.vehicle_dispatch_density) : null,
        lr: v.vehicle_dispatch_lr ? Number(v.vehicle_dispatch_lr) : null,
        fat: v.vehicle_dispatch_fat ? Number(v.vehicle_dispatch_fat) : null,
        at_13ts_liters: v.vehicle_dispatch_at_13ts_liters ? Number(v.vehicle_dispatch_at_13ts_liters) : null,
        current_status: v.current_status,
        created_at: v.created_at.toISOString(),
        correction_count: v.correction_count,
        portions: v.portions.map((p) => ({
          id: p.id.toString(),
          portion_number: p.portion_number,
          seal_number: p.dispatch_seal_number || 'N/A',
          net_weight_kg: p.net_weight_kg ? Number(p.net_weight_kg) : null,
        })),
      }));

      return NextResponse.json({
        stage: '3',
        total,
        page,
        pageSize,
        items: serialized,
      });
    }

    if (stage === '4') {
      // Stage 4: Plant Reception (Gate, Weighbridge, QA, Silo)
      const where: Prisma.VehicleVisitWhereInput = {};
      if (search) {
        where.OR = [
          { visit_number: { contains: search, mode: 'insensitive' } },
          { vehicle_number: { contains: search, mode: 'insensitive' } },
          { token_number: { contains: search, mode: 'insensitive' } },
          { procurement_source: { name: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const [total, items] = await Promise.all([
        prisma.vehicleVisit.count({ where }),
        prisma.vehicleVisit.findMany({
          where,
          include: {
            procurement_source: { select: { name: true, source_type: true } },
            weight_ticket: {
              select: {
                id: true,
                ticket_number: true,
                gross_weight_kg: true,
                tare_weight_kg: true,
                net_weight_kg: true,
                gross_timestamp: true,
                tare_timestamp: true,
              },
            },
            portions: {
              include: {
                unloading_log: {
                  include: {
                    silo: { select: { silo_code: true, silo_name: true } },
                  },
                },
              },
            },
          },
          orderBy: { created_at: 'desc' },
          skip,
          take: pageSize,
        }),
      ]);

      const serialized = items.map((v) => {
        const wt = v.weight_ticket;
        const firstPortionWithSilo = v.portions.find((p) => p.unloading_log?.silo);
        const siloInfo = firstPortionWithSilo?.unloading_log?.silo;

        return {
          id: v.id.toString(),
          stage: 'STAGE_4',
          visit_number: v.visit_number,
          token: v.token_number || v.visit_number,
          token_number: v.token_number,
          vehicle_number: v.vehicle_number,
          source_name: v.procurement_source?.name || 'Plant Gate',
          current_status: v.current_status,
          gross_weight_kg: wt?.gross_weight_kg ? Number(wt.gross_weight_kg) : null,
          tare_weight_kg: wt?.tare_weight_kg ? Number(wt.tare_weight_kg) : null,
          net_weight_kg: wt?.net_weight_kg ? Number(wt.net_weight_kg) : null,
          silo_number: siloInfo?.silo_code || siloInfo?.silo_name || 'Unassigned',
          created_at: v.created_at.toISOString(),
          correction_count: v.correction_count,
        };
      });

      return NextResponse.json({
        stage: '4',
        total,
        page,
        pageSize,
        items: serialized,
      });
    }

    return NextResponse.json({ error: 'Invalid stage parameter.' }, { status: 400 });
  } catch (err) {
    console.error('GET /api/corrections/records error:', err);
    return NextResponse.json({ error: getErrorMessage(err) || 'Failed to fetch stage records.' }, { status: 500 });
  }
}

const patchSchema = z.object({
  stage: z.union([z.literal('1'), z.literal('2'), z.literal('3'), z.literal('4'), z.number()]),
  recordId: z.string().min(1, 'Record ID is required.'),
  reason: z.string().trim().min(5, 'Substantive justification reason of at least 5 characters is required.'),
  changes: z.record(z.string(), z.unknown()),
});

export async function PATCH(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  if (!isCorrectionAuthority(user.role)) {
    return NextResponse.json(
      { error: 'Forbidden. Only Data Executive or Super Admin may execute direct corrections.' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const validated = patchSchema.parse(body);
    const stageStr = String(validated.stage);
    const recordId = validated.recordId;
    const reason = validated.reason.trim();
    const changes = validated.changes;
    const userName = user.name || user.username;

    if (stageStr === '1') {
      // Direct correction of MOT Shop Collection
      const res = await correctShopCollection(user, recordId, {
        reason: `Direct correction by ${user.role} (${userName}): ${reason}`,
        quantity_value: typeof changes.quantity_value === 'number' ? changes.quantity_value : undefined,
        quantity_unit: typeof changes.quantity_unit === 'string' ? (changes.quantity_unit as 'KG' | 'LITER') : undefined,
        lr: typeof changes.lr === 'number' ? changes.lr : undefined,
        fat: typeof changes.fat === 'number' ? changes.fat : undefined,
        shop_rmr_number: typeof changes.shop_rmr_number === 'string' ? changes.shop_rmr_number : undefined,
      });

      if (res.error) {
        return NextResponse.json({ error: res.error }, { status: res.status });
      }

      return NextResponse.json({
        success: true,
        message: 'Mobile Tester Shop Collection successfully corrected and recalculated.',
        data: res.data,
      });
    }

    if (stageStr === '2') {
      // Direct correction of ZMCC Lab Session
      const res = await correctCompletedSession(user, recordId, {
        reason: `Direct correction by ${user.role} (${userName}): ${reason}`,
        quantity_value: typeof changes.quantity_value === 'number' ? changes.quantity_value : undefined,
        quantity_unit: typeof changes.quantity_unit === 'string' ? (changes.quantity_unit as 'KG' | 'LITER') : undefined,
        decision: typeof changes.decision === 'string' ? (changes.decision as 'ACCEPTED' | 'REJECTED') : undefined,
        rejection_reason: typeof changes.rejection_reason === 'string' ? changes.rejection_reason : undefined,
        results: Array.isArray(changes.results) ? changes.results : undefined,
      });

      if (res.error) {
        return NextResponse.json({ error: res.error }, { status: res.status });
      }

      return NextResponse.json({
        success: true,
        message: 'ZMCC Lab Session successfully corrected, stock adjusted, and recomputed.',
        data: res.data,
      });
    }

    if (stageStr === '3') {
      // Direct correction of Dispatch to Plant
      const visitId = BigInt(recordId);

      const result = await prisma.$transaction(async (tx) => {
        const visit = await tx.vehicleVisit.findUnique({
          where: { id: visitId },
          include: { procurement_source: true },
        });

        if (!visit) {
          throw new Error('Dispatch record not found.');
        }

        const oldAuditValues = {
          raw_milk_dispatch_note_number: visit.raw_milk_dispatch_note_number,
          quantity_value: visit.vehicle_dispatch_quantity_value ? Number(visit.vehicle_dispatch_quantity_value) : null,
          quantity_unit: visit.vehicle_dispatch_quantity_unit,
          lr: visit.vehicle_dispatch_lr ? Number(visit.vehicle_dispatch_lr) : null,
          fat: visit.vehicle_dispatch_fat ? Number(visit.vehicle_dispatch_fat) : null,
          gross_liters: visit.vehicle_dispatch_gross_liters ? Number(visit.vehicle_dispatch_gross_liters) : null,
        };

        const effQtyVal = typeof changes.quantity_value === 'number'
          ? changes.quantity_value
          : (visit.vehicle_dispatch_quantity_value ? Number(visit.vehicle_dispatch_quantity_value) : 0);

        const effQtyUnit = typeof changes.quantity_unit === 'string'
          ? (changes.quantity_unit as 'KG' | 'LITER')
          : ((visit.vehicle_dispatch_quantity_unit as 'KG' | 'LITER') || 'KG');

        const effLr = typeof changes.lr === 'number'
          ? changes.lr
          : (visit.vehicle_dispatch_lr ? Number(visit.vehicle_dispatch_lr) : null);

        const effFat = typeof changes.fat === 'number'
          ? changes.fat
          : (visit.vehicle_dispatch_fat ? Number(visit.vehicle_dispatch_fat) : null);

        const effNote = typeof changes.raw_milk_dispatch_note_number === 'string'
          ? changes.raw_milk_dispatch_note_number.trim()
          : visit.raw_milk_dispatch_note_number;

        let density: number | null = null;
        let grossLiters: number | null = null;
        let snf: number | null = null;
        let ts: number | null = null;
        let at13tsLiters: number | null = null;
        let calcVer: string | null = null;

        if (effLr !== null && effFat !== null && effQtyVal > 0) {
          const canonical = computeCanonicalMilkMetrics(effQtyVal, effQtyUnit, effLr, effFat);
          density = canonical.density;
          grossLiters = canonical.grossLiters;
          snf = canonical.snf;
          ts = canonical.ts;
          at13tsLiters = canonical.at13tsLiters;
          calcVer = canonical.calculationVersion;
        } else if (effQtyVal > 0) {
          grossLiters = effQtyVal;
        }

        // Adjust ZMCC Tank issue inventory if physical gross liters changed
        const oldGross = visit.vehicle_dispatch_gross_liters ? Number(visit.vehicle_dispatch_gross_liters) : null;
        if (visit.procurement_source?.source_type === 'ZMCC' && grossLiters !== null && oldGross !== null) {
          const deltaGross = Number((grossLiters - oldGross).toFixed(2));
          if (Math.abs(deltaGross) >= 0.01) {
            const existingIssue = await tx.zmccTankInventoryTransaction.findFirst({
              where: { dispatch_id: visit.id, reference_type: 'DISPATCH' },
            });
            if (existingIssue) {
              const currentStock = await getTankPhysicalStock(existingIssue.tank_id, tx);
              if (deltaGross > 0 && currentStock < deltaGross) {
                throw new Error(`Insufficient tank physical stock for dispatch correction. Available: ${currentStock} L; requires: ${deltaGross} L.`);
              }
              const direction = deltaGross > 0 ? 'ADJUSTMENT_OUT' : 'ADJUSTMENT_IN';
              await tx.zmccTankInventoryTransaction.create({
                data: {
                  tank_id: existingIssue.tank_id,
                  zmcc_id: visit.procurement_source_id!,
                  transaction_type: direction,
                  quantity_liters: new Prisma.Decimal(Math.abs(deltaGross).toFixed(2)),
                  at_13ts_liters: new Prisma.Decimal('0.00'),
                  dispatch_id: visit.id,
                  reference_type: 'DISPATCH_CORRECTION',
                  reference_id: `${visit.id}:DIRECT_CORR`,
                  idempotency_key: `DISPATCH_CORRECTION:${visit.id}:${Date.now()}`,
                  operational_timestamp: new Date(),
                  performed_by_user_id: BigInt(user.id),
                  notes: `Direct dispatch correction (${direction}) by ${user.role} (${userName}): ${reason}`,
                },
              });
            }
          }
        }

        // Update Visit
        const updated = await tx.vehicleVisit.update({
          where: { id: visit.id },
          data: {
            raw_milk_dispatch_note_number: effNote,
            vehicle_dispatch_quantity_value: new Prisma.Decimal(effQtyVal),
            vehicle_dispatch_quantity_unit: effQtyUnit,
            vehicle_dispatch_lr: effLr !== null ? new Prisma.Decimal(effLr.toFixed(2)) : null,
            vehicle_dispatch_fat: effFat !== null ? new Prisma.Decimal(effFat.toFixed(2)) : null,
            vehicle_dispatch_density: density !== null ? new Prisma.Decimal(density.toFixed(4)) : null,
            vehicle_dispatch_gross_liters: grossLiters !== null ? new Prisma.Decimal(grossLiters.toFixed(2)) : null,
            vehicle_dispatch_snf: snf !== null ? new Prisma.Decimal(snf.toFixed(2)) : null,
            vehicle_dispatch_ts: ts !== null ? new Prisma.Decimal(ts.toFixed(2)) : null,
            vehicle_dispatch_at_13ts_liters: at13tsLiters !== null ? new Prisma.Decimal(at13tsLiters.toFixed(2)) : null,
            vehicle_dispatch_calculation_version: calcVer,
            correction_count: { increment: 1 },
            last_corrected_by_user_id: BigInt(user.id),
            last_corrected_at: new Date(),
          },
        });

        // Audit Log
        await writeAuditLog(tx, {
          tableName: 'vehicle_visit',
          recordId: visit.id,
          action: 'VEHICLE_DISPATCH_CORRECTED',
          oldValues: toJsonInput(oldAuditValues),
          newValues: toJsonInput({
            raw_milk_dispatch_note_number: effNote,
            quantity_value: effQtyVal,
            quantity_unit: effQtyUnit,
            lr: effLr,
            fat: effFat,
            gross_liters: grossLiters,
            reason,
          }),
          actor: auditActorFromUser(user),
        });

        return updated;
      });

      return NextResponse.json({
        success: true,
        message: 'Dispatch record successfully corrected, stock adjusted, and metrics recalculated.',
        data: { id: result.id.toString(), visit_number: result.visit_number },
      });
    }

    if (stageStr === '4') {
      // Direct correction of Plant Reception (Weights, Token)
      const visitId = BigInt(recordId);

      const result = await prisma.$transaction(async (tx) => {
        const visit = await tx.vehicleVisit.findUnique({
          where: { id: visitId },
          include: { weight_ticket: true },
        });

        if (!visit) {
          throw new Error('Plant reception visit record not found.');
        }

        const wt = visit.weight_ticket;
        const oldAuditValues = {
          token_number: visit.token_number,
          vehicle_number: visit.vehicle_number,
          gross_weight_kg: wt?.gross_weight_kg ? Number(wt.gross_weight_kg) : null,
          tare_weight_kg: wt?.tare_weight_kg ? Number(wt.tare_weight_kg) : null,
          net_weight_kg: wt?.net_weight_kg ? Number(wt.net_weight_kg) : null,
        };

        const effToken = typeof changes.token_number === 'string' ? changes.token_number.trim() : visit.token_number;
        const effVehicle = typeof changes.vehicle_number === 'string' ? changes.vehicle_number.trim().toUpperCase() : visit.vehicle_number;

        let effGross = typeof changes.gross_weight_kg === 'number'
          ? changes.gross_weight_kg
          : (wt?.gross_weight_kg ? Number(wt.gross_weight_kg) : null);

        let effTare = typeof changes.tare_weight_kg === 'number'
          ? changes.tare_weight_kg
          : (wt?.tare_weight_kg ? Number(wt.tare_weight_kg) : null);

        let effNet: number | null = null;
        if (effGross !== null && effTare !== null) {
          effNet = Number((effGross - effTare).toFixed(2));
        }

        // Update Visit
        await tx.vehicleVisit.update({
          where: { id: visit.id },
          data: {
            token_number: effToken,
            vehicle_number: effVehicle,
            correction_count: { increment: 1 },
            last_corrected_by_user_id: BigInt(user.id),
            last_corrected_at: new Date(),
          },
        });

        // Update or Create Weight Ticket if weights provided
        if (effGross !== null || effTare !== null) {
          if (wt) {
            await tx.weightTicket.update({
              where: { id: wt.id },
              data: {
                gross_weight_kg: effGross !== null ? new Prisma.Decimal(effGross.toFixed(2)) : undefined,
                tare_weight_kg: effTare !== null ? new Prisma.Decimal(effTare.toFixed(2)) : undefined,
                net_weight_kg: effNet !== null ? new Prisma.Decimal(effNet.toFixed(2)) : undefined,
              },
            });
          }
        }

        // Audit Log
        await writeAuditLog(tx, {
          tableName: 'vehicle_visit',
          recordId: visit.id,
          action: 'PLANT_RECEPTION_CORRECTED',
          oldValues: toJsonInput(oldAuditValues),
          newValues: toJsonInput({
            token_number: effToken,
            vehicle_number: effVehicle,
            gross_weight_kg: effGross,
            tare_weight_kg: effTare,
            net_weight_kg: effNet,
            reason,
          }),
          actor: auditActorFromUser(user),
        });

        return { id: visit.id.toString(), visit_number: visit.visit_number };
      });

      return NextResponse.json({
        success: true,
        message: 'Plant reception record successfully corrected and recomputed.',
        data: result,
      });
    }

    return NextResponse.json({ error: 'Invalid stage specified.' }, { status: 400 });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message || 'Validation error' }, { status: 400 });
    }
    console.error('PATCH /api/corrections/records error:', err);
    return NextResponse.json({ error: getErrorMessage(err) || 'Failed to apply direct correction.' }, { status: 400 });
  }
}
