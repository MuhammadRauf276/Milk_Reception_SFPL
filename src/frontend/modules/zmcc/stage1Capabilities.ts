// Client-safe Stage 1 capability helpers (pure role-hierarchy checks; the server stays the source of truth).
import { canActAs } from '@/backend/core/roles/hierarchy';

export function canCreateRoute(role: string): boolean {
  return canActAs(role, 'MDO');
}

export function routeNeedsApproval(role: string): boolean {
  return !canActAs(role, 'ZMCC_MANAGER');
}

export function canApproveRoute(role: string): boolean {
  return canActAs(role, 'ZMCC_MANAGER');
}

export function canApproveShop(role: string): boolean {
  return canActAs(role, 'MDO');
}

export function canAssignJourney(role: string): boolean {
  return canActAs(role, 'MDO');
}

export function canDecideMotException(role: string): boolean {
  return role !== 'DATA_EXECUTIVE' && canActAs(role, 'ZMCC_MANAGER');
}

export function canCoverMotWork(role: string): boolean {
  return role !== 'MOT' && canActAs(role, 'MOT');
}

export function isFieldStationRole(role: string): boolean {
  return role === 'PHE_OPERATOR' || role === 'MDO' || role === 'ZMCC_LAB_ATTENDANT' || role === 'MOBILE_TESTER';
}
