import {
  calculateVehicleReceivedQuantity,
  isPlantLrTest,
  isPlantFatTest,
  VehicleCalculationInput,
} from '../src/backend/services/vehicleQuantityService';
import {
  calculateDensity,
  calculateSNF,
  calculateTS,
  calculateRatio,
  calculatePhysicalLiters,
  calculateAt13TSLiters,
} from '../src/backend/utils/milkFormulas';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`[PASS] ${testName}${detail ? ` (${detail})` : ''}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testName}${detail ? ` (${detail})` : ''}`);
    failed++;
  }
}

function approxEqual(a: number | null | undefined, b: number, epsilon = 0.0001): boolean {
  if (a === null || a === undefined || isNaN(a)) return false;
  return Math.abs(a - b) < epsilon;
}

console.log('==================================================');
console.log('RUNNING AUTHORITATIVE VEHICLE QUANTITY ENGINE TESTS (CASES A-Q)');
console.log('==================================================\n');

// ----------------------------------------------------
// CASE A: One accepted portion
// ----------------------------------------------------
const inputCaseA: VehicleCalculationInput = {
  grossWeightKg: 25000,
  secondWeightKg: 10000,
  portions: [
    {
      portionId: 'P-01',
      portionNumber: 1,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 28.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 3.8, performanceStatus: 'PERFORMED' },
      ],
    },
  ],
};

const resA = calculateVehicleReceivedQuantity(inputCaseA);
assert(resA.isCalculable === true, 'Case A: One accepted portion is calculable');
if (resA.isCalculable) {
  assert(resA.netWeightKg === 15000, 'Case A: Net Weight = 15,000 kg', `Got ${resA.netWeightKg}`);
  assert(resA.acceptedPortionCount === 1, 'Case A: Accepted Portion Count = 1');
  assert(resA.internalCalculationBasis.averagePlantLr === 28.0, 'Case A: Average Plant LR = 28.0');
  assert(resA.internalCalculationBasis.averagePlantFat === 3.8, 'Case A: Average Plant Fat = 3.8');
  assert(approxEqual(resA.vehicleDensity, 1.028), 'Case A: Vehicle Density = 1.0280 g/mL');
  assert(approxEqual(resA.vehicleSnf, 8.556), 'Case A: Canonical SNF = 8.556% (28/4 + 0.22*3.8 + 0.72)');
  assert(approxEqual(resA.vehicleTs, 12.356), 'Case A: Canonical TS = 12.356% (3.8 + 8.556)');
  assert(approxEqual(resA.vehicleRatio, 2.2515789), 'Case A: Canonical Ratio = ~2.252 (8.556 / 3.8)');
  const expectedLitersA = 15000 / (1 + 28.0 / 1000);
  const expectedTsA = 3.8 + (28.0 / 4 + 0.22 * 3.8 + 0.72);
  const expectedAt13A = (expectedLitersA * expectedTsA) / 13;
  assert(approxEqual(resA.finalPhysicalLiters, expectedLitersA), 'Case A: Final Physical Liters = ~14,591.44 L (15000 / 1.028)');
  assert(approxEqual(resA.finalAt13TSLiters, expectedAt13A), 'Case A: Final @13 TS Liters = ~13,868.60 L');
}

// ----------------------------------------------------
// CASE B: Two accepted portions (Arithmetic Mean)
// ----------------------------------------------------
const inputCaseB: VehicleCalculationInput = {
  grossWeightKg: 22000,
  secondWeightKg: 12000,
  portions: [
    {
      portionId: 'P-01',
      portionNumber: 1,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 27.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 3.5, performanceStatus: 'PERFORMED' },
      ],
    },
    {
      portionId: 'P-02',
      portionNumber: 2,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 29.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 3.9, performanceStatus: 'PERFORMED' },
      ],
    },
  ],
};

