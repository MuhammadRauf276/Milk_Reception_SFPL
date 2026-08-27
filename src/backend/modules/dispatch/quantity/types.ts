import {
  QuantityUnit,
  MeasurementBasis,
  MeasurementCombination,
  DispatchQuantityPolicyConfig,
} from '../quantity-policy/types';

export type {
  QuantityUnit,
  MeasurementBasis,
  MeasurementCombination,
  DispatchQuantityPolicyConfig,
};

export interface QuantityMeasurementInput {
  value: string | number;
  unit: QuantityUnit;
  basis: MeasurementBasis;
}

export interface ValidatedQuantityMeasurement {
  value: string;
  unit: QuantityUnit;
  basis: MeasurementBasis;
}

export interface VehicleQuantitySubmission {
  value: string;
  unit: QuantityUnit;
  basis: MeasurementBasis;
}

export interface PortionQuantitySubmission {
  portionNumber: number;
  value: string;
  unit: QuantityUnit;
  basis: MeasurementBasis;
}

