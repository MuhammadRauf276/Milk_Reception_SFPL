/**
 * Centralized Calculated Test Formula Registry
 * Authoritative formulas for dairy laboratory calculations.
 * Ensures consistent computation across all testing stages (Shop, ZMCC, Dispatch, Plant QA).
 */

export interface CalculatedFormulaDef {
  formulaId: string;
  name: string;
  description: string;
  targetTestCode: string;
  dependencies: string[];
  calculate: (inputs: Record<string, number | null | undefined>) => number | null;
  displayFormula: string;
}

/**
 * Standard Dairy Canonical Formulas:
 * 1. SNF = (LR / 4) + (0.22 * Fat) + 0.72
 * 2. Ratio = SNF / Fat
 * 3. Total Solids (TS) = Fat + SNF
 */
export const CALCULATED_FORMULA_REGISTRY: Record<string, CalculatedFormulaDef> = {
  SNF_CANONICAL: {
    formulaId: 'SNF_CANONICAL',
    name: 'Solids-Not-Fat (SNF %)',
    description: 'Canonical dairy SNF formula: (LR / 4) + 0.22 * Fat + 0.72',
    targetTestCode: 'LT-000010',
    dependencies: ['LT-000008', 'LT-000009'], // LR @ 20°C, Fat %
    displayFormula: '(LR / 4) + (0.22 × Fat) + 0.72',
    calculate: (inputs) => {
      // Look up by test code or friendly key
      const lrRaw = inputs['LT-000008'] ?? inputs['LT-000027'] ?? inputs['LR'];
      const fatRaw = inputs['LT-000009'] ?? inputs['LT-000026'] ?? inputs['FAT'];

      const lr = lrRaw !== null && lrRaw !== undefined ? Number(lrRaw) : null;
      const fat = fatRaw !== null && fatRaw !== undefined ? Number(fatRaw) : null;

      if (lr === null || fat === null || isNaN(lr) || isNaN(fat) || !isFinite(lr) || !isFinite(fat) || lr <= 0 || fat <= 0) {
        return null;
      }
      const snf = (lr / 4) + (0.22 * fat) + 0.72;
      return isFinite(snf) ? Number(snf.toFixed(2)) : null;
    },
  },
  RATIO_SNF_FAT: {
    formulaId: 'RATIO_SNF_FAT',
    name: 'SNF to Fat Ratio',
    description: 'Ratio of SNF divided by Fat: SNF / Fat',
    targetTestCode: 'LT-000011',
    dependencies: ['LT-000010', 'LT-000009'], // SNF, Fat
    displayFormula: 'SNF / Fat',
    calculate: (inputs) => {
      // If SNF is not directly provided in inputs, attempt to compute SNF from LR and Fat first
      let snfRaw = inputs['LT-000010'] ?? inputs['SNF'];
      const fatRaw = inputs['LT-000009'] ?? inputs['LT-000026'] ?? inputs['FAT'];

      const fat = fatRaw !== null && fatRaw !== undefined ? Number(fatRaw) : null;
      if (fat === null || isNaN(fat) || !isFinite(fat) || fat <= 0) {
        return null;
      }

      if (snfRaw === null || snfRaw === undefined || isNaN(Number(snfRaw))) {
        snfRaw = CALCULATED_FORMULA_REGISTRY.SNF_CANONICAL.calculate(inputs);
      }

      const snf = snfRaw !== null && snfRaw !== undefined ? Number(snfRaw) : null;
      if (snf === null || isNaN(snf) || !isFinite(snf) || snf <= 0) {
        return null;
      }

      const ratio = snf / fat;
      return isFinite(ratio) ? Number(ratio.toFixed(2)) : null;
    },
  },
  TOTAL_SOLIDS: {
    formulaId: 'TOTAL_SOLIDS',
    name: 'Total Solids (TS %)',
    description: 'Total Solids in milk: Fat + SNF',
    targetTestCode: 'LT-TOTAL-SOLIDS',
    dependencies: ['LT-000009', 'LT-000010'], // Fat, SNF
    displayFormula: 'Fat + SNF',
    calculate: (inputs) => {
      const fatRaw = inputs['LT-000009'] ?? inputs['LT-000026'] ?? inputs['FAT'];
      let snfRaw = inputs['LT-000010'] ?? inputs['SNF'];

      const fat = fatRaw !== null && fatRaw !== undefined ? Number(fatRaw) : null;
      if (fat === null || isNaN(fat) || !isFinite(fat) || fat <= 0) {
        return null;
      }

      if (snfRaw === null || snfRaw === undefined || isNaN(Number(snfRaw))) {
        snfRaw = CALCULATED_FORMULA_REGISTRY.SNF_CANONICAL.calculate(inputs);
      }

      const snf = snfRaw !== null && snfRaw !== undefined ? Number(snfRaw) : null;
      if (snf === null || isNaN(snf) || !isFinite(snf) || snf <= 0) {
        return null;
      }

      const ts = fat + snf;
      return isFinite(ts) ? Number(ts.toFixed(2)) : null;
    },
  },
};

/**
 * Returns formula definition for a test code or formula ID.
 */
export function getCalculatedFormula(identifier: string): CalculatedFormulaDef | null {
  if (!identifier) return null;
  const upper = identifier.toUpperCase();
  if (CALCULATED_FORMULA_REGISTRY[upper]) return CALCULATED_FORMULA_REGISTRY[upper];
  for (const f of Object.values(CALCULATED_FORMULA_REGISTRY)) {
    if (f.targetTestCode.toUpperCase() === upper) return f;
  }
  return null;
}

/**
 * Evaluates all auto-calculated tests given current test observation inputs.
 */
export function evaluateAllCalculatedTests(
  inputs: Record<string, number | null | undefined>
): Record<string, number | null> {
  const results: Record<string, number | null> = {};
  for (const formula of Object.values(CALCULATED_FORMULA_REGISTRY)) {
    const val = formula.calculate({ ...inputs, ...results });
    results[formula.targetTestCode] = val;
    results[formula.formulaId] = val;
  }
  return results;
}

export const FORMULA_SNF_CANONICAL = CALCULATED_FORMULA_REGISTRY.SNF_CANONICAL;
export const FORMULA_TOTAL_SOLIDS = CALCULATED_FORMULA_REGISTRY.TOTAL_SOLIDS;
export const FORMULA_RATIO_SNF_FAT = CALCULATED_FORMULA_REGISTRY.RATIO_SNF_FAT;
