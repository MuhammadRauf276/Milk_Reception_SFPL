import { prisma } from '@core/db';

export interface DispatchVehicleResource {
  id: string;
  vehicle_number: string;
  is_available: boolean;
  busy_reason?: string;
}

export interface DispatchMotResource {
  id: string;
  mot_code: string;
  name: string;
  phone_number: string;
  is_available: boolean;
  busy_reason?: string;
}

export interface DispatchResourcesResult {
  sourceType: 'ZMCC' | 'CONTRACTOR';
  vehicles: DispatchVehicleResource[];
  motProfiles: DispatchMotResource[];
}

/**
 * Returns available (free) fleet vehicles and MOT profiles for a ZMCC procurement source.
 * A vehicle or MOT is free if:
 * 1. It is active in master data.
 * 2. It is not currently on an active collection journey (COLLECTING or RETURNING).
 * 3. It is not currently in an unfinished arrival waiting for unload at ZMCC.
 * 4. It is not currently dispatched to the plant on an active in-flight visit.
 */
export async function getDispatchResources(sourceId: bigint): Promise<DispatchResourcesResult> {
  const source = await prisma.procurementSource.findUnique({
    where: { id: sourceId },
    select: { id: true, source_type: true, is_active: true },
  });

  if (!source || !source.is_active || source.source_type !== 'ZMCC') {
    return {
      sourceType: (source?.source_type as 'ZMCC' | 'CONTRACTOR') || 'CONTRACTOR',
      vehicles: [],
      motProfiles: [],
    };
  }

  // 1. Vehicles assigned to this ZMCC
  const vehicles = await prisma.motVehicle.findMany({
    where: { zmcc_id: sourceId, is_active: true },
    orderBy: { vehicle_number: 'asc' },
    select: {
      id: true,
      vehicle_number: true,
      journeys: {
        where: { status: { in: ['COLLECTING', 'RETURNING'] } },
        select: { id: true, journey_number: true },
      },
    },
  });

  // Check unfinished arrivals at ZMCC
  const unfinishedArrivals = await prisma.zmccMotArrival.findMany({
    where: {
      journey: {
        mot_vehicle_id: { in: vehicles.map((v) => v.id) },
      },
      lab_session: {
        journey_closed_at: null,
      },
    },
    select: {
      journey: { select: { mot_vehicle_id: true } },
    },
  });
  const busyVehicleArrivalIds = new Set(
    unfinishedArrivals.map((a) => a.journey.mot_vehicle_id.toString())
  );

  // Check in-flight VehicleVisits dispatched to plant
  const activePlantVisits = await prisma.$queryRaw<
    Array<{ mot_vehicle_id: bigint | null; vehicle_number: string | null }>
  >`
    SELECT vv.mot_vehicle_id, vv.vehicle_number
    FROM vehicle_visit vv
    LEFT JOIN gate_log gl ON gl.visit_id = vv.id
    WHERE vv.current_status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED', 'DRAFT_DISPATCH')
      AND (gl.id IS NULL OR gl.exit_timestamp IS NULL)
  `;

  const busyVehicleVisitIds = new Set<string>();
  const busyVehicleVisitNumbers = new Set<string>();
  for (const pv of activePlantVisits) {
    if (pv.mot_vehicle_id) busyVehicleVisitIds.add(pv.mot_vehicle_id.toString());
    if (pv.vehicle_number) busyVehicleVisitNumbers.add(pv.vehicle_number.toUpperCase().trim());
  }

  const vehicleResources: DispatchVehicleResource[] = vehicles.map((v) => {
    const vIdStr = v.id.toString();
    const vNum = v.vehicle_number.toUpperCase().trim();
    if (v.journeys.length > 0) {
      return {
        id: vIdStr,
        vehicle_number: v.vehicle_number,
        is_available: false,
        busy_reason: `On collection journey #${v.journeys[0].journey_number}`,
      };
    }
    if (busyVehicleArrivalIds.has(vIdStr)) {
      return {
        id: vIdStr,
        vehicle_number: v.vehicle_number,
        is_available: false,
        busy_reason: 'At ZMCC waiting for unload',
      };
    }
    if (busyVehicleVisitIds.has(vIdStr) || busyVehicleVisitNumbers.has(vNum)) {
      return {
        id: vIdStr,
        vehicle_number: v.vehicle_number,
        is_available: false,
        busy_reason: 'In transit / at plant on dispatch visit',
      };
    }
    return {
      id: vIdStr,
      vehicle_number: v.vehicle_number,
      is_available: true,
    };
  });

  // 2. MOT profiles assigned to this ZMCC
  const profiles = await prisma.motProfile.findMany({
    where: { zmcc_id: sourceId, is_active: true },
    orderBy: { mot_code: 'asc' },
    select: {
      id: true,
      mot_code: true,
      name: true,
      phone_number: true,
      journeys: {
        where: { status: { in: ['COLLECTING', 'RETURNING'] } },
        select: { id: true, journey_number: true },
      },
    },
  });

  const activeMotPlantVisits = await prisma.$queryRaw<Array<{ mot_profile_id: bigint | null }>>`
    SELECT vv.mot_profile_id
    FROM vehicle_visit vv
    LEFT JOIN gate_log gl ON gl.visit_id = vv.id
    WHERE vv.mot_profile_id IS NOT NULL
      AND vv.current_status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED', 'DRAFT_DISPATCH')
      AND (gl.id IS NULL OR gl.exit_timestamp IS NULL)
  `;
  const busyMotVisitIds = new Set(
    activeMotPlantVisits
      .filter((pv) => pv.mot_profile_id !== null)
      .map((pv) => pv.mot_profile_id!.toString())
  );

  const motResources: DispatchMotResource[] = profiles.map((p) => {
    const pIdStr = p.id.toString();
    if (p.journeys.length > 0) {
      return {
        id: pIdStr,
        mot_code: p.mot_code,
        name: p.name,
        phone_number: p.phone_number,
        is_available: false,
        busy_reason: `On collection journey #${p.journeys[0].journey_number}`,
      };
    }
    if (busyMotVisitIds.has(pIdStr)) {
      return {
        id: pIdStr,
        mot_code: p.mot_code,
        name: p.name,
        phone_number: p.phone_number,
        is_available: false,
        busy_reason: 'Escorting an active dispatch to plant',
      };
    }
    return {
      id: pIdStr,
      mot_code: p.mot_code,
      name: p.name,
      phone_number: p.phone_number,
      is_available: true,
    };
  });

  return {
    sourceType: 'ZMCC',
    vehicles: vehicleResources,
    motProfiles: motResources,
  };
}
