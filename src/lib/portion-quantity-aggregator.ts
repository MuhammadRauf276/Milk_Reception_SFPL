export interface PortionQuantityInput {
  dispatch_quantity_value?: number | string | any | null;
  dispatch_quantity_unit?: string | null;
}

export interface AcceptedQuantityAggregationResult {
  totalAcceptedDispatchValue: number | null;
  totalAcceptedDispatchUnit: string | null;
}

/**
 * Shared production helper for aggregating accepted portion dispatch quantities.
 *
 * Rules:
 * - 8000 KG + 5000 KG => { totalAcceptedDispatchValue: 13000, totalAcceptedDispatchUnit: 'KG' }
 * - 8000 LITER + 5000 LITER => { totalAcceptedDispatchValue: 13000, totalAcceptedDispatchUnit: 'LITER' }
 * - 8000 KG + NULL value => { totalAcceptedDispatchValue: null, totalAcceptedDispatchUnit: null } (non-summable)
 * - 8000 KG + missing unit => { totalAcceptedDispatchValue: null, totalAcceptedDispatchUnit: null } (non-summable)
 * - 8000 KG + 5000 LITER => { totalAcceptedDispatchValue: null, totalAcceptedDispatchUnit: 'MIXED' }
 * - Empty portions => { totalAcceptedDispatchValue: null, totalAcceptedDispatchUnit: null }
 */
export function aggregateAcceptedPortionQuantities(
  portions: PortionQuantityInput[]
): AcceptedQuantityAggregationResult {
  if (!portions || portions.length === 0) {
    return { totalAcceptedDispatchValue: null, totalAcceptedDispatchUnit: null };
  }

  let allValid = true;
  let runningSum = 0;
  let singleUnit: string | null = null;
  const acceptedUnits = new Set<string>();

  for (const p of portions) {
    const rawVal =
      p.dispatch_quantity_value !== null && p.dispatch_quantity_value !== undefined
        ? Number(p.dispatch_quantity_value)
        : null;
    const unit =
      typeof p.dispatch_quantity_unit === 'string' && p.dispatch_quantity_unit.trim()
        ? p.dispatch_quantity_unit.trim().toUpperCase()
        : null;

    if (unit) acceptedUnits.add(unit);

    if (rawVal === null || isNaN(rawVal) || !isFinite(rawVal) || rawVal <= 0) {
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

    if (rawVal !== null && !isNaN(rawVal)) {
      runningSum += rawVal;
    }
  }

  if (allValid && singleUnit !== null) {
    return {
      totalAcceptedDispatchValue: runningSum,
      totalAcceptedDispatchUnit: singleUnit,
    };
  }

  return {
    totalAcceptedDispatchValue: null,
    totalAcceptedDispatchUnit: acceptedUnits.size > 1 ? 'MIXED' : null,
  };
}
