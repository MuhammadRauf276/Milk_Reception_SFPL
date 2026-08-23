import { describe, it, expect } from 'vitest';
import {
  calculateVehicleReceivedQuantity,
  VehicleCalculationInput,
} from '@/backend/services/vehicleQuantityService';

describe('Authoritative Vehicle Quantity Engine (vehicleQuantityService.ts)', () => {
  const standardGross = 30000;
  const standardSecond = 10000; // Net = 20000 kg

  describe('Core Weight & Weighbridge Rules', () => {
    it('calculates Net Milk Received KG = Gross - Second Weight', () => {
      const input: VehicleCalculationInput = {
        grossWeightKg: 32500,
        secondWeightKg: 12500,
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
        expect(result.grossWeightKg).toBe(32500);
        expect(result.secondWeightKg).toBe(12500);
        expect(result.netWeightKg).toBe(20000);
      }
    });

    it('fails with INVALID_WEIGHT_ORDER when Second Weight >= Gross Weight', () => {
      const input: VehicleCalculationInput = {
        grossWeightKg: 15000,
        secondWeightKg: 15000,
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
      expect(result.isCalculable).toBe(false);
      if (!result.isCalculable) {
        expect(result.reason).toBe('INVALID_WEIGHT_ORDER');
      }
    });
  });

  describe('Portion Acceptance & Simple Arithmetic Quality Averaging', () => {
    it('calculates simple arithmetic average across accepted portions only (excludes REJECTED and ON_HOLD)', () => {
      const input: VehicleCalculationInput = {
        grossWeightKg: standardGross,
        secondWeightKg: standardSecond,
        portions: [
          // Accepted portion 1: LR 27.0, Fat 3.5
          {
            portionNumber: 1,
            plantDecision: 'ACCEPTED',
            plantLabResults: [
              { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: 27.0, performanceStatus: 'PERFORMED' },
              { testCode: 'LT-000026', testName: 'Fat %', numericValue: 3.5, performanceStatus: 'PERFORMED' },
            ],
          },
          // Accepted portion 2: LR 29.0, Fat 3.9
          {
            portionNumber: 2,
            plantDecision: 'ACCEPTED',
            plantLabResults: [
              { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: 29.0, performanceStatus: 'PERFORMED' },
              { testCode: 'LT-000026', testName: 'Fat %', numericValue: 3.9, performanceStatus: 'PERFORMED' },
            ],
          },
          // Rejected portion: LR 20.0, Fat 1.0 (Must be completely excluded)
          {
            portionNumber: 3,
            plantDecision: 'REJECTED',
            plantLabResults: [
              { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: 20.0, performanceStatus: 'PERFORMED' },
              { testCode: 'LT-000026', testName: 'Fat %', numericValue: 1.0, performanceStatus: 'PERFORMED' },
            ],
          },
          // On-hold portion: LR 32.0, Fat 5.0 (Must be completely excluded)
          {
            portionNumber: 4,
            plantDecision: 'ON_HOLD',
            plantLabResults: [
              { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: 32.0, performanceStatus: 'PERFORMED' },
              { testCode: 'LT-000026', testName: 'Fat %', numericValue: 5.0, performanceStatus: 'PERFORMED' },
            ],
          },
        ],
      };

      const result = calculateVehicleReceivedQuantity(input);
      expect(result.isCalculable).toBe(true);
      if (result.isCalculable) {
        expect(result.acceptedPortionCount).toBe(2);
        // Average LR: (27.0 + 29.0) / 2 = 28.0
        expect(result.internalCalculationBasis.averagePlantLr).toBeCloseTo(28.0, 4);
        // Average Fat: (3.5 + 3.9) / 2 = 3.7
        expect(result.internalCalculationBasis.averagePlantFat).toBeCloseTo(3.7, 4);
        // Density = 1 + 28.0/1000 = 1.028
        expect(result.vehicleDensity).toBeCloseTo(1.028, 4);
        // SNF = (28/4) + (0.22*3.7) + 0.72 = 7.0 + 0.814 + 0.72 = 8.534
        expect(result.vehicleSnf).toBeCloseTo(8.534, 4);
        // TS = 3.7 + 8.534 = 12.234
        expect(result.vehicleTs).toBeCloseTo(12.234, 4);
        // Ratio = 8.534 / 3.7 = ~2.3065
        expect(result.vehicleRatio).toBeCloseTo(8.534 / 3.7, 4);
        // Physical Liters = 20,000 / 1.028 = 19455.25 L
        expect(result.finalPhysicalLiters).toBeCloseTo(20000 / 1.028, 2);
        // @13 TS Liters = (19455.25 * 12.234) / 13 = 18308.89 L
        expect(result.finalAt13TSLiters).toBeCloseTo(((20000 / 1.028) * 12.234) / 13, 2);
      }
    });

    it('returns NO_ACCEPTED_PORTIONS when 0 portions are accepted', () => {
      const input: VehicleCalculationInput = {
        grossWeightKg: standardGross,
        secondWeightKg: standardSecond,
        portions: [
          {
            portionNumber: 1,
            plantDecision: 'REJECTED',
            plantLabResults: [
              { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: 28.0, performanceStatus: 'PERFORMED' },
              { testCode: 'LT-000026', testName: 'Fat %', numericValue: 3.8, performanceStatus: 'PERFORMED' },
            ],
          },
        ],
      };

      const result = calculateVehicleReceivedQuantity(input);
      expect(result.isCalculable).toBe(false);
      if (!result.isCalculable) {
        expect(result.reason).toBe('NO_ACCEPTED_PORTIONS');
      }
    });

    it('fails safely with MISSING_PLANT_LR when an accepted portion has missing LR', () => {
      const input: VehicleCalculationInput = {
        grossWeightKg: standardGross,
        secondWeightKg: standardSecond,
        portions: [
          {
            portionNumber: 1,
            plantDecision: 'ACCEPTED',
            plantLabResults: [
              // LR missing, Fat present
              { testCode: 'LT-000026', testName: 'Fat %', numericValue: 3.8, performanceStatus: 'PERFORMED' },
            ],
          },
        ],
      };

      const result = calculateVehicleReceivedQuantity(input);
      expect(result.isCalculable).toBe(false);
      if (!result.isCalculable) {
        expect(result.reason).toBe('MISSING_PLANT_LR');
      }
    });

    it('fails safely with MISSING_PLANT_FAT when an accepted portion has missing Fat', () => {
      const input: VehicleCalculationInput = {
        grossWeightKg: standardGross,
        secondWeightKg: standardSecond,
        portions: [
          {
            portionNumber: 1,
            plantDecision: 'ACCEPTED',
            plantLabResults: [
              // LR present, Fat missing
              { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: 28.0, performanceStatus: 'PERFORMED' },
            ],
          },
        ],
      };

      const result = calculateVehicleReceivedQuantity(input);
      expect(result.isCalculable).toBe(false);
      if (!result.isCalculable) {
        expect(result.reason).toBe('MISSING_PLANT_FAT');
      }
    });

    it('fails with MISSING_PLANT_LR when an accepted portion has NOT_PERFORMED LR', () => {
      const input: VehicleCalculationInput = {
        grossWeightKg: standardGross,
        secondWeightKg: standardSecond,
        portions: [
          {
            portionNumber: 1,
            plantDecision: 'ACCEPTED',
            plantLabResults: [
              { testCode: 'LT-000008', numericValue: null, performanceStatus: 'NOT_PERFORMED' },
              { testCode: 'LT-000026', numericValue: 3.8, performanceStatus: 'PERFORMED' },
            ],
          },
        ],
      };

      const result = calculateVehicleReceivedQuantity(input);
      expect(result.isCalculable).toBe(false);
      if (!result.isCalculable) {
        expect(result.reason).toBe('MISSING_PLANT_LR');
      }
    });

    it('fails with MISSING_PLANT_FAT when an accepted portion has NOT_PERFORMED Fat', () => {
      const input: VehicleCalculationInput = {
        grossWeightKg: standardGross,
        secondWeightKg: standardSecond,
        portions: [
          {
            portionNumber: 1,
            plantDecision: 'ACCEPTED',
            plantLabResults: [
              { testCode: 'LT-000008', numericValue: 28.0, performanceStatus: 'PERFORMED' },
              { testCode: 'LT-000026', numericValue: null, performanceStatus: 'NOT_PERFORMED' },
            ],
          },
        ],
      };

      const result = calculateVehicleReceivedQuantity(input);
      expect(result.isCalculable).toBe(false);
      if (!result.isCalculable) {
        expect(result.reason).toBe('MISSING_PLANT_FAT');
      }
    });

    it('strictly forbids Dispatch fallback: returns MISSING_PLANT_LR when Plant results are empty', () => {
      const input: VehicleCalculationInput = {
        grossWeightKg: standardGross,
        secondWeightKg: standardSecond,
        portions: [
          {
            portionNumber: 1,
            plantDecision: 'ACCEPTED',
            plantLabResults: [], // Zero Plant results
          },
        ],
      };

      const result = calculateVehicleReceivedQuantity(input);
      expect(result.isCalculable).toBe(false);
      if (!result.isCalculable) {
        expect(result.reason).toBe('MISSING_PLANT_LR');
      }
    });

    it('fails with AMBIGUOUS_PLANT_LR when an accepted portion has duplicate performed LR results', () => {
      const input: VehicleCalculationInput = {
        grossWeightKg: standardGross,
        secondWeightKg: standardSecond,
        portions: [
          {
            portionNumber: 1,
            plantDecision: 'ACCEPTED',
            plantLabResults: [
              { testCode: 'LT-000008', numericValue: 28.0, performanceStatus: 'PERFORMED' },
              { testCode: 'LT-000008', numericValue: 29.0, performanceStatus: 'PERFORMED' },
              { testCode: 'LT-000026', numericValue: 3.8, performanceStatus: 'PERFORMED' },
            ],
          },
        ],
      };

      const result = calculateVehicleReceivedQuantity(input);
      expect(result.isCalculable).toBe(false);
      if (!result.isCalculable) {
        expect(result.reason).toBe('AMBIGUOUS_PLANT_LR');
      }
    });

    it('fails with INVALID_PLANT_LR or INVALID_PLANT_FAT for negative numeric readings', () => {
      const negativeLrInput: VehicleCalculationInput = {
        grossWeightKg: standardGross,
        secondWeightKg: standardSecond,
        portions: [
          {
            portionNumber: 1,
            plantDecision: 'ACCEPTED',
            plantLabResults: [
              { testCode: 'LT-000008', numericValue: -5.0, performanceStatus: 'PERFORMED' },
              { testCode: 'LT-000026', numericValue: 3.8, performanceStatus: 'PERFORMED' },
            ],
          },
        ],
      };
      const lrRes = calculateVehicleReceivedQuantity(negativeLrInput);
      expect(lrRes.isCalculable).toBe(false);
      if (!lrRes.isCalculable) {
        expect(lrRes.reason).toBe('INVALID_PLANT_LR');
      }

      const negativeFatInput: VehicleCalculationInput = {
        grossWeightKg: standardGross,
        secondWeightKg: standardSecond,
        portions: [
          {
            portionNumber: 1,
            plantDecision: 'ACCEPTED',
            plantLabResults: [
              { testCode: 'LT-000008', numericValue: 28.0, performanceStatus: 'PERFORMED' },
              { testCode: 'LT-000026', numericValue: -1.0, performanceStatus: 'PERFORMED' },
            ],
          },
        ],
      };
      const fatRes = calculateVehicleReceivedQuantity(negativeFatInput);
      expect(fatRes.isCalculable).toBe(false);
      if (!fatRes.isCalculable) {
        expect(fatRes.reason).toBe('INVALID_PLANT_FAT');
      }
    });

    it('is a pure synchronous calculation returning a plain object without promise overhead', () => {
      const input: VehicleCalculationInput = {
        grossWeightKg: standardGross,
        secondWeightKg: standardSecond,
        portions: [
          {
            portionNumber: 1,
            plantDecision: 'ACCEPTED',
            plantLabResults: [
              { testCode: 'LT-000008', numericValue: 28.0, performanceStatus: 'PERFORMED' },
              { testCode: 'LT-000026', numericValue: 3.8, performanceStatus: 'PERFORMED' },
            ],
          },
        ],
      };
      const result = calculateVehicleReceivedQuantity(input);
      expect(typeof result).toBe('object');
      expect(result).not.toBeNull();
      expect('then' in result).toBe(false);
    });

    it('handles single accepted portion cleanly without ambiguity', () => {
      const input: VehicleCalculationInput = {
        grossWeightKg: standardGross,
        secondWeightKg: standardSecond,
        portions: [
          {
            portionNumber: 1,
            plantDecision: 'ACCEPTED',
            plantLabResults: [
              { testCode: 'LT-000008', testName: 'Lactometer Reading (LR)', numericValue: 28.5, performanceStatus: 'PERFORMED' },
              { testCode: 'LT-000026', testName: 'Fat %', numericValue: 3.9, performanceStatus: 'PERFORMED' },
            ],
          },
        ],
      };

      const result = calculateVehicleReceivedQuantity(input);
      expect(result.isCalculable).toBe(true);
      if (result.isCalculable) {
        expect(result.acceptedPortionCount).toBe(1);
        expect(result.internalCalculationBasis.averagePlantLr).toBe(28.5);
        expect(result.internalCalculationBasis.averagePlantFat).toBe(3.9);
      }
    });
  });
});
