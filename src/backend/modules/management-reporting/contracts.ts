/**
 * Read-only contracts for management dashboards.
 *
 * These types intentionally contain serialized business facts rather than
 * Prisma models. Operational commands must not import this module to write
 * data, and management screens must not receive unrestricted database rows.
 */

export type ManagementScope =
  | { kind: 'SYSTEM' }
  | { kind: 'DEPARTMENT'; department: string }
  | { kind: 'ZMCC'; zmccId: string };

export interface ManagementFilters {
  from?: string;
  to?: string;
  sourceId?: string;
  vehicleNumber?: string;
  routeId?: string;
  exceptionOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface VehicleStageRow {
  visitId: string;
  vehicleNumber: string;
  source: { id: string; code: string; name: string };
  route: { id: string; name: string } | null;
  stage: string;
  stageChangedAt: string | null;
  enteredPlantAt: string | null;
  exception: { kind: string; raisedAt: string } | null;
}

export interface ManagementDashboardQuery {
  scope: ManagementScope;
  filters: ManagementFilters;
}

export function normalizeManagementPage(filters: ManagementFilters): Required<Pick<ManagementFilters, 'page' | 'pageSize'>> {
  const page = Math.max(1, Math.trunc(Number(filters.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(filters.pageSize) || 25)));
  return { page, pageSize };
}

/** Prevent a request filter from widening a scope chosen by server authorization. */
export function assertManagementFiltersWithinScope(scope: ManagementScope, filters: ManagementFilters): void {
  if (scope.kind === 'ZMCC' && filters.sourceId && filters.sourceId !== scope.zmccId) {
    throw new Error('Forbidden: source filter is outside the authorized ZMCC scope.');
  }
}