const resB = calculateVehicleReceivedQuantity(inputCaseB);
assert(resB.isCalculable === true, 'Case B: Two accepted portions are calculable');
if (resB.isCalculable) {
  assert(resB.netWeightKg === 10000, 'Case B: Net Weight = 10,000 kg');
  assert(resB.acceptedPortionCount === 2, 'Case B: Accepted Portion Count = 2');
  assert(resB.internalCalculationBasis.averagePlantLr === 28.0, 'Case B: Arithmetic Average LR = 28.0 ((27 + 29) / 2)');
  assert(resB.internalCalculationBasis.averagePlantFat === 3.7, 'Case B: Arithmetic Average Fat = 3.7 ((3.5 + 3.9) / 2)');
  assert(approxEqual(resB.vehicleDensity, 1.028), 'Case B: Derived Density = 1.0280 g/mL');
  assert(approxEqual(resB.vehicleSnf, 8.534), 'Case B: Derived SNF = 8.534% (28/4 + 0.22*3.7 + 0.72)');
  assert(approxEqual(resB.vehicleTs, 12.234), 'Case B: Derived TS = 12.234% (3.7 + 8.534)');
  assert(approxEqual(resB.vehicleRatio, 2.306486), 'Case B: Derived Ratio = ~2.306 (8.534 / 3.7)');
  const expectedLitersB = 10000 / (1 + 28.0 / 1000);
  const expectedTsB = 3.7 + (28.0 / 4 + 0.22 * 3.7 + 0.72);
  const expectedAt13B = (expectedLitersB * expectedTsB) / 13;
  assert(approxEqual(resB.finalPhysicalLiters, expectedLitersB), 'Case B: Final Physical Liters = ~9,727.63 L');
  assert(approxEqual(resB.finalAt13TSLiters, expectedAt13B), 'Case B: Final @13 TS Liters = ~9,154.44 L');
}

// ----------------------------------------------------
// CASE C: Two accepted + one rejected (Normal Values)
// ----------------------------------------------------
const inputCaseC: VehicleCalculationInput = {
  grossWeightKg: 22000,
  secondWeightKg: 12000,
  portions: [
    ...inputCaseB.portions,
    {
      portionId: 'P-03',
      portionNumber: 3,
      plantDecision: 'REJECTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 30.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 4.2, performanceStatus: 'PERFORMED' },
      ],
    },
  ],
};

const resC = calculateVehicleReceivedQuantity(inputCaseC);
assert(resC.isCalculable === true, 'Case C: Two accepted + one rejected is calculable');
if (resC.isCalculable && resB.isCalculable) {
  assert(resC.acceptedPortionCount === 2, 'Case C: Accepted count remains 2 (Rejected excluded)');
  assert(resC.internalCalculationBasis.averagePlantLr === resB.internalCalculationBasis.averagePlantLr, 'Case C: Average LR matches Case B exactly');
  assert(resC.internalCalculationBasis.averagePlantFat === resB.internalCalculationBasis.averagePlantFat, 'Case C: Average Fat matches Case B exactly');
  assert(approxEqual(resC.finalPhysicalLiters, resB.finalPhysicalLiters), 'Case C: Final Physical Liters matches Case B exactly');
  assert(approxEqual(resC.finalAt13TSLiters, resB.finalAt13TSLiters), 'Case C: Final @13 TS Liters matches Case B exactly');
}

// ----------------------------------------------------
// CASE D: Rejected extreme-value isolation
// ----------------------------------------------------
const inputCaseD: VehicleCalculationInput = {
  grossWeightKg: 22000,
  secondWeightKg: 12000,
  portions: [
    ...inputCaseB.portions,
    {
      portionId: 'P-03',
      portionNumber: 3,
      plantDecision: 'REJECTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 100.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 20.0, performanceStatus: 'PERFORMED' },
      ],
    },
  ],
};

