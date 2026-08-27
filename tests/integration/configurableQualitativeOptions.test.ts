import '../helpers/testEnv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestPrisma, disconnectTestPrisma } from '../helpers/testPrisma';
import { clearTestDatabase, seedStandardTestLabCatalog, createTestZmccSource } from '../fixtures/testFixtures';
import {
  resultOptionsArraySchema,
  createLabTestSchema,
  updateLabTestSchema,
  validatePlantQAResultOptions,
  LabTestResultOption,
} from '@/lib/validations/labTest';
import {
  evaluateLabResult,
  validateCategoricalOption,
} from '@/lib/lab-rules';
import { getOrAssignDispatchTests, getOrAssignPlantQATests } from '@/backend/services/labTestAssignmentService';

describe('Super Admin Configurable Qualitative Result Options (Vitest Integration)', () => {
  const prisma = getTestPrisma();

  beforeAll(async () => {
    await clearTestDatabase(prisma);
  });

  afterAll(async () => {
    await clearTestDatabase(prisma);
    await disconnectTestPrisma();
  });

  beforeEach(async () => {
    await clearTestDatabase(prisma);
    await seedStandardTestLabCatalog(prisma);
  });

  describe('1. Production Validation Schema (src/lib/validations/labTest.ts)', () => {
    it('validates and accepts 3-state options (PASS, NEUTRAL, FAIL) via resultOptionsArraySchema', () => {
      const validThreeState: LabTestResultOption[] = [
        { value: 'GRADE_A', label: 'Grade A (Excellent)', isPassing: true },
        { value: 'GRADE_B', label: 'Grade B (Observation)', isPassing: null },
        { value: 'GRADE_C', label: 'Grade C (Rejected)', isPassing: false },
      ];

      const parsed = resultOptionsArraySchema.safeParse(validThreeState);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.length).toBe(3);
        expect(parsed.data[0].isPassing).toBe(true);
        expect(parsed.data[1].isPassing).toBeNull();
        expect(parsed.data[2].isPassing).toBe(false);
      }
    });

    it('rejects duplicate option values case-insensitively via production schema refinement', () => {
      const duplicates = [
        { value: 'PASS', label: 'Pass', isPassing: true },
        { value: 'pass', label: 'Pass (Lower)', isPassing: false },
      ];

      const parsed = resultOptionsArraySchema.safeParse(duplicates);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message || parsed.error.message).toContain('Option values must be unique');
      }
    });

    it('rejects option list with fewer than 2 options via production schema', () => {
      const singleOption = [{ value: 'ONLY_ONE', label: 'Single', isPassing: true }];
      const parsed = resultOptionsArraySchema.safeParse(singleOption);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message || parsed.error.message).toContain('at least 2 options');
      }
    });

    it('enforces validatePlantQAResultOptions: required Plant test cannot be all-neutral', () => {
      const allNeutral: LabTestResultOption[] = [
        { value: 'OBS_1', label: 'Observation 1', isPassing: null },
        { value: 'OBS_2', label: 'Observation 2', isPassing: null },
      ];

      // Required Plant test with all-neutral options MUST fail validation
      const plantValidation = validatePlantQAResultOptions('PLANT', true, 'QUALITATIVE', allNeutral);
      expect(plantValidation.isValid).toBe(false);
      expect(plantValidation.error).toContain('at least one passing option');

      // But valid 3-state passes
      const validThreeState: LabTestResultOption[] = [
        { value: 'PASS', label: 'Pass', isPassing: true },
        { value: 'OBS', label: 'Observed', isPassing: null },
        { value: 'FAIL', label: 'Fail', isPassing: false },
      ];
      const validValidation = validatePlantQAResultOptions('PLANT', true, 'QUALITATIVE', validThreeState);
      expect(validValidation.isValid).toBe(true);
    });
  });

  describe('2. Centralized Rules Evaluation (src/lib/lab-rules.ts)', () => {
    const configuredOptions: LabTestResultOption[] = [
      { value: 'GOOD', label: 'Good Quality', isPassing: true },
      { value: 'ACCEPTABLE_OBSERVED', label: 'Acceptable / Observed', isPassing: null },
      { value: 'DEFECTIVE', label: 'Defective', isPassing: false },
    ];

    it('evaluates isPassing: true as PASS (isPassed = true, status = EVALUATED)', () => {
      const evalResult = evaluateLabResult('LT-TEST', null, 'GOOD', 'QUALITATIVE', configuredOptions);
      expect(evalResult.isPassed).toBe(true);
      expect(evalResult.status).toBe('EVALUATED');
      expect(evalResult.observedResult).toBe('GOOD');
    });

    it('evaluates isPassing: false as FAIL (isPassed = false, status = EVALUATED)', () => {
      const evalResult = evaluateLabResult('LT-TEST', null, 'DEFECTIVE', 'QUALITATIVE', configuredOptions);
      expect(evalResult.isPassed).toBe(false);
      expect(evalResult.status).toBe('EVALUATED');
      expect(evalResult.reason).toBe('Configured failing option');
    });

    it('evaluates isPassing: null as NEUTRAL (isPassed = null, status = NEUTRAL)', () => {
      const evalResult = evaluateLabResult('LT-TEST', null, 'ACCEPTABLE_OBSERVED', 'QUALITATIVE', configuredOptions);
      expect(evalResult.isPassed).toBeNull();
      expect(evalResult.status).toBe('NEUTRAL');
      expect(evalResult.observedResult).toBe('ACCEPTABLE_OBSERVED');
    });

    it('evaluates unconfigured text option as UNCONFIGURED (isPassed = false)', () => {
      const evalResult = evaluateLabResult('LT-TEST', null, 'UNKNOWN_SELECTION', 'QUALITATIVE', configuredOptions);
      expect(evalResult.isPassed).toBe(false);
      expect(evalResult.status).toBe('UNCONFIGURED');
      expect(evalResult.reason).toContain('Invalid option');
    });

    it('validates categorical option membership strictly via validateCategoricalOption', () => {
      expect(validateCategoricalOption('QUALITATIVE', 'GOOD', configuredOptions)).toBe(true);
      expect(validateCategoricalOption('QUALITATIVE', 'DEFECTIVE', configuredOptions)).toBe(true);
      expect(validateCategoricalOption('QUALITATIVE', 'ACCEPTABLE_OBSERVED', configuredOptions)).toBe(true);
      expect(validateCategoricalOption('QUALITATIVE', 'INVALID_CHOICE', configuredOptions)).toBe(false);
      expect(validateCategoricalOption('QUALITATIVE', null, configuredOptions)).toBe(false);
    });
  });

  describe('3. Database Persistence & Snapshot Immutability (milk_reception_test)', () => {
    it('persists Super Admin configured options and freezes snapshot for operational visits', async () => {
      const customOptions: LabTestResultOption[] = [
        { value: 'OPT_PASS', label: 'Clear Pass', isPassing: true },
        { value: 'OPT_NEUTRAL', label: 'Neutral Note', isPassing: null },
        { value: 'OPT_FAIL', label: 'Definite Fail', isPassing: false },
      ];

      // 1. Update master test with custom 3-state options
      await prisma.labTest.update({
        where: { testCode: 'LT-000010' },
        data: { resultOptions: customOptions as any },
      });

      // 2. Create visit and generate snapshot
      const source = await createTestZmccSource(prisma, 'ZMCC_QUAL_01');
      const visit = await prisma.vehicleVisit.create({
        data: {
          visit_number: `VV-TEST-QUAL-${Date.now()}-1`,
          vehicle_number: 'TEST-QUAL-VEH-01',
          procurement_source_id: source.id,
          current_status: 'DISPATCHED',
        },
      });

      const assignments = await getOrAssignDispatchTests(prisma, visit.id);
      const snapshottedAlcohol = assignments.find((a) => a.test_code_snapshot === 'LT-000010');
      expect(snapshottedAlcohol).toBeDefined();

      const snapOptions = snapshottedAlcohol?.result_options_snapshot as any[];
      expect(snapOptions.length).toBe(3);
      expect(snapOptions[0].value).toBe('OPT_PASS');
      expect(snapOptions[1].value).toBe('OPT_NEUTRAL');
      expect(snapOptions[2].value).toBe('OPT_FAIL');

      // 3. Mutate master test in master catalog
      await prisma.labTest.update({
        where: { testCode: 'LT-000010' },
        data: {
          resultOptions: [
            { value: 'NEW_A', label: 'New A', isPassing: true },
            { value: 'NEW_B', label: 'New B', isPassing: false },
          ] as any,
        },
      });

      // 4. In-flight visit retains frozen 3-state snapshot
      const reloadedAssignments = await getOrAssignDispatchTests(prisma, visit.id);
      const reloadedAlcohol = reloadedAssignments.find((a) => a.test_code_snapshot === 'LT-000010');
      const reloadedOptions = reloadedAlcohol?.result_options_snapshot as any[];
      expect(reloadedOptions.length).toBe(3);
      expect(reloadedOptions[1].value).toBe('OPT_NEUTRAL');
    });
  });
});
