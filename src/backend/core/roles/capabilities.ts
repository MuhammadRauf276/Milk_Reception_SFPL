/**
 * Non-delegable capabilities (Phase 3 owner decision).
 *
 * CORRECT (edit / correct saved records) and ADMINISTER (control devices:
 * register / release / block, activity diary, alerts) can never be passed
 * down the role tree. Only Super Admin and Data Executive hold them, and a
 * superior acting as another role never gains them.
 *
 * Pure TypeScript: safe on server and client.
 */
import type { CanonicalRole } from '../types';

export const NON_DELEGABLE_CAPABILITIES = ['CORRECT', 'ADMINISTER'] as const;

export type NonDelegableCapability = (typeof NON_DELEGABLE_CAPABILITIES)[number];

const NON_DELEGABLE_HOLDERS: Record<NonDelegableCapability, readonly CanonicalRole[]> = {
  CORRECT: ['SUPER_ADMIN', 'DATA_EXECUTIVE'],
  ADMINISTER: ['SUPER_ADMIN', 'DATA_EXECUTIVE'],
};

/** True only when `role` itself (never a role it acts as) holds `cap`. */
export function holdsNonDelegable(role: string, cap: NonDelegableCapability): boolean {
  const holders = NON_DELEGABLE_HOLDERS[cap] as readonly string[] | undefined;
  return !!holders && holders.includes(role);
}

/** Who may correct / edit saved records: SUPER_ADMIN and DATA_EXECUTIVE. */
export function isCorrectionAuthority(role: string): boolean {
  return holdsNonDelegable(role, 'CORRECT');
}

/** Who may control devices (register, release, block, diary, alerts): SUPER_ADMIN and DATA_EXECUTIVE. */
export function isDeviceAdministrator(role: string): boolean {
  return holdsNonDelegable(role, 'ADMINISTER');
}
