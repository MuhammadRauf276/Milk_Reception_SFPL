/**
 * Canonical Role-to-Home Destination Policy
 *
 * Single source of truth for role-home resolution.
 * Directs current canonical roles to their dedicated workspaces,
 * explicitly routes legacy roles to legacy views, and
 * fails closed for future/unready or unknown roles.
 */

export function resolveRoleHome(role?: string | null): string {
  if (!role || typeof role !== 'string') {
    return '/login';
  }

  const normalized = role.trim();

  switch (normalized) {
    // Current Canonical Roles
    case 'SUPER_ADMIN':
    case 'Admin':
      return '/super-admin';

    case 'ZMCC_MANAGER':
      return '/mpd/zmcc-manager';

    case 'MPD_Operator':
    case 'MPD':
      return '/department/mpd';

    case 'Security_Operator':
    case 'Security_Weight':
      return '/department/security';

    case 'Security_Manager':
      return '/department/security-manager';

    case 'QA_Operator':
    case 'QA':
    case 'Lab_Chemist':
      return '/department/qa';

    case 'WEIGHBRIDGE_OPERATOR':
    case 'Weighbridge_Operator':
      return '/department/weighbridge';

    case 'Production_Operator':
    case 'Production':
      return '/department/production';

    // Explicit Legacy Roles (Temporary routing to legacy dashboard until retired in 4E)
    case 'MPD_Zone_Manager':
    case 'Management':
    case 'General_Plant_Manager':
    case 'QA_Manager':
    case 'Production_Manager':
    case 'Correction_Officer':
      return '/management/dashboard';

    // Future Roles (Not Ready) & Fail-Closed Unknown Roles
    case 'CONTRACTOR_MANAGER':
    case 'EXECUTIVE_MANAGEMENT':
    default:
      return '/workspace-unavailable';
  }
}
