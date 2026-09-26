/**
 * Canonical Role-to-Home Destination Policy
 */

export function resolveRoleHome(role?: string | null | unknown): string {
  if (typeof role !== 'string') return '/workspace-unavailable';
  const normalized = role.trim();
  if (!normalized) return '/workspace-unavailable';

  switch (normalized) {
    case 'SUPER_ADMIN':
      return '/super-admin';

    case 'DATA_EXECUTIVE':
    case 'DATA_ANALYST':
    case 'Data_Analyst':
    case 'Data_Executive':
    case 'Data Analyst':
      return '/super-admin/lab-tests';

    case 'FINANCE_ACCOUNTS':
      return '/finance/reconciliation';

    case 'EXECUTIVE_MANAGEMENT':
      return '/mpd/head';

    case 'ADMIN_HEAD':
      return '/department/security';

    case 'PRODUCTION_HEAD':
      return '/department/production';

    case 'HEAD_OF_MPD':
      return '/mpd/head';

    case 'ZMCC_MANAGER':
      return '/mpd/zmcc-manager';

    case 'ZMCC_LAB_ATTENDANT':
      return '/zmcc/lab';

    case 'PHE_OPERATOR':
      return '/phe';

    case 'MOT':
      return '/mot';

    case 'CONTRACTOR_MANAGER':
      return '/contractor/manager';

    case 'CONTRACTOR_OPERATOR':
      return '/contractor/manager';

    case 'SECURITY_OPERATOR':
      return '/department/security';

    case 'QA_LAB_ATTENDANT':
      return '/department/qa';

    case 'WEIGHBRIDGE_OPERATOR':
      return '/department/weighbridge';

    case 'PRODUCTION_RECEPTION_OPERATOR':
      return '/department/production';

    case 'QA_HEAD':
      return '/department/qa-head';

    case 'QA_MANAGER':
      return '/department/qa-manager';

    case 'SYSTEM_ADMIN':
    case 'Admin':
    case 'Management':
      return '/workspace-unavailable';

    default:
      return '/workspace-unavailable';
  }
}