const resD = calculateVehicleReceivedQuantity(inputCaseD);
assert(resD.isCalculable === true, 'Case D: Rejected extreme values handled cleanly');
if (resD.isCalculable && resB.isCalculable) {
  assert(resD.internalCalculationBasis.averagePlantLr === 28.0, 'Case D: Average LR completely unaffected by extreme rejected LR (100.0)');
  assert(resD.internalCalculationBasis.averagePlantFat === 3.7, 'Case D: Average Fat completely unaffected by extreme rejected Fat (20.0)');
  assert(approxEqual(resD.finalPhysicalLiters, resB.finalPhysicalLiters), 'Case D: Final Liters identical to clean Case B');
}

// ----------------------------------------------------
// CASE E: One accepted portion missing Plant LR
// ----------------------------------------------------
const inputCaseE: VehicleCalculationInput = {
  grossWeightKg: 25000,
  secondWeightKg: 10000,
  portions: [
    {
      portionId: 'P-01',
      portionNumber: 1,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000026', numericValue: 3.8, performanceStatus: 'PERFORMED' },
      ],
    },
  ],
};

const resE = calculateVehicleReceivedQuantity(inputCaseE);
assert(resE.isCalculable === false && resE.reason === 'MISSING_PLANT_LR', 'Case E: Missing Plant LR yields isCalculable=false (MISSING_PLANT_LR)');

// ----------------------------------------------------
// CASE F: One accepted portion missing Plant Fat
// ----------------------------------------------------
const inputCaseF: VehicleCalculationInput = {
  grossWeightKg: 25000,
  secondWeightKg: 10000,
  portions: [
    {
      portionId: 'P-01',
      portionNumber: 1,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 28.0, performanceStatus: 'PERFORMED' },
      ],
    },
  ],
};

const resF = calculateVehicleReceivedQuantity(inputCaseF);
assert(resF.isCalculable === false && resF.reason === 'MISSING_PLANT_FAT', 'Case F: Missing Plant Fat yields isCalculable=false (MISSING_PLANT_FAT)');

// ----------------------------------------------------
// CASE G: Accepted Plant LR NOT_PERFORMED
// ----------------------------------------------------
const inputCaseG: VehicleCalculationInput = {
  grossWeightKg: 22000,
  secondWeightKg: 12000,
  portions: [
    {
      portionId: 'P-01',
      portionNumber: 1,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 28.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 3.8, performanceStatus: 'PERFORMED' },
      ],
    },
    {
      portionId: 'P-02',
      portionNumber: 2,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: null, performanceStatus: 'NOT_PERFORMED' },
        { testCode: 'LT-000026', numericValue: 3.8, performanceStatus: 'PERFORMED' },
      ],
    },
  ],
};

const resG = calculateVehicleReceivedQuantity(inputCaseG);
assert(resG.isCalculable === false && resG.reason === 'MISSING_PLANT_LR', 'Case G: Accepted portion with NOT_PERFORMED LR blocks calculation strictly');

// ----------------------------------------------------
// CASE H: Accepted Plant Fat NOT_PERFORMED
// ----------------------------------------------------
const inputCaseH: VehicleCalculationInput = {
  grossWeightKg: 22000,
  secondWeightKg: 12000,
  portions: [
    {
      portionId: 'P-01',
      portionNumber: 1,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 28.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 3.8, performanceStatus: 'PERFORMED' },
      ],
    },
    {
      portionId: 'P-02',
      portionNumber: 2,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 28.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: null, performanceStatus: 'NOT_PERFORMED' },
      ],
    },
  ],
};

const resH = calculateVehicleReceivedQuantity(inputCaseH);
assert(resH.isCalculable === false && resH.reason === 'MISSING_PLANT_FAT', 'Case H: Accepted portion with NOT_PERFORMED Fat blocks calculation strictly');

