/**
 * Shared User Assignment Policy
 * Single source of truth for Role-Guided User Assignment (UI and APIs).
 */

export const CREATABLE_ROLES = [
  'SUPER_ADMIN',
  'EXECUTIVE_MANAGEMENT',
  'DATA_EXECUTIVE',
  'HEAD_OF_MPD',
  'ADMIN_HEAD',
  'QA_HEAD',
  'PRODUCTION_HEAD',
  'FINANCE_ACCOUNTS',
  'ZMCC_MANAGER',
  'CONTRACTOR_MANAGER',
  'PHE_OPERATOR',
  'ZMCC_LAB_ATTENDANT',
  'MOT',
  'CONTRACTOR_OPERATOR',
  'SECURITY_OPERATOR',
  'QA_MANAGER',
  'QA_LAB_ATTENDANT',
  'WEIGHBRIDGE_OPERATOR',
  'PRODUCTION_RECEPTION_OPERATOR',
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
  EXECUTIVE_MANAGEMENT: {
    role: 'EXECUTIVE_MANAGEMENT',
    label: 'Senior Executive Management',
    scopeType: 'SYSTEM',
    department: 'Executive Management',
    requiresSource: false,
    allowedSourceType: null,
    summaryLabel: 'Executive Management (System-wide)',
  },
  DATA_EXECUTIVE: {
    role: 'DATA_EXECUTIVE',
    label: 'Data Executive',
    scopeType: 'SYSTEM',
    department: 'Data & Analytics',
    requiresSource: false,
    allowedSourceType: null,
    summaryLabel: 'Data & Analytics (System-wide)',
  },
  HEAD_OF_MPD: {
    role: 'HEAD_OF_MPD',
    label: 'MPD Head',
    scopeType: 'SYSTEM',
    department: 'Milk Procurement',
    requiresSource: false,
    allowedSourceType: null,
    summaryLabel: 'Milk Procurement (Global Policy)',
  },
  ADMIN_HEAD: {
    role: 'ADMIN_HEAD',
    label: 'Admin Head',
    scopeType: 'DEPARTMENT',
    department: 'Administration',
    requiresSource: false,
    allowedSourceType: null,
    summaryLabel: 'Administration (Department-restricted)',
  },
  QA_HEAD: {
    role: 'QA_HEAD',
    label: 'QA Head',
    scopeType: 'DEPARTMENT',
    department: 'Quality Assurance',
    requiresSource: false,
    allowedSourceType: null,
    summaryLabel: 'Quality Assurance (Department-restricted)',
  },
  PRODUCTION_HEAD: {
    role: 'PRODUCTION_HEAD',
    label: 'Production Head',
    scopeType: 'DEPARTMENT',
    department: 'Production',
    requiresSource: false,
    allowedSourceType: null,
    summaryLabel: 'Production (Department-restricted)',
  },
  FINANCE_ACCOUNTS: {
    role: 'FINANCE_ACCOUNTS',
    label: 'Finance and Accounts',
    scopeType: 'DEPARTMENT',
    department: 'Finance & Accounts',
    requiresSource: false,
    allowedSourceType: null,
    summaryLabel: 'Finance & Accounts (Department-restricted)',
  },
  ZMCC_MANAGER: {
    role: 'ZMCC_MANAGER',
    label: 'ZMCC Manager',
    scopeType: 'SOURCE',
    department: 'Milk Procurement',
    requiresSource: true,
    allowedSourceType: 'ZMCC',
    summaryLabel: 'Milk Procurement (Source-bound: ZMCC)',
  },
  CONTRACTOR_MANAGER: {
    role: 'CONTRACTOR_MANAGER',
    label: 'Contractor Manager',
    scopeType: 'SOURCE',
    department: 'Milk Procurement',
    requiresSource: true,
    allowedSourceType: 'CONTRACTOR',
    summaryLabel: 'Milk Procurement (Source-bound: Contractor)',
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
  ZMCC_LAB_ATTENDANT: {
    role: 'ZMCC_LAB_ATTENDANT',
    label: 'ZMCC Lab Attendant',
    scopeType: 'SOURCE',
    department: 'Milk Procurement',
    requiresSource: true,
    allowedSourceType: 'ZMCC',
    summaryLabel: 'Milk Procurement (Source-bound: ZMCC)',
  },
  MOT: {
    role: 'MOT',
    label: 'MOT',
    scopeType: 'SOURCE',
    department: 'Milk Procurement',
    requiresSource: true,
    allowedSourceType: 'ZMCC',
    summaryLabel: 'Milk Procurement (Source-bound: ZMCC)',
  },
  CONTRACTOR_OPERATOR: {
    role: 'CONTRACTOR_OPERATOR',
    label: 'Contractor Operator',
    scopeType: 'SOURCE',
    department: 'Milk Procurement',
    requiresSource: true,
    allowedSourceType: 'CONTRACTOR',
    summaryLabel: 'Milk Procurement (Source-bound: Contractor)',
  },
  SECURITY_OPERATOR: {
    role: 'SECURITY_OPERATOR',
    label: 'Security Operator',
    scopeType: 'DEPARTMENT',
    department: 'Security',
    requiresSource: false,
    allowedSourceType: null,
    summaryLabel: 'Security (Department-restricted)',
  },
  QA_MANAGER: {
    role: 'QA_MANAGER',
    label: 'QA Manager',
    scopeType: 'DEPARTMENT',
    department: 'Quality Assurance',
    requiresSource: false,
    allowedSourceType: null,
    summaryLabel: 'Quality Assurance (Department-restricted)',
  },
  QA_LAB_ATTENDANT: {
    role: 'QA_LAB_ATTENDANT',
    label: 'QA Lab Attendant',
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
  PRODUCTION_RECEPTION_OPERATOR: {
    role: 'PRODUCTION_RECEPTION_OPERATOR',
    label: 'Production Reception Operator',
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
