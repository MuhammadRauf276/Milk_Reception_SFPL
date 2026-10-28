/**
 * Display labels for roles (plan §1). Role codes stored in the database stay
 * unchanged; only the text shown to users changes here.
 *
 * Pure TypeScript — safe to import on the client.
 */
import type { CanonicalRole, RetiredRole } from '../types';

export const RETIRED_ROLE_LABELS: Record<RetiredRole, string> = {
  QA_MANAGER: 'QA Manager (retired)',
};

export const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Admin',
  EXECUTIVE_MANAGEMENT: 'Senior Executive Management',
  DATA_EXECUTIVE: 'Data Executive',
  FINANCE_ACCOUNTS: 'Finance and Accounts',
  HEAD_OF_MPD: 'MPD Head',
  CONTRACTOR_MANAGER: 'Contractor Manager',
  CONTRACTOR_OPERATOR: 'Contractor Operator',
  ZMCC_MANAGER: 'Zonal Manager',
  MDO: 'MDO (Milk Development Officer)',
  PHE_OPERATOR: 'PHE Operator',
  ZMCC_LAB_ATTENDANT: 'Zonal Lab Attendant',
  MOT: 'Mobile Tester',
  ADMIN_HEAD: 'Admin Head',
  SECURITY_OPERATOR: 'Admin Operator',
  QA_HEAD: 'AVP – Quality Assurance',
  QA_LAB_ATTENDANT: 'QAE – Reception Lab',
  QA_MANAGER: 'QA Manager (retired)',
  PRODUCTION_HEAD: 'Production Head',
  WEIGHBRIDGE_OPERATOR: 'Weighbridge Operator',
  PRODUCTION_RECEPTION_OPERATOR: 'Production Reception Operator',
} as const satisfies Record<CanonicalRole | RetiredRole, string>;

const UPPERCASE_WORDS = new Set(['qa', 'mpd', 'zmcc', 'phe', 'mot', 'mdo']);

function humanizeRoleCode(role: string): string {
  return role
    .trim()
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => (UPPERCASE_WORDS.has(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

/**
 * Label for a role code. Unknown codes (legacy roles, typos) are turned into
 * readable words, e.g. `Security_Manager` → `Security Manager`.
 */
export function getRoleLabel(role: string | null | undefined, fallback = 'Workspace'): string {
  if (typeof role !== 'string' || !role.trim()) return fallback;
  const code = role.trim();
  if (Object.prototype.hasOwnProperty.call(ROLE_LABELS, code)) {
    return ROLE_LABELS[code as CanonicalRole | RetiredRole];
  }
  return humanizeRoleCode(code) || fallback;
}
