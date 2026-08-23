import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getOperationalBusinessDate } from '@/backend/core/business-day';
import { MilkProcessLog, KANBAN_STAGES } from '@/backend/core/types';
import { computeAuthoritativeZonalAnalytics } from '@/backend/services/operationalCalculations';
import { calculateVehicleReceivedQuantity, VehicleCalculationPortion } from '@/backend/services/vehicleQuantityService';

describe('Stage 4C-Stabilization: Post-Merge Operational Corrections', () => {
  describe('1. Business Date Range & Boundary Rules', () => {
    it('[BUSINESS-DATE-PKT-BOUNDARY] Evaluates 08:00 AM PKT cutover correctly', () => {
      // 07:30 PKT on Aug 22, 2026 is 02:30 UTC on Aug 22, 2026
      const beforeCutoffUTC = new Date('2026-08-22T02:30:00.000Z');
      const bDateBefore = getOperationalBusinessDate(beforeCutoffUTC);
      expect(bDateBefore).toBe('2026-08-21');

      // 07:59:59 PKT on Aug 22, 2026 is 02:59:59 UTC on Aug 22, 2026
      const justBeforeCutoffUTC = new Date('2026-08-22T02:59:59.000Z');
      const bDateJustBefore = getOperationalBusinessDate(justBeforeCutoffUTC);
      expect(bDateJustBefore).toBe('2026-08-21');

      // 08:00:00 PKT on Aug 22, 2026 is 03:00:00 UTC on Aug 22, 2026
      const exactlyCutoffUTC = new Date('2026-08-22T03:00:00.000Z');
      const bDateAtCutoff = getOperationalBusinessDate(exactlyCutoffUTC);
      expect(bDateAtCutoff).toBe('2026-08-22');

      // 08:05 PKT on Aug 22, 2026 is 03:05:00 UTC on Aug 22, 2026
      const afterCutoffUTC = new Date('2026-08-22T03:05:00.000Z');
      const bDateAfter = getOperationalBusinessDate(afterCutoffUTC);
      expect(bDateAfter).toBe('2026-08-22');
    });
  });

  describe('2. Dashboard Canonical Statuses & Vehicle Deduplication', () => {
    function getDistinctVehicleCount(logs: MilkProcessLog[]): number {
      const visitIds = new Set<string | number>();
      for (const log of logs) {
        const key = log.visit_number || (log.id ? String(log.id) : null);
        if (key) visitIds.add(key);
      }
      return visitIds.size;
    }

    const testLogs: MilkProcessLog[] = [
      // Vehicle 1 (Multi-portion: 2 portions in PLANT_QA)
      {
        id: 101,
        portion_id: 1,
        visit_number: 'VV-20260822-0001',
        vehicle_number: 'LHR-1001',
        portion_number: 'P-01',
        zonal_contractor_name: 'ZMCC Hasilpur',
        status: 'PLANT_QA',
        dispatch_date: '2026-08-22',
        created_at: '2026-08-22T04:00:00.000Z',
        updated_at: '2026-08-22T04:00:00.000Z',
      },
      {
        id: 101,
        portion_id: 2,
        visit_number: 'VV-20260822-0001',
        vehicle_number: 'LHR-1001',
        portion_number: 'P-02',
        zonal_contractor_name: 'ZMCC Hasilpur',
        status: 'PLANT_QA',
        dispatch_date: '2026-08-22',
        created_at: '2026-08-22T04:00:00.000Z',
        updated_at: '2026-08-22T04:00:00.000Z',
      },
      // Vehicle 2 (Single portion in READY_FOR_GROSS)
      {
        id: 102,
        portion_id: 3,
        visit_number: 'VV-20260822-0002',
        vehicle_number: 'LHR-1002',
        portion_number: 'P-01',
        zonal_contractor_name: 'ZMCC Hasilpur',
        status: 'READY_FOR_GROSS',
        dispatch_date: '2026-08-22',
        created_at: '2026-08-22T04:30:00.000Z',
        updated_at: '2026-08-22T04:30:00.000Z',
      },
      // Vehicle 3 (Single portion COMPLETED on 2026-08-22)
      {
        id: 103,
        portion_id: 4,
        visit_number: 'VV-20260822-0003',
        vehicle_number: 'LHR-1003',
        portion_number: 'P-01',
        zonal_contractor_name: 'ZMCC Hasilpur',
        status: 'COMPLETED',
        dispatch_date: '2026-08-22',
        created_at: '2026-08-22T05:00:00.000Z',
        updated_at: '2026-08-22T05:30:00.000Z',
      },
      // Vehicle 4 (En-route DISPATCHED)
      {
        id: 104,
        portion_id: 5,
        visit_number: 'VV-20260822-0004',
        vehicle_number: 'LHR-1004',
        portion_number: 'P-01',
        zonal_contractor_name: 'ZMCC Hasilpur',
        status: 'DISPATCHED',
        dispatch_date: '2026-08-22',
        created_at: '2026-08-22T05:30:00.000Z',
        updated_at: '2026-08-22T05:30:00.000Z',
      },
    ];

    it('[DEDUP-VEHICLE-COUNT] 1 vehicle with 2 portions deduplicates to 1 distinct vehicle', () => {
      const v1Portions = testLogs.filter((l) => l.visit_number === 'VV-20260822-0001');
      expect(v1Portions).toHaveLength(2);
      expect(getDistinctVehicleCount(v1Portions)).toBe(1);
    });

    it('[DASHBOARD-CANONICAL-METRICS] Computes canonical dashboard metrics with vehicle deduplication', () => {
      // 1. Active In-Plant:
      const activeInPlantLogs = testLogs.filter((l) => {
        const s = String(l.status).toUpperCase();
        return s !== 'DISPATCHED' && s !== 'SCHEDULED' && s !== 'DRAFT_DISPATCH' && s !== 'COMPLETED' && s !== 'CANCELLED';
      });
      // Should include Vehicle 1 (2 portions) and Vehicle 2 (1 portion) -> Exactly 2 distinct vehicles
      expect(activeInPlantLogs).toHaveLength(3); // 3 portion rows
      expect(getDistinctVehicleCount(activeInPlantLogs)).toBe(2); // 2 distinct vehicles

      // 2. QA Lab Queue:
      const qaLogs = testLogs.filter((l) => {
        const s = String(l.status).toUpperCase();
        return (
          s === 'PLANT_QA' ||
          s === 'QA_PENDING' ||
          s === 'TOKEN_ISSUED' ||
          s === 'ARRIVED' ||
          s === 'UNDER_TEST' ||
          s === 'UNDER_TESTING' ||
          s === 'SAMPLING' ||
          s === 'SAMPLING_IN_PROGRESS'
        );
      });
      // Should include Vehicle 1 (2 portions in PLANT_QA) -> Exactly 1 distinct vehicle
      expect(qaLogs).toHaveLength(2);
      expect(getDistinctVehicleCount(qaLogs)).toBe(1);

      // 3. Weighbridge Queue:
      const wbLogs = testLogs.filter((l) => {
        const s = String(l.status).toUpperCase();
        return (
          s === 'READY_FOR_GROSS' ||
          s === 'GROSS_WEIGHED' ||
          s === 'GROSS_RECORDED' ||
          s === 'READY_FOR_TARE' ||
          s === 'TARE_WEIGHED' ||
          s === 'TARE_RECORDED' ||
          s === 'FIRST WEIGHT' ||
          s === 'SECOND WEIGHT'
        );
      });
      // Should include Vehicle 2 -> Exactly 1 distinct vehicle
      expect(wbLogs).toHaveLength(1);
      expect(getDistinctVehicleCount(wbLogs)).toBe(1);

      // 4. Completed Dispatches (Today = 2026-08-22):
      const completedLogs = testLogs.filter((l) => {
        const s = String(l.status).toUpperCase();
        return (s === 'COMPLETED' || s === 'EXIT') && l.dispatch_date === '2026-08-22';
      });
      expect(completedLogs).toHaveLength(1);
      expect(getDistinctVehicleCount(completedLogs)).toBe(1);
    });

    it('[KANBAN-LANES] KANBAN_STAGES properly matches canonical workflow statuses', () => {
      const qaStage = KANBAN_STAGES.find((s) => s.title.includes('QA Lab'));
      expect(qaStage).toBeDefined();
      expect(qaStage?.canonicalStatuses).toContain('PLANT_QA');
      expect(qaStage?.canonicalStatuses).toContain('QA_PENDING');

      const wbStage = KANBAN_STAGES.find((s) => s.title.includes('Weighbridge'));
      expect(wbStage).toBeDefined();
      expect(wbStage?.canonicalStatuses).toContain('READY_FOR_GROSS');
      expect(wbStage?.canonicalStatuses).toContain('READY_FOR_TARE');
    });
  });

  describe('3. Production Ready-For-Unloading Aggregation Rules', () => {
    function computeAcceptedDispatchTotal(
      acceptedPortions: Array<{ dispatch_quantity_value: number | null | undefined; dispatch_quantity_unit: string | null | undefined }>
    ) {
      let totalAcceptedDispatchValue: number | null = null;
      let totalAcceptedDispatchUnit: string | null = null;

      if (acceptedPortions.length > 0) {
        let allValid = true;
        let runningSum = 0;
        let singleUnit: string | null = null;
        const acceptedUnits = new Set<string>();

        for (const p of acceptedPortions) {
          const val = p.dispatch_quantity_value !== null && p.dispatch_quantity_value !== undefined ? Number(p.dispatch_quantity_value) : null;
          const unit = typeof p.dispatch_quantity_unit === 'string' ? p.dispatch_quantity_unit.trim().toUpperCase() : null;

          if (unit) acceptedUnits.add(unit);

          if (val === null || isNaN(val) || !isFinite(val) || val <= 0) {
            allValid = false;
          }
          if (unit !== 'KG' && unit !== 'LITER') {
            allValid = false;
          }
          if (singleUnit === null) {
            singleUnit = unit;
          } else if (singleUnit !== unit) {
            allValid = false;
          }

          if (val !== null && !isNaN(val)) {
            runningSum += val;
          }
        }

        if (allValid && singleUnit !== null) {
          totalAcceptedDispatchValue = runningSum;
          totalAcceptedDispatchUnit = singleUnit;
        } else {
          totalAcceptedDispatchValue = null;
          totalAcceptedDispatchUnit = acceptedUnits.size > 1 ? 'MIXED' : null;
        }
      }

      return { totalAcceptedDispatchValue, totalAcceptedDispatchUnit };
    }

    it('8000 KG + 5000 KG => 13000 KG', () => {
      const res = computeAcceptedDispatchTotal([
        { dispatch_quantity_value: 8000, dispatch_quantity_unit: 'KG' },
        { dispatch_quantity_value: 5000, dispatch_quantity_unit: 'KG' },
      ]);
      expect(res.totalAcceptedDispatchValue).toBe(13000);
      expect(res.totalAcceptedDispatchUnit).toBe('KG');
    });

    it('8000 LITER + 5000 LITER => 13000 LITER', () => {
      const res = computeAcceptedDispatchTotal([
        { dispatch_quantity_value: 8000, dispatch_quantity_unit: 'LITER' },
        { dispatch_quantity_value: 5000, dispatch_quantity_unit: 'LITER' },
      ]);
      expect(res.totalAcceptedDispatchValue).toBe(13000);
      expect(res.totalAcceptedDispatchUnit).toBe('LITER');
    });

    it('8000 KG + NULL KG => not summable (null)', () => {
      const res = computeAcceptedDispatchTotal([
        { dispatch_quantity_value: 8000, dispatch_quantity_unit: 'KG' },
        { dispatch_quantity_value: null, dispatch_quantity_unit: 'KG' },
      ]);
      expect(res.totalAcceptedDispatchValue).toBeNull();
      expect(res.totalAcceptedDispatchUnit).toBeNull();
    });

    it('8000 KG + 5000 with NULL unit => not summable (null)', () => {
      const res = computeAcceptedDispatchTotal([
        { dispatch_quantity_value: 8000, dispatch_quantity_unit: 'KG' },
        { dispatch_quantity_value: 5000, dispatch_quantity_unit: null },
      ]);
      expect(res.totalAcceptedDispatchValue).toBeNull();
      expect(res.totalAcceptedDispatchUnit).toBeNull();
    });

    it('8000 KG + 5000 LITER => not summable (MIXED unit)', () => {
      const res = computeAcceptedDispatchTotal([
        { dispatch_quantity_value: 8000, dispatch_quantity_unit: 'KG' },
        { dispatch_quantity_value: 5000, dispatch_quantity_unit: 'LITER' },
      ]);
      expect(res.totalAcceptedDispatchValue).toBeNull();
      expect(res.totalAcceptedDispatchUnit).toBe('MIXED');
    });
  });

  describe('4. Silo Inventory Safety & Removal of 1.0265 Fixed Fallback', () => {
    it('[NO-1.0265-FALLBACK] Proves fixed 1.0265 density fallback is removed from production services', () => {
      const siloServiceFile = fs.readFileSync(
        path.join(process.cwd(), 'src/backend/services/siloInventoryService.ts'),
        'utf8'
      );
      expect(siloServiceFile).not.toContain('/ 1.0265');
      expect(siloServiceFile).not.toContain('1.0265');

      const siloHistoryFile = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/production/silo-issue/history/route.ts'),
        'utf8'
      );
      expect(siloHistoryFile).not.toContain('1.0265');
    });
  });

  describe('5. Synthetic Seed Authoritative Final Receipt Consistency', () => {
    it('[SEED-RECEIPT-CONSISTENCY] Computes final receipt using actual authoritative Plant QA facts', () => {
      // 1-portion vehicle with Net 8,000 kg and Plant LR 28.0 (Density = 1.02796)
      const portion: VehicleCalculationPortion = {
        portionId: '1',
        portionNumber: 1,
        plantDecision: 'ACCEPTED',
        plantLabResults: [
          { testCode: 'LT-000027', testName: 'Lactometer Reading', numericValue: 28.0, performanceStatus: 'PERFORMED' },
          { testCode: 'LT-000026', testName: 'Fat', numericValue: 4.0, performanceStatus: 'PERFORMED' },
        ],
      };

      const calcResult = calculateVehicleReceivedQuantity({
        grossWeightKg: 22500,
        secondWeightKg: 14500,
        portions: [portion],
      });

      expect(calcResult.isCalculable).toBe(true);
      if (calcResult.isCalculable) {
        expect(calcResult.netWeightKg).toBe(8000);
        expect(calcResult.finalPhysicalLiters).toBeDefined();
        expect(Math.round(calcResult.finalPhysicalLiters)).toBe(7782);
      }
    });
  });
});
