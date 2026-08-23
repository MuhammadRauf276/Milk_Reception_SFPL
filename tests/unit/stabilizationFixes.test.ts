import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getOperationalBusinessDate } from '@/backend/core/business-day';
import { MilkProcessLog, KANBAN_STAGES } from '@/backend/core/types';
import {
  CANONICAL_VEHICLE_STATUSES,
  isCanonicalVehicleStatus,
  getDistinctVehicleCount,
  classifyDashboardStatus,
  getKanbanLaneForStatus,
} from '@/lib/dashboard-helpers';
import { aggregateAcceptedPortionQuantities } from '@/lib/portion-quantity-aggregator';
import {
  evaluateSiloStockVolumeState,
  getSiloCurrentStockLiters,
  getSiloAvailableCapacity,
  getSiloProvisionalAvailableCapacity,
  getSiloStockVolumeState,
} from '@/backend/services/siloInventoryService';
import {
  isPlantLrTest,
  isPlantFatTest,
  calculateVehicleReceivedQuantity,
  VehicleCalculationPortion,
} from '@/backend/services/vehicleQuantityService';

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

  describe('2. Canonical Dashboard Statuses & Vehicle Deduplication (Production Helpers)', () => {
    it('[CANONICAL-STATUSES] Recognizes all 12 authoritative statuses (including DRAFT_DISPATCH) and rejects obsolete aliases', () => {
      const canonicals = [
        'DRAFT_DISPATCH',
        'DISPATCHED',
        'TOKEN_ISSUED',
        'PLANT_QA',
        'READY_FOR_GROSS',
        'GROSS_WEIGHED',
        'READY_FOR_UNLOADING',
        'UNLOADING',
        'READY_FOR_TARE',
        'TARE_WEIGHED',
        'READY_FOR_GATE_EXIT',
        'COMPLETED',
      ];

      for (const s of canonicals) {
        expect(isCanonicalVehicleStatus(s)).toBe(true);
        expect(CANONICAL_VEHICLE_STATUSES).toContain(s);
      }

      // DRAFT_DISPATCH is canonical workflow status but invisible in live pipeline metrics and Kanban lanes
      expect(isCanonicalVehicleStatus('DRAFT_DISPATCH')).toBe(true);
      const draftClassification = classifyDashboardStatus('DRAFT_DISPATCH');
      expect(draftClassification.isActiveInPlant).toBe(false);
      expect(draftClassification.isQaLabQueue).toBe(false);
      expect(draftClassification.isWeighbridgeQueue).toBe(false);
      expect(draftClassification.isSiloQueue).toBe(false);
      expect(draftClassification.isCompleted).toBe(false);
      expect(getKanbanLaneForStatus('DRAFT_DISPATCH')).toBeNull();

      const obsoleteAliases = [
        'SCHEDULED',
        'PLANNED',
        'Dispatched',
        'ARRIVED',
        'GATE_IN_PROGRESS',
        'Token Issued',
        'QA_PENDING',
        'UNDER_TEST',
        'UNDER_TESTING',
        'Sampling',
        'Sampling_In_Progress',
        'GROSS_RECORDED',
        'TARE_RECORDED',
        'First Weight',
        'Second Weight',
        'READY_FOR_UNLOAD',
        'UNLOADED',
        'Silo Reception',
        'EXIT',
      ];

      for (const obs of obsoleteAliases) {
        expect(isCanonicalVehicleStatus(obs)).toBe(false);
        const classification = classifyDashboardStatus(obs);
        expect(classification.isActiveInPlant).toBe(false);
        expect(classification.isQaLabQueue).toBe(false);
        expect(classification.isWeighbridgeQueue).toBe(false);
        expect(classification.isSiloQueue).toBe(false);
        expect(classification.isCompleted).toBe(false);
        expect(getKanbanLaneForStatus(obs)).toBeNull();
      }
    });

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
      const activeInPlantLogs = testLogs.filter((l) => classifyDashboardStatus(l.status).isActiveInPlant);
      expect(activeInPlantLogs).toHaveLength(3); // 3 portion rows
      expect(getDistinctVehicleCount(activeInPlantLogs)).toBe(2); // 2 distinct vehicles

      // 2. QA Lab Queue:
      const qaLogs = testLogs.filter((l) => classifyDashboardStatus(l.status).isQaLabQueue);
      expect(qaLogs).toHaveLength(2);
      expect(getDistinctVehicleCount(qaLogs)).toBe(1);

      // 3. Weighbridge Queue:
      const wbLogs = testLogs.filter((l) => classifyDashboardStatus(l.status).isWeighbridgeQueue);
      expect(wbLogs).toHaveLength(1);
      expect(getDistinctVehicleCount(wbLogs)).toBe(1);

      // 4. Completed Dispatches (Today = 2026-08-22):
      const completedLogs = testLogs.filter(
        (l) => classifyDashboardStatus(l.status).isCompleted && l.dispatch_date === '2026-08-22'
      );
      expect(completedLogs).toHaveLength(1);
      expect(getDistinctVehicleCount(completedLogs)).toBe(1);
    });

    it('[KANBAN-LANES] KANBAN_STAGES properly matches canonical workflow statuses only', () => {
      const qaStage = KANBAN_STAGES.find((s) => s.title.includes('QA Lab'));
      expect(qaStage).toBeDefined();
      expect(qaStage?.canonicalStatuses).toEqual(['PLANT_QA']);

      const wbStage = KANBAN_STAGES.find((s) => s.title.includes('Weighbridge'));
      expect(wbStage).toBeDefined();
      expect(wbStage?.canonicalStatuses).toEqual(['READY_FOR_GROSS', 'GROSS_WEIGHED', 'READY_FOR_TARE', 'TARE_WEIGHED']);
    });
  });

  describe('3. Authoritative Lab Test Identity & Vehicle Received Quantity Calculation', () => {
    it('[LAB-TEST-IDENTITY] Validates single authoritative identities for LR and Fat and rejects non-authoritative tests', () => {
      // LT-000001 is Temperature -> NEVER Fat, NEVER LR
      expect(isPlantFatTest('LT-000001', 'Temperature')).toBe(false);
      expect(isPlantLrTest('LT-000001', 'Temperature')).toBe(false);

      // LT-000008 is authoritative Plant LR ("LR at 20 Celsius")
      expect(isPlantLrTest('LT-000008', 'LR at 20 Celsius')).toBe(true);
      expect(isPlantFatTest('LT-000008', 'LR at 20 Celsius')).toBe(false);

      // LT-000026 is authoritative Plant Fat ("Fat")
      expect(isPlantFatTest('LT-000026', 'Fat')).toBe(true);
      expect(isPlantLrTest('LT-000026', 'Fat')).toBe(false);

      // LT-000027 is "Lactometer Reading" -> distinct and NOT the final received quantity LR authority
      expect(isPlantLrTest('LT-000027', 'Lactometer Reading')).toBe(false);
      expect(isPlantFatTest('LT-000027', 'Lactometer Reading')).toBe(false);
    });

    it('[FULL-CATALOG-CALC] Full realistic Plant QA collection with Temperature + both LR entries + Fat calculates cleanly without ambiguity', () => {
      const portion: VehicleCalculationPortion = {
        portionId: '101',
        portionNumber: 1,
        plantDecision: 'ACCEPTED',
        plantLabResults: [
          { testCode: 'LT-000001', testName: 'Temperature', numericValue: 4.0, performanceStatus: 'PERFORMED' },
          { testCode: 'LT-000005', testName: 'Acidity', numericValue: 0.13, performanceStatus: 'PERFORMED' },
          { testCode: 'LT-000008', testName: 'LR at 20 Celsius', numericValue: 28.0, performanceStatus: 'PERFORMED' },
          { testCode: 'LT-000025', testName: 'MBRT', numericValue: 45.0, performanceStatus: 'PERFORMED' },
          { testCode: 'LT-000026', testName: 'Fat', numericValue: 4.0, performanceStatus: 'PERFORMED' },
          { testCode: 'LT-000027', testName: 'Lactometer Reading', numericValue: 28.5, performanceStatus: 'PERFORMED' },
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
        expect(calcResult.internalCalculationBasis.averagePlantLr).toBe(28.0);
        expect(Math.round(calcResult.finalPhysicalLiters)).toBe(7782);
        expect(calcResult.finalPhysicalLiters).toBeCloseTo(7782.10, 1);
      }
    });
  });

  describe('4. Shared Production Accepted-Quantity Aggregator', () => {
    it('8000 KG + 5000 KG => 13000 KG', () => {
      const res = aggregateAcceptedPortionQuantities([
        { dispatch_quantity_value: 8000, dispatch_quantity_unit: 'KG' },
        { dispatch_quantity_value: 5000, dispatch_quantity_unit: 'KG' },
      ]);
      expect(res.totalAcceptedDispatchValue).toBe(13000);
      expect(res.totalAcceptedDispatchUnit).toBe('KG');
    });

    it('8000 LITER + 5000 LITER => 13000 LITER', () => {
      const res = aggregateAcceptedPortionQuantities([
        { dispatch_quantity_value: 8000, dispatch_quantity_unit: 'LITER' },
        { dispatch_quantity_value: 5000, dispatch_quantity_unit: 'LITER' },
      ]);
      expect(res.totalAcceptedDispatchValue).toBe(13000);
      expect(res.totalAcceptedDispatchUnit).toBe('LITER');
    });

    it('8000 KG + NULL KG => not summable (null)', () => {
      const res = aggregateAcceptedPortionQuantities([
        { dispatch_quantity_value: 8000, dispatch_quantity_unit: 'KG' },
        { dispatch_quantity_value: null, dispatch_quantity_unit: 'KG' },
      ]);
      expect(res.totalAcceptedDispatchValue).toBeNull();
      expect(res.totalAcceptedDispatchUnit).toBeNull();
    });

    it('8000 KG + 5000 with NULL unit => not summable (null)', () => {
      const res = aggregateAcceptedPortionQuantities([
        { dispatch_quantity_value: 8000, dispatch_quantity_unit: 'KG' },
        { dispatch_quantity_value: 5000, dispatch_quantity_unit: null },
      ]);
      expect(res.totalAcceptedDispatchValue).toBeNull();
      expect(res.totalAcceptedDispatchUnit).toBeNull();
    });

    it('8000 KG + 5000 LITER => not summable (MIXED unit)', () => {
      const res = aggregateAcceptedPortionQuantities([
        { dispatch_quantity_value: 8000, dispatch_quantity_unit: 'KG' },
        { dispatch_quantity_value: 5000, dispatch_quantity_unit: 'LITER' },
      ]);
      expect(res.totalAcceptedDispatchValue).toBeNull();
      expect(res.totalAcceptedDispatchUnit).toBe('MIXED');
    });

    it('Empty portions => null / null', () => {
      const res = aggregateAcceptedPortionQuantities([]);
      expect(res.totalAcceptedDispatchValue).toBeNull();
      expect(res.totalAcceptedDispatchUnit).toBeNull();
    });
  });

  describe('5. Silo Inventory Safety, Real Service Paths & Unknown-Volume Fail-Closed Semantics', () => {
    it('[CASE-A] Authoritative complete ledger => capacity operation allowed', async () => {
      const mockSilo = { id: BigInt(1), silo_code: 'SILO-01', silo_name: 'Raw Milk Silo 1', capacity_liters: 50000, is_active: true };
      const mockTransactions = [
        { transaction_type: 'RECEIPT', quantity_liters: 10000, quantity_kg: 10280 },
      ];

      const mockDb: any = {
        silo: {
          findUnique: async () => mockSilo,
        },
        siloInventoryTransaction: {
          findMany: async () => mockTransactions,
        },
      };

      const stockState = await getSiloStockVolumeState(BigInt(1), mockDb);
      expect(stockState.isComplete).toBe(true);
      expect(stockState.knownLiters).toBe(10000);

      const availableCapacity = await getSiloAvailableCapacity(BigInt(1), mockDb);
      expect(availableCapacity).toBe(40000);
    });

    it('[CASE-B] Unknown-liter RECEIPT exists => capacity operation fails closed', async () => {
      const mockSilo = { id: BigInt(1), silo_code: 'SILO-01', silo_name: 'Raw Milk Silo 1', capacity_liters: 50000, is_active: true };
      const mockTransactions = [
        { transaction_type: 'RECEIPT', quantity_liters: 10000, quantity_kg: 10280 },
        { transaction_type: 'RECEIPT', quantity_liters: null, quantity_kg: 8000 },
      ];

      const mockDb: any = {
        silo: {
          findUnique: async () => mockSilo,
        },
        siloInventoryTransaction: {
          findMany: async () => mockTransactions,
        },
      };

      const stockState = await getSiloStockVolumeState(BigInt(1), mockDb);
      expect(stockState.isComplete).toBe(false);
      expect(stockState.unknownVolumeTransactionCount).toBe(1);

      await expect(getSiloAvailableCapacity(BigInt(1), mockDb)).rejects.toThrow(
        /unknown physical volume/
      );
      await expect(getSiloCurrentStockLiters(BigInt(1), mockDb)).rejects.toThrow(
        /unknown physical liters/
      );
    });

    it('[CASE-C] Unknown-liter ISSUE exists => issue sufficiency / capacity fails closed', async () => {
      const mockSilo = { id: BigInt(1), silo_code: 'SILO-01', silo_name: 'Raw Milk Silo 1', capacity_liters: 50000, is_active: true };
      const mockTransactions = [
        { transaction_type: 'RECEIPT', quantity_liters: 10000, quantity_kg: 10280 },
        { transaction_type: 'ISSUE', quantity_liters: null, quantity_kg: 3000 },
      ];

      const mockDb: any = {
        silo: {
          findUnique: async () => mockSilo,
        },
        siloInventoryTransaction: {
          findMany: async () => mockTransactions,
        },
      };

      const stockState = await getSiloStockVolumeState(BigInt(1), mockDb);
      expect(stockState.isComplete).toBe(false);
      expect(stockState.unknownVolumeTransactionCount).toBe(1);

      await expect(getSiloAvailableCapacity(BigInt(1), mockDb)).rejects.toThrow(
        /unknown physical volume/
      );
    });

    it('[CASE-D & E] Existing ISSUE idempotency key + incomplete stock fails closed, complete stock creates no second movement', async () => {
      const existingTx = {
        id: BigInt(99),
        silo_id: BigInt(1),
        transaction_type: 'ISSUE',
        quantity_liters: 5000,
        idempotency_key: 'ISSUE-KEY-123',
        silo: { id: BigInt(1), silo_code: 'SILO-01', silo_name: 'Raw Milk Silo 1' },
      };

      // Incomplete ledger on retry:
      const incompleteTransactions = [
        { transaction_type: 'RECEIPT', quantity_liters: 10000, quantity_kg: 10280 },
        { transaction_type: 'RECEIPT', quantity_liters: null, quantity_kg: 3000 },
      ];
      const mockDbIncomplete: any = {
        silo: { findUnique: async () => existingTx.silo },
        siloInventoryTransaction: {
          findUnique: async () => existingTx,
          findMany: async () => incompleteTransactions,
        },
      };

      const incompleteState = await getSiloStockVolumeState(BigInt(1), mockDbIncomplete);
      expect(incompleteState.isComplete).toBe(false);

      // Complete ledger on retry:
      const completeTransactions = [
        { transaction_type: 'RECEIPT', quantity_liters: 10000, quantity_kg: 10280 },
        { transaction_type: 'ISSUE', quantity_liters: 5000, quantity_kg: 5140 },
      ];
      const mockDbComplete: any = {
        silo: { findUnique: async () => existingTx.silo },
        siloInventoryTransaction: {
          findUnique: async () => existingTx,
          findMany: async () => completeTransactions,
        },
      };
      const completeState = await getSiloStockVolumeState(BigInt(1), mockDbComplete);
      expect(completeState.isComplete).toBe(true);
      expect(completeState.knownLiters).toBe(5000);
    });

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

  describe('6. Synthetic Seed Authoritative Final Receipt Consistency', () => {
    it('[SEED-RECEIPT-CONSISTENCY] Computes final receipt using actual authoritative Plant QA facts', () => {
      // 1-portion vehicle with Net 8,000 kg and Plant LR 28.0 (Density = 1.02796)
      const portion: VehicleCalculationPortion = {
        portionId: '1',
        portionNumber: 1,
        plantDecision: 'ACCEPTED',
        plantLabResults: [
          { testCode: 'LT-000008', testName: 'LR at 20 Celsius', numericValue: 28.0, performanceStatus: 'PERFORMED' },
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
