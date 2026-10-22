export interface LabTestOption {
  value: string;
  label: string;
  isPassing?: boolean | null;
  outcome?: 'PASS' | 'WARNING' | 'FAIL';
}

export interface UnassignedTestItem {
  id: string;
  testCode: string;
  testName: string;
  resultType: string;
  unit: string | null;
}

export interface UnifiedStageItem {
  labTest: {
    id: string;
    testCode: string;
    testName: string;
    resultType: string;
    unit: string | null;
    isActive: boolean;
    displayOrder: number;
    isPhotoRequired?: boolean;
    resultOptions?: LabTestOption[] | null;
  };
  policy: {
    id: string;
    isActive: boolean;
    isRequired: boolean;
    isPhotoRequired?: boolean;
    displayOrder: number;
    updatedAt: string;
  } | null;
  rule: {
    id: string;
    version: number;
    ruleCategory: 'RELEASE' | 'MONITORING';
    ruleTypeLabel: 'Must Pass' | 'Warning Only';
    minValue: number | null;
    maxValue: number | null;
    warningOffset?: number | null;
    warningTrigger?: 'BOTH' | 'ABOVE_MAX' | 'BELOW_MIN' | 'NONE' | 'RECORD_ONLY';
    acceptableOption: string | null;
    effectiveFrom: string;
    isInherited?: boolean;
    isRecordOnly?: boolean;
  } | null;
}

export interface StageResponse {
  items?: UnifiedStageItem[];
  unassignedTests?: UnassignedTestItem[];
  canEdit?: boolean;
}

export const STAGE_TABS = [
  { id: 'CATALOG', label: 'Master Test Catalog', subtitle: 'All Enterprise Tests, Stage Scope & Acceptance Rule Configurations' },
  { id: 'GLOBAL_DEFAULT', label: '0. Global Master Specs', subtitle: 'Universal Baseline Specification (Inherited by all stages)' },
  { id: 'MOT_SHOP', label: '1. MOT Shop', subtitle: 'Village Shop Intake (Liters) · Can Rejection on Failure' },
  { id: 'ZMCC_LAB_MC', label: '2. ZMCC MC', subtitle: 'ZMCC Route Milk Intake (kg) · Chilled Silo vs Rejected Tank' },
  { id: 'ZMCC_LAB_HC', label: '3. ZMCC HC', subtitle: 'Direct Supplier (HC) Deliveries (kg) · Token Clearance' },
  { id: 'DISPATCH', label: '4. Dispatch', subtitle: 'Tanker Dispatch to Plant (kg) · Strict Chilling (0–4.5°C) & Seal Clearance' },
  { id: 'PLANT_QA', label: '5. Plant QA', subtitle: 'Plant Reception (kg) · Zero-Tolerance Adulteration Reject' },
] as const;
