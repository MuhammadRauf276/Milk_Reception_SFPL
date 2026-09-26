import { prisma } from '@/backend/core/db';
import { assertManagementFiltersWithinScope, ManagementFilters, ManagementScope, normalizeManagementPage, Page, VehicleStageRow, toManagementVehicleStage } from '@/backend/modules/management-reporting';

/** Authoritative, read-only projection for management screens. */
export async function getCurrentVehicleStages(scope: ManagementScope, filters: ManagementFilters = {}): Promise<Page<VehicleStageRow>> {
  assertManagementFiltersWithinScope(scope, filters);
  const sourceId = scope.kind === 'ZMCC' ? scope.zmccId : filters.sourceId;
  const sourceFilter = sourceId ? { procurement_source_id: BigInt(sourceId) } : {};
  const createdAt = filters.from || filters.to ? {
    ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00.000Z`) } : {}),
    ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59.999Z`) } : {}),
  } : undefined;
  const vehicleFilter = filters.vehicleNumber?.trim()
    ? { contains: filters.vehicleNumber.trim(), mode: 'insensitive' as const }
    : undefined;
  const where = { ...sourceFilter, ...(createdAt ? { created_at: createdAt } : {}), ...(vehicleFilter ? { vehicle_number: vehicleFilter } : {}), current_status: { notIn: ['COMPLETED', 'CANCELLED'] }, ...(filters.exceptionOnly ? { portions: { some: { manager_review_status: 'PENDING' } } } : {}) };
  const { page, pageSize } = normalizeManagementPage(filters);
  const [visits, total] = await Promise.all([prisma.vehicleVisit.findMany({
    where,
    include: {
      procurement_source: { select: { id: true, code: true, name: true } },
      gate_log: { select: { entry_timestamp: true } },
      portions: { select: { manager_review_status: true, manager_review_requested_at: true, plant_decision: true } },
    },
    orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * pageSize, take: pageSize,
  }), prisma.vehicleVisit.count({ where })]);
  const items = visits.map((visit) => {
    const exception = visit.portions.find((portion) => portion.manager_review_status === 'PENDING');
    return {
      visitId: visit.id.toString(), vehicleNumber: visit.vehicle_number,
      source: visit.procurement_source ? { id: visit.procurement_source.id.toString(), code: visit.procurement_source.code, name: visit.procurement_source.name } : { id: '', code: 'UNKNOWN', name: 'Unknown source' },
      route: null, stage: toManagementVehicleStage(visit.current_status),
      stageChangedAt: visit.updated_at.toISOString(), enteredPlantAt: visit.gate_log?.entry_timestamp?.toISOString() || null,
      exception: exception ? { kind: 'QA_MANAGER_REVIEW', raisedAt: exception.manager_review_requested_at?.toISOString() || visit.updated_at.toISOString() } : null,
    };
  });
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}