// ----------------------------------------------------
// CASE I: Dispatch values available but Plant values missing (No Dispatch Fallback)
// ----------------------------------------------------
const inputCaseI: VehicleCalculationInput = {
  grossWeightKg: 25000,
  secondWeightKg: 10000,
  portions: [
    {
      portionId: 'P-01',
      portionNumber: 1,
      plantDecision: 'ACCEPTED',
      plantLabResults: [], // Zero Plant results (even if Dispatch results existed externally)
    },
  ],
};

const resI = calculateVehicleReceivedQuantity(inputCaseI);
assert(resI.isCalculable === false && resI.reason === 'MISSING_PLANT_LR', 'Case I: Zero Dispatch fallback; missing Plant results strictly rejected');

// ----------------------------------------------------
// CASE J: Zero accepted portions
// ----------------------------------------------------
const inputCaseJ: VehicleCalculationInput = {
  grossWeightKg: 25000,
  secondWeightKg: 10000,
  portions: [
    {
      portionId: 'P-01',
      portionNumber: 1,
      plantDecision: 'REJECTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 28.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 3.8, performanceStatus: 'PERFORMED' },
      ],
    },
  ],
};

const resJ = calculateVehicleReceivedQuantity(inputCaseJ);
assert(resJ.isCalculable === false && resJ.reason === 'NO_ACCEPTED_PORTIONS', 'Case J: Zero accepted portions yields NO_ACCEPTED_PORTIONS');

// ----------------------------------------------------
// CASE K: Second Weight equals Gross
// ----------------------------------------------------
const inputCaseK: VehicleCalculationInput = {
  grossWeightKg: 20000,
  secondWeightKg: 20000,
  portions: inputCaseA.portions,
};

const resK = calculateVehicleReceivedQuantity(inputCaseK);
assert(resK.isCalculable === false && resK.reason === 'INVALID_WEIGHT_ORDER', 'Case K: Tare equals Gross yields INVALID_WEIGHT_ORDER');

// ----------------------------------------------------
// CASE L: Second Weight greater than Gross
// ----------------------------------------------------
const inputCaseL: VehicleCalculationInput = {
  grossWeightKg: 20000,
  secondWeightKg: 22000,
  portions: inputCaseA.portions,
};

const resL = calculateVehicleReceivedQuantity(inputCaseL);
assert(resL.isCalculable === false && resL.reason === 'INVALID_WEIGHT_ORDER', 'Case L: Tare greater than Gross yields INVALID_WEIGHT_ORDER');

// ----------------------------------------------------
// CASE M: Negative/non-finite weights
// ----------------------------------------------------
const inputCaseM1: VehicleCalculationInput = {
  grossWeightKg: -500,
  secondWeightKg: 10000,
  portions: inputCaseA.portions,
};
const resM1 = calculateVehicleReceivedQuantity(inputCaseM1);
assert(resM1.isCalculable === false && resM1.reason === 'MISSING_GROSS_WEIGHT', 'Case M1: Negative Gross rejected');

const inputCaseM2: VehicleCalculationInput = {
  grossWeightKg: NaN,
  secondWeightKg: 10000,
  portions: inputCaseA.portions,
};
const resM2 = calculateVehicleReceivedQuantity(inputCaseM2);
assert(resM2.isCalculable === false && resM2.reason === 'MISSING_GROSS_WEIGHT', 'Case M2: NaN Gross rejected');

const inputCaseM3: VehicleCalculationInput = {
  grossWeightKg: 25000,
  secondWeightKg: -200,
  portions: inputCaseA.portions,
};
const resM3 = calculateVehicleReceivedQuantity(inputCaseM3);
assert(resM3.isCalculable === false && resM3.reason === 'MISSING_SECOND_WEIGHT', 'Case M3: Negative Tare rejected');

