import { describe, it, expect } from 'vitest';
import {
  calculateDualReconciliation,
  RECONCILIATION_CALCULATION_VERSION,
} from '@/backend/services/reconciliationService';
import {
  calculateVehicleReceivedQuantity,
  isPlantLrTest,
  isPlantFatTest,
  VehicleCalculationInput,
} from '@/backend/services/vehicleQuantityService';
import {
  PLANT_CALCULATION_VERSION,
  calculateDensity,
  calculateSNF,
  calculateTS,
  calculatePhysicalLiters,
  calculateAt13TSLiters,
} from '@/backend/utils/milkFormulas';
import {
  buildVehicleVisitGroups,
  deriveVehicleReconciliationItems,
} from '@/frontend/modules/dashboard/zmcc/zmccManagerHelpers';
import { MilkProcessLog } from '@/backend/core/types';

describe('Stage 6G-F: Plant Final Dual Reconciliation & Formula Hardening', () => {
  describe('Canonical Dual Reconciliation Engine (reconciliationService.ts)', () => {
    it('correctly calculates balanced dual reconciliation (zero variance)', () => {
      const result = calculateDualReconciliation({
        sentGrossLiters: 10000.0,
        receivedGrossLiters: 10000.0,
        sentAt13tsLiters: 9500.0,
        receivedAt13tsLiters: 9500.0,
      });

      expect(result.sentGrossLiters).toBe(10000.0);
      expect(result.receivedGrossLiters).toBe(10000.0);
      expect(result.grossVarianceLiters).toBe(0.0);
      expect(result.grossVariancePercent).toBe(0.0);

      expect(result.sentAt13tsLiters).toBe(9500.0);
      expect(result.receivedAt13tsLiters).toBe(9500.0);
      expect(result.at13tsVarianceLiters).toBe(0.0);
      expect(result.at13tsVariancePercent).toBe(0.0);
      expect(result.reconciliationCalculationVersion).toBe(RECONCILIATION_CALCULATION_VERSION);
    });

    it('correctly calculates positive variance (Gain: received > sent)', () => {
      const result = calculateDualReconciliation({
        sentGrossLiters: 10000.0,
        receivedGrossLiters: 10150.0, // +150 L gain (+1.5%)
        sentAt13tsLiters: 9500.0,
        receivedAt13tsLiters: 9690.0, // +190 L gain (+2.0%)
      });

      expect(result.grossVarianceLiters).toBe(150.0);
      expect(result.grossVariancePercent).toBe(1.5);
      expect(result.at13tsVarianceLiters).toBe(190.0);
      expect(result.at13tsVariancePercent).toBe(2.0);
    });

    it('correctly calculates negative variance (Loss: received < sent)', () => {
      const result = calculateDualReconciliation({
        sentGrossLiters: 10000.0,
        receivedGrossLiters: 9850.0, // -150 L loss (-1.5%)
        sentAt13tsLiters: 9500.0,
        receivedAt13tsLiters: 9310.0, // -190 L loss (-2.0%)
      });

      expect(result.grossVarianceLiters).toBe(-150.0);
      expect(result.grossVariancePercent).toBe(-1.5);
      expect(result.at13tsVarianceLiters).toBe(-190.0);
      expect(result.at13tsVariancePercent).toBe(-2.0);
    });

    it('handles null sent gross liters gracefully (variance and percentage must be null, not 0)', () => {
      const result = calculateDualReconciliation({
        sentGrossLiters: null,
        receivedGrossLiters: 8500.0,
        sentAt13tsLiters: 8000.0,
        receivedAt13tsLiters: 8100.0,
      });

      expect(result.sentGrossLiters).toBeNull();
      expect(result.receivedGrossLiters).toBe(8500.0);
      expect(result.grossVarianceLiters).toBeNull();
      expect(result.grossVariancePercent).toBeNull();

      expect(result.sentAt13tsLiters).toBe(8000.0);
      expect(result.receivedAt13tsLiters).toBe(8100.0);
      expect(result.at13tsVarianceLiters).toBe(100.0);
      expect(result.at13tsVariancePercent).toBe(1.25);
    });

    it('handles null sent @13TS liters gracefully (variance and percentage must be null, not 0)', () => {
      const result = calculateDualReconciliation({
        sentGrossLiters: 10000.0,
        receivedGrossLiters: 9950.0,
        sentAt13tsLiters: null,
        receivedAt13tsLiters: 9400.0,
      });

      expect(result.grossVarianceLiters).toBe(-50.0);
      expect(result.grossVariancePercent).toBe(-0.5);

      expect(result.sentAt13tsLiters).toBeNull();
      expect(result.receivedAt13tsLiters).toBe(9400.0);
      expect(result.at13tsVarianceLiters).toBeNull();
      expect(result.at13tsVariancePercent).toBeNull();
    });

    it('returns null percentage when sent denominator is non-positive (<= 0) to avoid division by zero', () => {
      const zeroSent = calculateDualReconciliation({
        sentGrossLiters: 0,
        receivedGrossLiters: 5000.0,
        sentAt13tsLiters: -10,
        receivedAt13tsLiters: 4800.0,
      });

      expect(zeroSent.grossVarianceLiters).toBe(5000.0);
      expect(zeroSent.grossVariancePercent).toBeNull(); // Denominator 0 -> null
      expect(zeroSent.at13tsVarianceLiters).toBe(4810.0);
      expect(zeroSent.at13tsVariancePercent).toBeNull(); // Denominator -10 -> null
    });

    it('throws Error when receivedGrossLiters is non-positive (<= 0) or non-finite', () => {
      expect(() =>
        calculateDualReconciliation({
          sentGrossLiters: 10000.0,
          receivedGrossLiters: 0,
          sentAt13tsLiters: 9500.0,
          receivedAt13tsLiters: 9500.0,
        })
      ).toThrow('Authoritative received Gross Liters must be a positive finite number');

      expect(() =>
        calculateDualReconciliation({
          sentGrossLiters: 10000.0,
          receivedGrossLiters: -100,
          sentAt13tsLiters: 9500.0,
          receivedAt13tsLiters: 9500.0,
        })
      ).toThrow('Authoritative received Gross Liters must be a positive finite number');

      expect(() =>
        calculateDualReconciliation({
          sentGrossLiters: 10000.0,
          receivedGrossLiters: NaN,
          sentAt13tsLiters: 9500.0,
          receivedAt13tsLiters: 9500.0,
        })
      ).toThrow('Authoritative received Gross Liters must be a positive finite number');
    });

    it('throws Error when receivedAt13tsLiters is non-positive (<= 0) or non-finite', () => {
      expect(() =>
        calculateDualReconciliation({
          sentGrossLiters: 10000.0,
          receivedGrossLiters: 10000.0,
          sentAt13tsLiters: 9500.0,
          receivedAt13tsLiters: 0,
        })
      ).toThrow('Authoritative received @13TS Liters must be a positive finite number');

      expect(() =>
        calculateDualReconciliation({
          sentGrossLiters: 10000.0,
          receivedGrossLiters: 10000.0,
          sentAt13tsLiters: 9500.0,
          receivedAt13tsLiters: -50,
        })
      ).toThrow('Authoritative received @13TS Liters must be a positive finite number');

      expect(() =>
        calculateDualReconciliation({
          sentGrossLiters: 10000.0,
          receivedGrossLiters: 10000.0,
          sentAt13tsLiters: 9500.0,
          receivedAt13tsLiters: Infinity,
        })
      ).toThrow('Authoritative received @13TS Liters must be a positive finite number');
    });
  });

  describe('Authoritative Lab Test Identity Rules (isPlantLrTest, isPlantFatTest)', () => {
    it('correctly validates authoritative Plant LR test code (LT-000008)', () => {
      expect(isPlantLrTest('LT-000008')).toBe(true);
      expect(isPlantLrTest('  lt-000008  ')).toBe(true);
      expect(isPlantLrTest('LT-000027')).toBe(false); // Distinct test, not LR authority
      expect(isPlantLrTest('LT-000026')).toBe(false);
      expect(isPlantLrTest(null)).toBe(false);
      expect(isPlantLrTest(undefined)).toBe(false);
      expect(isPlantLrTest('')).toBe(false);
    });

    it('correctly validates authoritative Plant Fat test code (LT-000026)', () => {
      expect(isPlantFatTest('LT-000026')).toBe(true);
      expect(isPlantFatTest('  lt-000026  ')).toBe(true);
      expect(isPlantFatTest('LT-000001')).toBe(false);
      expect(isPlantFatTest('LT-000027')).toBe(false);
      expect(isPlantFatTest(null)).toBe(false);
      expect(isPlantFatTest(undefined)).toBe(false);
      expect(isPlantFatTest('')).toBe(false);
    });
  });

  describe('Formula Hardening & Mathematical Validity (vehicleQuantityService.ts)', () => {
    it('does not reject finite observed lab values on arbitrary biological thresholds (QA evaluation is separate)', () => {
      // LR = 14.5 and Fat = 16.0 (finite numbers that an arbitrary threshold would reject)
      const input: VehicleCalculationInput = {
        grossWeightKg: 25000,
        secondWeightKg: 15000, // Net = 10,000 kg
        portions: [
          {
            portionNumber: 1,
            plantDecision: 'ACCEPTED',
            plantLabResults: [
              { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: 14.5, performanceStatus: 'PERFORMED' },
              { testCode: 'LT-000026', testName: 'Fat %', numericValue: 16.0, performanceStatus: 'PERFORMED' },
            ],
          },
        ],
      };

      const result = calculateVehicleReceivedQuantity(input);
      // Must calculate mathematically without arbitrary threshold failure
      expect(result.isCalculable).toBe(true);
      if (result.isCalculable) {
        expect(result.plantCompositeLR).toBe(14.5);
        expect(result.plantCompositeFat).toBe(16.0);
        expect(result.vehicleDensity).toBe(1.0145);
      }
    });

    it('fails with INVALID_PLANT_LR when LR is non-positive (<= 0)', () => {
      const input: VehicleCalculationInput = {
        grossWeightKg: 25000,
        secondWeightKg: 15000,
        portions: [
          {
            portionNumber: 1,
            plantDecision: 'ACCEPTED',
            plantLabResults: [
              { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: -5.0, performanceStatus: 'PERFORMED' },
              { testCode: 'LT-000026', testName: 'Fat %', numericValue: 3.5, performanceStatus: 'PERFORMED' },
            ],
          },
        ],
      };

      const result = calculateVehicleReceivedQuantity(input);
      expect(result.isCalculable).toBe(false);
      if (!result.isCalculable) {
        expect(result.reason).toBe('INVALID_PLANT_LR');
      }
    });

    it('fails with INVALID_PLANT_FAT when Fat is negative (< 0)', () => {
      const input: VehicleCalculationInput = {
        grossWeightKg: 25000,
        secondWeightKg: 15000,
        portions: [
          {
            portionNumber: 1,
            plantDecision: 'ACCEPTED',
            plantLabResults: [
              { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: 28.0, performanceStatus: 'PERFORMED' },
              { testCode: 'LT-000026', testName: 'Fat %', numericValue: -1.0, performanceStatus: 'PERFORMED' },
            ],
          },
        ],
      };

      const result = calculateVehicleReceivedQuantity(input);
      expect(result.isCalculable).toBe(false);
      if (!result.isCalculable) {
        expect(result.reason).toBe('INVALID_PLANT_FAT');
      }
    });

    it('produces complete, unrounded quality snapshot and version 1.0 for valid input', () => {
      const input: VehicleCalculationInput = {
        grossWeightKg: 24727.63,
        secondWeightKg: 15000.0, // Net = 9727.63 kg
        portions: [
          {
            portionNumber: 1,
            plantDecision: 'ACCEPTED',
            plantLabResults: [
              { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: 28.0, performanceStatus: 'PERFORMED' },
              { testCode: 'LT-000026', testName: 'Fat %', numericValue: 3.8, performanceStatus: 'PERFORMED' },
            ],
          },
        ],
      };

      const result = calculateVehicleReceivedQuantity(input);
      expect(result.isCalculable).toBe(true);
      if (result.isCalculable) {
        expect(result.plantCompositeLR).toBe(28.0);
        expect(result.plantCompositeFat).toBe(3.8);
        expect(result.plantDensity).toBe(1.028);
        expect(result.plantSNF).toBeCloseTo(8.556, 3);
        expect(result.plantTS).toBeCloseTo(12.356, 3);
        expect(result.finalPhysicalLiters).toBeCloseTo(9462.67, 1);
        expect(result.finalAt13TSLiters).toBeCloseTo(8993.92, 1);
        expect(result.plantCalculationVersion).toBe(PLANT_CALCULATION_VERSION);
      }
    });

    it('preserves unrounded double precision across multiple accepted portions', () => {
      const input: VehicleCalculationInput = {
        grossWeightKg: 30000,
        secondWeightKg: 10000, // Net = 20,000 kg
        portions: [
          {
            portionNumber: 1,
            plantDecision: 'ACCEPTED',
            plantLabResults: [
              { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: 27.5, performanceStatus: 'PERFORMED' },
              { testCode: 'LT-000026', testName: 'Fat %', numericValue: 3.6, performanceStatus: 'PERFORMED' },
            ],
          },
          {
            portionNumber: 2,
            plantDecision: 'ACCEPTED',
            plantLabResults: [
              { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: 28.5, performanceStatus: 'PERFORMED' },
              { testCode: 'LT-000026', testName: 'Fat %', numericValue: 4.0, performanceStatus: 'PERFORMED' },
            ],
          },
        ],
      };

      const result = calculateVehicleReceivedQuantity(input);
      expect(result.isCalculable).toBe(true);
      if (result.isCalculable) {
        // Average LR = (27.5 + 28.5) / 2 = 28.0
        // Average Fat = (3.6 + 4.0) / 2 = 3.8
        expect(result.plantCompositeLR).toBe(28.0);
        expect(result.plantCompositeFat).toBe(3.8);
        expect(result.plantDensity).toBe(1.028);
        expect(result.finalPhysicalLiters).toBeCloseTo(20000 / 1.028, 2);
      }
    });
  });

  describe('ADR-005 Mathematical Consistency', () => {
    it('strictly separates physical truth from commercial truth', () => {
      const netKg = 10000;
      const lr = 28.0;
      const fat = 3.8;

      const density = calculateDensity(lr);
      expect(density).toBe(1.028);

      const physicalLiters = calculatePhysicalLiters(netKg, lr);
      expect(physicalLiters).toBeCloseTo(netKg / density, 4);

      const snf = calculateSNF(lr, fat);
      const ts = calculateTS(fat, snf);
      expect(snf).toBeCloseTo(8.556, 3);
      expect(ts).toBeCloseTo(12.356, 3);

      const at13tsLiters = calculateAt13TSLiters(physicalLiters, ts);
      expect(at13tsLiters).toBeCloseTo(physicalLiters * (12.356 / 13), 4);

      // Physical liters must NEVER equal commercial @13TS liters when TS != 13.0
      expect(physicalLiters).not.toEqual(at13tsLiters);
    });
  });

  describe('Historical Pre-6G-F Receipt Read Boundary', () => {
    it('correctly projects historical receipts with physical liters and null @13TS/reconciliation without reconstructing from mutable lab results', () => {
      const historicalLog: MilkProcessLog = {
        id: 101,
        vehicle_number: 'TEST-HIST-01',
        token_number: 'TK-101',
        portion_number: '1',
        zonal_contractor_name: 'ZMCC-01',
        business_date: '2026-09-01',
        final_receipt_exists: true,
        second_weight_timestamp: '2026-09-01T12:00:00Z',
        plant_final_gross_liters: 10000.0,
        authoritative_final_liters: 10000.0,
        plant_final_at_13ts_liters: null, // Pre-6G-F: commercial snapshot was not persisted
        reconciliation_exists: false,
        gross_variance_liters: null,
        gross_variance_percent: null,
        at_13ts_variance_liters: null,
        at_13ts_variance_percent: null,
        vehicle_dispatch_gross_liters: 10050.0,
        vehicle_dispatch_at_13ts_liters: 9500.0,
        sampling_lr: 28.0, // Mutable sampling lab results are present
        sampling_fat: 3.8,
        calculated_status: 'ACCEPTED',
        status: 'COMPLETED',
        second_weight_of_vehicle: 15000,
        first_weight_of_vehicle: 25000,
        computed_net_milk_weight: 10000,
        gate_entry_timestamp: '2026-09-01T10:00:00Z',
        created_at: '2026-09-01T08:00:00Z',
        updated_at: '2026-09-01T12:00:00Z',
      };

      const groups = buildVehicleVisitGroups([historicalLog]);
      const items = deriveVehicleReconciliationItems(groups);

      expect(items).toHaveLength(1);
      const item = items[0];

      // Physical liters must be exposed accurately
      expect(item.physicalReceivedLiters).toBe(10000.0);
      // Commercial @13TS must remain null (never retroactively recalculated from mutable lab results)
      expect(item.plant13TsLiters).toBeNull();
      // Reconciliation record is absent
      expect(item.reconciliationExists).toBe(false);
      expect(item.grossVarianceLiters).toBeNull();
      expect(item.at13TsVarianceLiters).toBeNull();
      // Explicitly flagged as historical receipt without commercial snapshot
      expect(item.isHistoricalReceiptWithoutCommercialSnapshot).toBe(true);
      expect(item.isCompletedReceipt).toBe(true);
      expect(item.isReceiptPending).toBe(false);
    });
  });
});
