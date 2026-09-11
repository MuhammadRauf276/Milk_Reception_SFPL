/**
 * Shared User Assignment Policy
 * Single source of truth for Role-Guided User Assignment (UI and APIs).
 */

export const CREATABLE_ROLES = [
  'SUPER_ADMIN',
  'HEAD_OF_MPD',
  'ZMCC_MANAGER',
  'ZMCC_LAB_ATTENDANT',
  'PHE_OPERATOR',
  'MOT',
  'CONTRACTOR_MANAGER',
  'MPD_Operator',
  'Security_Manager',
  'Security_Operator',
  'QA_Operator',
  'WEIGHBRIDGE_OPERATOR',
  'Production_Operator',
] as const;

export type CreatableRole = (typeof CREATABLE_ROLES)[number];

export type ScopeType = 'SYSTEM' | 'SOURCE' | 'DEPARTMENT';
export type AllowedSourceType = 'ZMCC' | 'CONTRACTOR' | null;

export interface RoleAssignmentPolicy {
  role: CreatableRole;
  label: string;
  scopeType: ScopeType;
  department: string;
  requiresSource: boolean;
  allowedSourceType: AllowedSourceType;
  summaryLabel: string;
}

export const ROLE_ASSIGNMENT_POLICIES: Record<CreatableRole, RoleAssignmentPolicy> = {
  SUPER_ADMIN: {
    role: 'SUPER_ADMIN',
    label: 'Super Admin',
    scopeType: 'SYSTEM',
    department: 'System Administration',
    requiresSource: false,
    allowedSourceType: null,
    summaryLabel: 'System Administration (System-wide)',
  },
  HEAD_OF_MPD: {
    role: 'HEAD_OF_MPD',
    label: 'Head of MPD',
    scopeType: 'SYSTEM',
    department: 'Milk Procurement',
    requiresSource: false,
    allowedSourceType: null,
    summaryLabel: 'Milk Procurement (Global Policy)',
  },
  ZMCC_MANAGER: {
    role: 'ZMCC_MANAGER',
    label: 'ZMCC Source Manager',
    scopeType: 'SOURCE',
    department: 'Milk Procurement',
    requiresSource: true,
    allowedSourceType: 'ZMCC',
    summaryLabel: 'Milk Procurement (Source-bound: ZMCC)',
  },
  ZMCC_LAB_ATTENDANT: {
    role: 'ZMCC_LAB_ATTENDANT',
    label: 'ZMCC Lab Attendant',
    scopeType: 'SOURCE',
    department: 'Milk Procurement',
    requiresSource: true,
    allowedSourceType: 'ZMCC',
    summaryLabel: 'Milk Procurement (Source-bound: ZMCC)',
  },
  PHE_OPERATOR: {
    role: 'PHE_OPERATOR',
    label: 'PHE Operator',
    scopeType: 'SOURCE',
    department: 'Milk Procurement',
    requiresSource: true,
    allowedSourceType: 'ZMCC',
    summaryLabel: 'Milk Procurement (Source-bound: ZMCC)',
  },
  MOT: {
    role: 'MOT',
    label: 'MOT Driver / Operator',
    scopeType: 'SOURCE',
    department: 'Milk Procurement',
    requiresSource: true,
    allowedSourceType: 'ZMCC',
    summaryLabel: 'Milk Procurement (Source-bound: ZMCC)',
  },
  CONTRACTOR_MANAGER: {
    role: 'CONTRACTOR_MANAGER',
    label: 'Contractor Source Manager',
    scopeType: 'SOURCE',
    department: 'Milk Procurement',
    requiresSource: true,
    allowedSourceType: 'CONTRACTOR',
    summaryLabel: 'Milk Procurement (Source-bound: Contractor)',
  },
  MPD_Operator: {
    role: 'MPD_Operator',
    label: 'MPD Operator',
    scopeType: 'SOURCE',
    department: 'Milk Procurement',
    requiresSource: true,
    allowedSourceType: 'ZMCC',
    summaryLabel: 'Milk Procurement (Source-bound: ZMCC)',
  },
  Security_Manager: {
    role: 'Security_Manager',
    label: 'Security Manager',
    scopeType: 'DEPARTMENT',
    department: 'Security',
    requiresSource: false,
    allowedSourceType: null,
    summaryLabel: 'Security (Department-restricted)',
  },
  Security_Operator: {
    role: 'Security_Operator',
    label: 'Security Operator',
    scopeType: 'DEPARTMENT',
    department: 'Security',
    requiresSource: false,
    allowedSourceType: null,
    summaryLabel: 'Security (Department-restricted)',
  },
  QA_Operator: {
    role: 'QA_Operator',
    label: 'QA Operator',
    scopeType: 'DEPARTMENT',
    department: 'Quality Assurance',
    requiresSource: false,
    allowedSourceType: null,
    summaryLabel: 'Quality Assurance (Department-restricted)',
  },
  WEIGHBRIDGE_OPERATOR: {
    role: 'WEIGHBRIDGE_OPERATOR',
    label: 'Weighbridge Operator',
    scopeType: 'DEPARTMENT',
    department: 'Production & Weighbridge',
    requiresSource: false,
    allowedSourceType: null,
    summaryLabel: 'Production & Weighbridge (Department-restricted)',
  },
  Production_Operator: {
    role: 'Production_Operator',
    label: 'Production Operator',
    scopeType: 'DEPARTMENT',
    department: 'Production',
    requiresSource: false,
    allowedSourceType: null,
    summaryLabel: 'Production (Department-restricted)',
  },
};

export function isCreatableRole(role: string): role is CreatableRole {
  return CREATABLE_ROLES.includes(role as CreatableRole);
}

export function getRoleAssignmentPolicy(role: string): RoleAssignmentPolicy | null {
  if (!isCreatableRole(role)) {
    return null;
  }
  return ROLE_ASSIGNMENT_POLICIES[role];
}
