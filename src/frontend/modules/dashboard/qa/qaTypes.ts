export type TestPerformanceStatus = 'PERFORMED' | 'NOT_PERFORMED';

export interface LabTestDef {
  id: string;
  testCode: string;
  testName: string;
  /** Stored role (LR, FAT, SNF…) when the database has one. */
  systemRole?: string | null;
  resultType: 'NUMERIC' | 'TEXT' | 'QUALITATIVE' | 'BOOLEAN' | 'OK_NOT_OK' | 'POSITIVE_NEGATIVE' | 'CALCULATED' | string;
  unit: string | null;
  testScope: string;
  isRequired: boolean;
  isPhotoRequired?: boolean;
  displayOrder: number;
  resultOptions?: Array<{ value: string; label: string; isPassing: boolean | null }> | null;
  /** Active PLANT_QA release rule (same shape as the dispatch policy rule). */
  rule?: { min: number | null; max: number | null; allowed?: string[] | null } | null;
}

export interface SavedPlantResult {
  testId: string;
  testCode: string;
  testName: string;
  resultType: string;
  unit: string | null;
  performanceStatus: string;
  notPerformedReason: string | null;
  numericValue: number | null;
  textValue: string | null;
  isPassed: boolean | null;
}

export interface VisitDetailPortion {
  id: string;
  visit_id: string;
  portion_number: number;
  current_status: string;
  dispatch_quantity_value?: number | null;
  dispatch_quantity_unit?: string;
  dispatch_quantity_basis?: string;
  plant_decision: string;
  plant_rejection_reason: string | null;
  dispatch_results: unknown[];
  plant_results: SavedPlantResult[];
  manager_review_status?: string | null;
  seal_number?: string | null;
  plant_seal_number_entered?: string | null;
  seal_match?: boolean | null;
  exception_reasons?: string[] | null;
}

export interface VisitDetail {
  id: string;
  visit_number: string;
  reception_number: string | null;
  vehicle_number: string;
  token_number: string | null;
  operational_date: string | null;
  entry_timestamp: string | null;
  current_status: string;
  test_mode?: string | null;
  visit_decision_summary: string;
  vehicle_dispatch_quantity_value?: number | null;
  vehicle_dispatch_quantity_unit?: string | null;
  vehicle_dispatch_fat?: number | null;
  vehicle_dispatch_lr?: number | null;
  vehicle_dispatch_snf?: number | null;
  portions: VisitDetailPortion[];
  active_plant_tests: LabTestDef[];
}

export interface TestInputState {
  performanceStatus: TestPerformanceStatus;
  notPerformedReason: string;
  numericValue: string;
  textValue: string;
}
