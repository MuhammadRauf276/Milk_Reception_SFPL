import {
  QuantityUnit,
  MeasurementBasis,
  MeasurementMethod,
  MeasurementCombination,
  DispatchQuantityPolicyConfig,
} from '../quantity-policy/types';

export type {
  QuantityUnit,
  MeasurementBasis,
  MeasurementMethod,
  MeasurementCombination,
  DispatchQuantityPolicyConfig,
};

export interface QuantityMeasurementInput {
  value: string | number;
  unit: QuantityUnit;
  basis: MeasurementBasis;
  method: MeasurementMethod;
}

export interface ValidatedQuantityMeasurement {
  value: string;
  unit: QuantityUnit;
  basis: MeasurementBasis;
  method: MeasurementMethod;
}

export interface VehicleQuantitySubmission {
  value: string;
  unit: QuantityUnit;
  basis: MeasurementBasis;
  method: MeasurementMethod;
}

export interface PortionQuantitySubmission {
  portionNumber: number;
  value: string;
  unit: QuantityUnit;
  basis: MeasurementBasis;
  method: MeasurementMethod;
}

