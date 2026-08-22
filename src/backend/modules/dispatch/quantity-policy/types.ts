export type QuantityUnit = 'KG' | 'LITER';
export type MeasurementBasis = 'ESTIMATED' | 'MEASURED';
export type MeasurementMethod = 'MANUAL_ESTIMATE' | 'WEIGHING' | 'FLOW_METER' | 'OTHER';

export interface MeasurementCombination {
  unit: QuantityUnit;
  basis: MeasurementBasis;
  method: MeasurementMethod;
}

export interface AllowedMeasurementConfig {
  unit: QuantityUnit;
  basis: MeasurementBasis;
  methods: MeasurementMethod[];
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
      { unit: 'KG', basis: 'ESTIMATED', methods: ['MANUAL_ESTIMATE', 'OTHER'] },
      { unit: 'KG', basis: 'MEASURED', methods: ['WEIGHING', 'FLOW_METER', 'OTHER'] },
      { unit: 'LITER', basis: 'ESTIMATED', methods: ['MANUAL_ESTIMATE', 'OTHER'] },
      { unit: 'LITER', basis: 'MEASURED', methods: ['FLOW_METER', 'WEIGHING', 'OTHER'] },
    ],
    default: {
      unit: 'KG',
      basis: 'ESTIMATED',
      method: 'MANUAL_ESTIMATE',
    },
  },
  portionRules: {
    allowedMeasurements: [
      { unit: 'KG', basis: 'ESTIMATED', methods: ['MANUAL_ESTIMATE', 'OTHER'] },
      { unit: 'KG', basis: 'MEASURED', methods: ['WEIGHING', 'FLOW_METER', 'OTHER'] },
      { unit: 'LITER', basis: 'ESTIMATED', methods: ['MANUAL_ESTIMATE', 'OTHER'] },
      { unit: 'LITER', basis: 'MEASURED', methods: ['FLOW_METER', 'WEIGHING', 'OTHER'] },
    ],
    default: {
      unit: 'KG',
      basis: 'ESTIMATED',
      method: 'MANUAL_ESTIMATE',
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

export function getAllowedMethods(
  allowed: AllowedMeasurementConfig[],
  unit?: QuantityUnit,
  basis?: MeasurementBasis
): MeasurementMethod[] {
  const filtered = allowed.filter(
    (m) => (!unit || m.unit === unit) && (!basis || m.basis === basis)
  );
  const methods = new Set<MeasurementMethod>();
  for (const item of filtered) {
    for (const method of item.methods) {
      methods.add(method);
    }
  }
  return Array.from(methods);
}

export function isCombinationAllowed(
  allowed: AllowedMeasurementConfig[],
  combo: MeasurementCombination
): boolean {
  return allowed.some(
    (m) => m.unit === combo.unit && m.basis === combo.basis && m.methods.includes(combo.method)
  );
}