// ----------------------------------------------------
// CASE N: Invalid LR/Fat numeric data
// ----------------------------------------------------
const inputCaseN1: VehicleCalculationInput = {
  grossWeightKg: 25000,
  secondWeightKg: 10000,
  portions: [
    {
      portionId: 'P-01',
      portionNumber: 1,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: -5, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 3.8, performanceStatus: 'PERFORMED' },
      ],
    },
  ],
};
const resN1 = calculateVehicleReceivedQuantity(inputCaseN1);
assert(resN1.isCalculable === false && resN1.reason === 'INVALID_PLANT_LR', 'Case N1: Negative LR rejected (INVALID_PLANT_LR)');

const inputCaseN2: VehicleCalculationInput = {
  grossWeightKg: 25000,
  secondWeightKg: 10000,
  portions: [
    {
      portionId: 'P-01',
      portionNumber: 1,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 28.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: -1, performanceStatus: 'PERFORMED' },
      ],
    },
  ],
};
const resN2 = calculateVehicleReceivedQuantity(inputCaseN2);
assert(resN2.isCalculable === false && resN2.reason === 'INVALID_PLANT_FAT', 'Case N2: Negative Fat rejected (INVALID_PLANT_FAT)');

// ----------------------------------------------------
// CASE O: Derived fields not averaged (Arithmetic Derivation Contract)
// ----------------------------------------------------
// Test with values where derived formula is strictly applied to averaged source inputs
const inputCaseO: VehicleCalculationInput = {
  grossWeightKg: 30000,
  secondWeightKg: 10000,
  portions: [
    {
      portionId: 'P-01',
      portionNumber: 1,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 26.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 3.0, performanceStatus: 'PERFORMED' },
      ],
    },
    {
      portionId: 'P-02',
      portionNumber: 2,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 30.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 4.6, performanceStatus: 'PERFORMED' },
      ],
    },
  ],
};

const resO = calculateVehicleReceivedQuantity(inputCaseO);
assert(resO.isCalculable === true, 'Case O: Non-linear portion test calculable');
if (resO.isCalculable) {
  // Avg LR = 28.0, Avg Fat = 3.8
  // Expected Density = 1 + 28.0/1000 = 1.028
  // Expected SNF = 28/4 + 0.22*3.8 + 0.72 = 8.556
  // Expected TS = 3.8 + 8.556 = 12.356
  // Expected Physical Liters = 20000 / 1.028 = 19455.2529...
  // Expected @13TS = 19455.2529... * 12.356 / 13 = 18491.444...
  assert(resO.internalCalculationBasis.averagePlantLr === 28.0, 'Case O: Avg LR = 28.0');
  assert(resO.internalCalculationBasis.averagePlantFat === 3.8, 'Case O: Avg Fat = 3.8');
  assert(approxEqual(resO.vehicleDensity, 1.028), 'Case O: Density derived from Avg LR (1.028)');
  assert(approxEqual(resO.vehicleSnf, 8.556), 'Case O: SNF derived from Avg LR + Avg Fat (8.556%)');
  const expectedLitersO = 20000 / (1 + 28.0 / 1000);
  const expectedTsO = 3.8 + (28.0 / 4 + 0.22 * 3.8 + 0.72);
  const expectedAt13O = (expectedLitersO * expectedTsO) / 13;
  assert(approxEqual(resO.finalPhysicalLiters, expectedLitersO), 'Case O: Physical Liters derived from Net KG / derived Density');
  assert(approxEqual(resO.finalAt13TSLiters, expectedAt13O), 'Case O: @13TS derived from final liters * derived TS / 13');
}

// ----------------------------------------------------
// CASE P: Calculation purity
// ----------------------------------------------------
const resP = calculateVehicleReceivedQuantity(inputCaseA);
assert(typeof resP === 'object' && resP !== null, 'Case P1: Returns plain object synchronously');
assert(!('then' in resP), 'Case P2: Pure synchronous function (no async/promise overhead)');

