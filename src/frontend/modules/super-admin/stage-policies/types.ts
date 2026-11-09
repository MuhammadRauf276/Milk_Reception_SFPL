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
  { id: 'CATALOG', label: 'Master Test Catalog', subtitle: 'All tests, stage scope & Acceptance Rule Configurations' },
  { id: 'GLOBAL_DEFAULT', label: '0. Global Master Specs', subtitle: 'Base rules for all stages' },
  { id: 'MOT_SHOP', label: '1. Mobile Tester Shop', subtitle: 'Village shop intake (litres)' },
  { id: 'ZMCC_LAB_MC', label: '2. ZMCC Mobile Tester', subtitle: 'ZMCC route milk (kg)' },
  { id: 'ZMCC_LAB_HC', label: '3. ZMCC HC', subtitle: 'HC deliveries (kg)' },
  { id: 'DISPATCH', label: '4. Dispatch', subtitle: 'Tanker dispatch to plant (kg)' },
  { id: 'PLANT_QA', label: '5. Plant QA', subtitle: 'Plant reception (kg)' },
] as const;
