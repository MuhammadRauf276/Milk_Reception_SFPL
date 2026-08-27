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
      return '/department/qa';

    case 'WEIGHBRIDGE_OPERATOR':
    case 'Weighbridge_Operator':
      return '/department/weighbridge';

    case 'Production_Operator':
    case 'Production':
      return '/department/production';

    // Retired Legacy Roles (Fails closed to /workspace-unavailable in 4E-D)
    case 'MPD_Zone_Manager':
    case 'Management':
    case 'General_Plant_Manager':
    case 'QA_Manager':
    case 'Production_Manager':
    case 'Correction_Officer':
    // Future Roles (Not Ready) & Fail-Closed Unknown Roles
    case 'CONTRACTOR_MANAGER':
    case 'EXECUTIVE_MANAGEMENT':
    default:
      return '/workspace-unavailable';
  }
}