// ----------------------------------------------------
// CASE Q: Canonical formula test protection
// ----------------------------------------------------
// Verifies that SNF = LR/4 + 0.22*Fat + 0.72 is used (and NOT obsolete LR/4 + 0.2*Fat + 0.36)
const canonicalSnf = calculateSNF(28.0, 3.8);
const obsoleteSnf = 28.0 / 4 + 0.2 * 3.8 + 0.36; // 7 + 0.76 + 0.36 = 8.12
assert(approxEqual(canonicalSnf, 8.556), 'Case Q1: Canonical formula yields 8.556% for LR=28, Fat=3.8', `Got ${canonicalSnf}`);
assert(!approxEqual(canonicalSnf, obsoleteSnf), 'Case Q2: Canonical formula is distinct from obsolete legacy formula (8.556 vs 8.120)');
if (resA.isCalculable) {
  assert(approxEqual(resA.vehicleSnf, canonicalSnf), 'Case Q3: Service SNF strictly matches canonical formula');
}

// ----------------------------------------------------
// CHUNK 3A: AMBIGUITY GUARD TEST CASES (R1 - R7)
// ----------------------------------------------------

// Case R1: Duplicate performed LR in same accepted portion
const inputCaseR1: VehicleCalculationInput = {
  grossWeightKg: 25000,
  secondWeightKg: 10000,
  portions: [
    {
      portionId: 'P-01',
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
const resR1 = calculateVehicleReceivedQuantity(inputCaseR1);
assert(resR1.isCalculable === false, 'Case R1: Duplicate performed LR in same portion is incalculable');
if (!resR1.isCalculable) {
  assert(resR1.reason === 'AMBIGUOUS_PLANT_LR', 'Case R1: Reason is AMBIGUOUS_PLANT_LR');
  assert(resR1.portionNumber === 1, 'Case R1: Portion number 1 attributed');
}

// Case R2: Duplicate performed Fat in same accepted portion
const inputCaseR2: VehicleCalculationInput = {
  grossWeightKg: 25000,
  secondWeightKg: 10000,
  portions: [
    {
      portionId: 'P-01',
      portionNumber: 1,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 28.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 3.8, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 4.0, performanceStatus: 'PERFORMED' },
      ],
    },
  ],
};
const resR2 = calculateVehicleReceivedQuantity(inputCaseR2);
assert(resR2.isCalculable === false, 'Case R2: Duplicate performed Fat in same portion is incalculable');
if (!resR2.isCalculable) {
  assert(resR2.reason === 'AMBIGUOUS_PLANT_FAT', 'Case R2: Reason is AMBIGUOUS_PLANT_FAT');
  assert(resR2.portionNumber === 1, 'Case R2: Portion number 1 attributed');
}

// Case R3: One performed + one NOT_PERFORMED LR (No ambiguity)
const inputCaseR3: VehicleCalculationInput = {
  grossWeightKg: 25000,
  secondWeightKg: 10000,
  portions: [
    {
      portionId: 'P-01',
      portionNumber: 1,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 28.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000008', numericValue: null, performanceStatus: 'NOT_PERFORMED' },
        { testCode: 'LT-000026', numericValue: 3.8, performanceStatus: 'PERFORMED' },
      ],
    },
  ],
};
const resR3 = calculateVehicleReceivedQuantity(inputCaseR3);
assert(resR3.isCalculable === true, 'Case R3: 1 PERFORMED + 1 NOT_PERFORMED LR is cleanly calculable (no ambiguity)');
if (resR3.isCalculable) {
  assert(resR3.internalCalculationBasis.averagePlantLr === 28.0, 'Case R3: Unique performed LR 28.0 selected');
}

// Case R4: One performed + one NOT_PERFORMED Fat (No ambiguity)
const inputCaseR4: VehicleCalculationInput = {
  grossWeightKg: 25000,
  secondWeightKg: 10000,
  portions: [
    {
      portionId: 'P-01',
      portionNumber: 1,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 28.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 3.8, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: null, performanceStatus: 'NOT_PERFORMED' },
      ],
    },
  ],
};
const resR4 = calculateVehicleReceivedQuantity(inputCaseR4);
assert(resR4.isCalculable === true, 'Case R4: 1 PERFORMED + 1 NOT_PERFORMED Fat is cleanly calculable (no ambiguity)');
if (resR4.isCalculable) {
  assert(resR4.internalCalculationBasis.averagePlantFat === 3.8, 'Case R4: Unique performed Fat 3.8 selected');
}

