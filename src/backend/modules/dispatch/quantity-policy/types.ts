export type QuantityUnit = 'KG' | 'LITER';
export type MeasurementBasis = 'ESTIMATED' | 'MEASURED';
export type MeasurementMethod = 'MANUAL_ESTIMATE' | 'WEIGHING' | 'FLOW_METER' | 'OTHER';

export interface VehicleQuantityRuleConfig {
  allowedUnits: QuantityUnit[];
  allowedBases: MeasurementBasis[];
  allowedMethods: MeasurementMethod[];
  defaultUnit: QuantityUnit;
  defaultBasis: MeasurementBasis;
  defaultMethod: MeasurementMethod;
}

export interface PortionQuantityRuleConfig {
  allowedUnits: QuantityUnit[];
  allowedBases: MeasurementBasis[];
  allowedMethods: MeasurementMethod[];
  defaultUnit: QuantityUnit;
  defaultBasis: MeasurementBasis;
  defaultMethod: MeasurementMethod;
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
    allowedUnits: ['KG', 'LITER'],
    allowedBases: ['ESTIMATED', 'MEASURED'],
    allowedMethods: ['MANUAL_ESTIMATE', 'WEIGHING', 'FLOW_METER', 'OTHER'],
    defaultUnit: 'KG',
    defaultBasis: 'ESTIMATED',
    defaultMethod: 'MANUAL_ESTIMATE',
  },
  portionRules: {
    allowedUnits: ['KG', 'LITER'],
    allowedBases: ['ESTIMATED', 'MEASURED'],
    allowedMethods: ['MANUAL_ESTIMATE', 'WEIGHING', 'FLOW_METER', 'OTHER'],
    defaultUnit: 'KG',
    defaultBasis: 'ESTIMATED',
    defaultMethod: 'MANUAL_ESTIMATE',
  },
  allowSameUnitPortionPrefill: true,
};

