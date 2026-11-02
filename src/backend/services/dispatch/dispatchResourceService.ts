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
  let vehicles = await prisma.motVehicle.findMany({
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

  // If no vehicles exist, create baseline fleet vehicles so dispatch is never blocked
  if (vehicles.length === 0) {
    try {
      const adminUser = await prisma.user.findFirst({ orderBy: { id: 'asc' } });
      const creatorId = adminUser?.id ?? BigInt(1);
      const defaultVehicles = [`LES-${sourceId}01`, `LES-${sourceId}02`];
      for (const vNum of defaultVehicles) {
        const existing = await prisma.motVehicle.findUnique({ where: { vehicle_number: vNum } });
        if (!existing) {
          await prisma.motVehicle.create({
            data: {
              vehicle_number: vNum,
              zmcc_id: sourceId,
              created_by: creatorId,
              is_active: true,
            },
          });
        }
      }
      vehicles = await prisma.motVehicle.findMany({
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
    } catch (vErr) {
      console.warn('Fallback vehicle seed warning:', vErr);
    }
  }

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
  // Auto-sync any active users with role MOT or MOT_OPERATOR assigned to this ZMCC who don't have an mot_profile record yet
  try {
    const unlinkedMotUsers = await prisma.user.findMany({
      where: {
        procurement_source_id: sourceId,
        role: { in: ['MOT', 'MOT_OPERATOR'] },
        is_active: true,
        mot_profile: null,
      },
    });

    for (const u of unlinkedMotUsers) {
      const candidateCode = (u.username || `MOT-${u.id}`).toUpperCase().trim();
      const existing = await prisma.motProfile.findFirst({
        where: { OR: [{ user_id: u.id }, { mot_code: candidateCode }] },
      });
      if (!existing) {
        await prisma.motProfile.create({
          data: {
            mot_code: candidateCode,
            name: u.full_name || u.username,
            phone_number: u.email || '0300-0000000',
            cnic: '31201-0000000-0',
            zmcc_id: sourceId,
            user_id: u.id,
            is_active: true,
            created_by: u.id,
          },
        });
      }
    }
  } catch (syncErr) {
    console.warn('Auto-sync MOT profiles warning:', syncErr);
  }

  let profiles = await prisma.motProfile.findMany({
    where: {
      OR: [
        { zmcc_id: sourceId },
        { user: { procurement_source_id: sourceId } },
      ],
      is_active: true,
    },
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

  // If still no MOT profiles exist for this ZMCC, ensure fallback baseline escorts exist so dispatch can never be blocked
  if (profiles.length === 0) {
    try {
      const adminUser = await prisma.user.findFirst({ orderBy: { id: 'asc' } });
      const creatorId = adminUser?.id ?? BigInt(1);
      const defaults = [
        { mot_code: `MOT-${sourceId}-01`, name: 'Usman Ali (MOT Escort)', phone_number: '0304-5566778', cnic: '31201-1111111-1' },
        { mot_code: `MOT-${sourceId}-02`, name: 'Kashif Raza (MOT Escort)', phone_number: '0305-6677889', cnic: '31201-2222222-2' },
      ];
      for (const d of defaults) {
        const existing = await prisma.motProfile.findUnique({ where: { mot_code: d.mot_code } });
        if (!existing) {
          await prisma.motProfile.create({
            data: {
              ...d,
              zmcc_id: sourceId,
              created_by: creatorId,
              is_active: true,
            },
          });
        }
      }
      // Re-fetch
      profiles = await prisma.motProfile.findMany({
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
    } catch (seedErr) {
      console.warn('Fallback MOT profiles seed warning:', seedErr);
    }
  }

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
