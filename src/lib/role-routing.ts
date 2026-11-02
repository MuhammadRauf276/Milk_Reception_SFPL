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
      return '/super-admin/corrections';

    case 'FINANCE_ACCOUNTS':
    case 'ADMIN_HEAD':
      return '/approvals';

    case 'PRODUCTION_HEAD':
      return '/department/production-head';

    case 'EXECUTIVE_MANAGEMENT':
    case 'HEAD_OF_MPD':
      return '/command';

    case 'ZMCC_MANAGER':
      return '/mpd/zmcc-manager';

    case 'ZMCC_LAB_ATTENDANT':
      return '/zmcc/lab';

    case 'PHE_OPERATOR':
      return '/phe';

    // MDO uses the PHE station for now: route, shop and MOT dispatch tools live there.
    case 'MDO':
      return '/phe';

    case 'MOT':
      return '/mot';

    case 'CONTRACTOR_MANAGER':
      return '/contractor/manager';

    case 'CONTRACTOR_OPERATOR':
      return '/contractor/dispatch';

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
      return '/workspace-unavailable?reason=retired&role=QA_MANAGER';

    case 'SYSTEM_ADMIN':
    case 'Admin':
    case 'Management':
      return '/workspace-unavailable';

    default:
      return '/workspace-unavailable';
  }
}
