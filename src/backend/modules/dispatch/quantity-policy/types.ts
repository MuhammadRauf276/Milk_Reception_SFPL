export type QuantityUnit = 'KG' | 'LITER';
export type MeasurementBasis = 'ESTIMATED' | 'MEASURED';

export interface MeasurementCombination {
  unit: QuantityUnit;
  basis: MeasurementBasis;
}

export interface AllowedMeasurementConfig {
  unit: QuantityUnit;
  basis: MeasurementBasis;
}

export interface VehicleQuantityRuleConfig {
  allowedMeasurements: AllowedMeasurementConfig[];
  default: MeasurementCombination;
}

export interface PortionQuantityRuleConfig {
  allowedMeasurements: AllowedMeasurementConfig[];
  default: MeasurementCombination;
}

export interface DispatchQuantityPolicyConfig {
  version: number;
  vehicleRules: VehicleQuantityRuleConfig;
  portionRules: PortionQuantityRuleConfig;
  allowSameUnitPortionPrefill: boolean;
}

export interface DispatchQuantityPolicySnapshotDTO {
  id?: string;
  visitId: string;
  sourceId: string;
  policyVersion: number;
  policy: DispatchQuantityPolicyConfig;
  createdAt?: string;
}

export const DEFAULT_DISPATCH_QUANTITY_POLICY: DispatchQuantityPolicyConfig = {
  version: 1,
  vehicleRules: {
    allowedMeasurements: [
      { unit: 'KG', basis: 'ESTIMATED' },
      { unit: 'KG', basis: 'MEASURED' },
      { unit: 'LITER', basis: 'ESTIMATED' },
      { unit: 'LITER', basis: 'MEASURED' },
    ],
    default: {
      unit: 'KG',
      basis: 'ESTIMATED',
    },
  },
  portionRules: {
    allowedMeasurements: [
      { unit: 'KG', basis: 'ESTIMATED' },
      { unit: 'KG', basis: 'MEASURED' },
      { unit: 'LITER', basis: 'ESTIMATED' },
      { unit: 'LITER', basis: 'MEASURED' },
    ],
    default: {
      unit: 'KG',
      basis: 'ESTIMATED',
    },
  },
  allowSameUnitPortionPrefill: true,
};

export function getAllowedUnits(allowed: AllowedMeasurementConfig[]): QuantityUnit[] {
  return Array.from(new Set(allowed.map((m) => m.unit)));
}

export function getAllowedBases(allowed: AllowedMeasurementConfig[], unit?: QuantityUnit): MeasurementBasis[] {
  const filtered = unit ? allowed.filter((m) => m.unit === unit) : allowed;
  return Array.from(new Set(filtered.map((m) => m.basis)));
}

export function isCombinationAllowed(
  allowed: AllowedMeasurementConfig[],
  combo: MeasurementCombination
): boolean {
  return allowed.some(
    (m) => m.unit === combo.unit && m.basis === combo.basis
  );
}

