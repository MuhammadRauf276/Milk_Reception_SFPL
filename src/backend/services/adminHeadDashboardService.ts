import { prisma } from '@/backend/core/db';
import { AdminHeadDashboard, AdminHeadVehicleBoardRow, toManagementVehicleStage } from '@/backend/modules/management-reporting';

export async function getAdminHeadDashboard(): Promise<AdminHeadDashboard> {
  const inside = await prisma.vehicleVisit.findMany({ where: { gate_log: { is: { entry_timestamp: { not: null }, exit_timestamp: null } } }, include: { gate_log: true }, orderBy: { updated_at: 'asc' } });
  const vehicles: AdminHeadVehicleBoardRow[] = inside.map((v) => ({ visitId: v.id.toString(), vehicleNumber: v.vehicle_number, stage: toManagementVehicleStage(v.current_status), enteredPlantAt: v.gate_log?.entry_timestamp?.toISOString() || null, stageChangedAt: v.updated_at.toISOString() }));
  const latestExit = await prisma.gateLog.findFirst({ where: { exit_timestamp: { not: null } }, orderBy: { exit_timestamp: 'desc' }, select: { exit_timestamp: true } });
  return { security: { vehiclesInsidePlant: vehicles.length, pendingGateExit: inside.filter((v) => v.current_status === 'READY_FOR_GATE_EXIT').length, latestEntryAt: vehicles.at(-1)?.enteredPlantAt || null, latestExitAt: latestExit?.exit_timestamp?.toISOString() || null }, vehicles };
}