// Case R5: Duplicate recognized aliases both PERFORMED (e.g. LT-000008 and LT-000027)
const inputCaseR5: VehicleCalculationInput = {
  grossWeightKg: 25000,
  secondWeightKg: 10000,
  portions: [
    {
      portionId: 'P-01',
      portionNumber: 1,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 28.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000027', numericValue: 29.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 3.8, performanceStatus: 'PERFORMED' },
      ],
    },
  ],
};
const resR5 = calculateVehicleReceivedQuantity(inputCaseR5);
assert(resR5.isCalculable === false, 'Case R5: Multiple performed LR aliases trigger ambiguity');
if (!resR5.isCalculable) {
  assert(resR5.reason === 'AMBIGUOUS_PLANT_LR', 'Case R5: Reason is AMBIGUOUS_PLANT_LR');
}

// Case R6: Different portions are NOT duplicates (P1 has 1 LR, P2 has 1 LR)
const inputCaseR6: VehicleCalculationInput = {
  grossWeightKg: 20000,
  secondWeightKg: 10000,
  portions: [
    {
      portionId: 'P-01',
      portionNumber: 1,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 27.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 3.6, performanceStatus: 'PERFORMED' },
      ],
    },
    {
      portionId: 'P-02',
      portionNumber: 2,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 29.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 4.0, performanceStatus: 'PERFORMED' },
      ],
    },
  ],
};
const resR6 = calculateVehicleReceivedQuantity(inputCaseR6);
assert(resR6.isCalculable === true, 'Case R6: Multi-portion separate single-LR results are NOT duplicates');
if (resR6.isCalculable) {
  assert(resR6.acceptedPortionCount === 2, 'Case R6: Accepted portions count = 2');
  assert(resR6.internalCalculationBasis.averagePlantLr === 28.0, 'Case R6: Avg LR = 28.0');
  assert(resR6.internalCalculationBasis.averagePlantFat === 3.8, 'Case R6: Avg Fat = 3.8');
}

// Case R7: Rejected duplicate rows have zero effect
const inputCaseR7: VehicleCalculationInput = {
  grossWeightKg: 20000,
  secondWeightKg: 10000,
  portions: [
    {
      portionId: 'P-01',
      portionNumber: 1,
      plantDecision: 'ACCEPTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 28.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 3.8, performanceStatus: 'PERFORMED' },
      ],
    },
    {
      portionId: 'P-02',
      portionNumber: 2,
      plantDecision: 'REJECTED',
      plantLabResults: [
        { testCode: 'LT-000008', numericValue: 28.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000008', numericValue: 35.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 4.0, performanceStatus: 'PERFORMED' },
        { testCode: 'LT-000026', numericValue: 6.0, performanceStatus: 'PERFORMED' },
      ],
    },
  ],
};
const resR7 = calculateVehicleReceivedQuantity(inputCaseR7);
assert(resR7.isCalculable === true, 'Case R7: Rejected portion duplicate rows do not trigger ambiguity for accepted portion');
if (resR7.isCalculable) {
  assert(resR7.acceptedPortionCount === 1, 'Case R7: Accepted portion count = 1');
  assert(resR7.internalCalculationBasis.averagePlantLr === 28.0, 'Case R7: Avg LR = 28.0');
  assert(resR7.internalCalculationBasis.averagePlantFat === 3.8, 'Case R7: Avg Fat = 3.8');
}

console.log('\n==================================================');
console.log(`VEHICLE QUANTITY ENGINE REGRESSION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('==================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
