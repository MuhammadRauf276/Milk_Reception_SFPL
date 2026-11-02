/**
 * Authoritative Role-Based Visibility Policies for Milk Volume & Commercial 13 TS Metrics
 * Ensures strict operational double-blind segregation and managerial transparency.
 */

export const ZMCC_13TS_VIEW_ROLES = [
  'ZMCC_MANAGER',
  'HEAD_OF_MPD',
  'EXECUTIVE_MANAGEMENT',
  'DATA_EXECUTIVE',
  'SUPER_ADMIN',
] as const;

export const PLANT_13TS_VIEW_ROLES = [
  'PRODUCTION_HEAD',
  'EXECUTIVE_MANAGEMENT',
  'DATA_EXECUTIVE',
  'SUPER_ADMIN',
] as const;

export const BLIND_OPERATIONAL_ROLES = [
  'ZMCC_LAB_ATTENDANT',
  'PHE_OPERATOR',
  'MDO',
  'MOT',
  'PRODUCTION_RECEPTION_OPERATOR',
  'WEIGHBRIDGE_OPERATOR',
  'QA_LAB_ATTENDANT',
  'SECURITY_OPERATOR',
] as const;

/**
 * Returns true if the user role is authorized to view ZMCC tank/tanker 13 TS liters.
 */
export function canViewZmcc13TsLiters(role?: string | null): boolean {
  if (!role || typeof role !== 'string') return false;
  return (ZMCC_13TS_VIEW_ROLES as readonly string[]).includes(role.trim());
}

/**
 * Returns true if the user role is authorized to view Plant silo/tanker 13 TS liters.
 */
export function canViewPlant13TsLiters(role?: string | null): boolean {
  if (!role || typeof role !== 'string') return false;
  return (PLANT_13TS_VIEW_ROLES as readonly string[]).includes(role.trim());
}

/**
 * Returns true if the user role is an operational/field role that is strictly blinded from
 * declared or target milk quantities (double-blind test and scale operation).
 */
export function isBlindOperationalRole(role?: string | null): boolean {
  if (!role || typeof role !== 'string') return false;
  return (BLIND_OPERATIONAL_ROLES as readonly string[]).includes(role.trim());
}
