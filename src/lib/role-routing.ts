/**
 * Canonical Role-to-Home Destination Policy
 *
 * Single source of truth for role-home resolution.
 * Directs current canonical roles to their dedicated workspaces,
 * and fails closed to /workspace-unavailable for legacy, future,
 * invalid, or unrecognized roles.
 */

export function resolveRoleHome(role?: string | null | unknown): string {
  if (typeof role !== 'string') {
    return '/workspace-unavailable';
  }

  const normalized = role.trim();
  if (!normalized) {
    return '/workspace-unavailable';
  }

  switch (normalized) {
    // Current Canonical Roles with dedicated workspaces
    case 'SUPER_ADMIN':
      return '/super-admin';

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

    case 'SECURITY_OPERATOR':
      return '/department/security';

    case 'QA_LAB_ATTENDANT':
      return '/department/qa';

    case 'WEIGHBRIDGE_OPERATOR':
      return '/department/weighbridge';

    case 'PRODUCTION_RECEPTION_OPERATOR':
      return '/department/production';

    // Unimplemented high-level canonical roles & Contractor Operator (fail-closed)
    case 'CONTRACTOR_OPERATOR':
    case 'EXECUTIVE_MANAGEMENT':
    case 'DATA_EXECUTIVE':
    case 'ADMIN_HEAD':
    case 'QA_HEAD':
    case 'QA_MANAGER':
    case 'PRODUCTION_HEAD':
    case 'FINANCE_ACCOUNTS':
    // Retired Legacy Roles (fail-closed)
    case 'Admin':
    case 'MPD':
    case 'MPD_Operator':
    case 'MPD_Zone_Manager':
    case 'QA':
    case 'QA_Operator':
    case 'Security_Weight':
    case 'Security_Operator':
    case 'Security_Manager':
    case 'Weighbridge_Operator':
    case 'Production':
    case 'Production_Operator':
    case 'Production_Manager':
    case 'General_Plant_Manager':
    case 'Correction_Officer':
    case 'Management':
    default:
      return '/workspace-unavailable';
  }
}
