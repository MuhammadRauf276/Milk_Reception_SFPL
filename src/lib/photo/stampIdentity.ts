// Who is printed into a photo's stamp. Never "unknown": the camera waits until the signed-in person is known.
import { getRoleLabel } from '@/backend/core/roles/labels';

type StampUser = { employee_code?: string | null; username?: string | null; role?: string | null } | null | undefined;

/** Employee code, else username; empty while the user is still loading. */
export function stampEmployeeCode(user: StampUser): string {
  return (user?.employee_code || user?.username || '').trim();
}

/** The role's readable name; empty while the user is still loading. */
export function stampRoleLabel(user: StampUser): string {
  return user?.role ? getRoleLabel(user.role) : '';
}

/** False for an empty value or a placeholder such as "unknown". */
export function isStampIdentityKnown(value: string | null | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v !== '' && v !== 'unknown';
}
