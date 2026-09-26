import type {
  PaperLinkedIdentityContract,
  PaperReferenceIdentity,
  SystemRecordIdentity,
} from '@/backend/core/paperReferenceContracts';

export type {
  PaperLinkedIdentityContract,
  PaperReferenceIdentity,
  PaperReferenceKind,
  SystemRecordIdentity,
} from '@/backend/core/paperReferenceContracts';

export function paperLinkedIdentity(
  system: SystemRecordIdentity,
  papers: PaperReferenceIdentity[]
): PaperLinkedIdentityContract {
  return { system, papers };
}

export interface VehicleVisitIdentitySource {
  id: bigint | number | string;
  visit_number?: string | null;
  raw_milk_dispatch_note_number?: string | null;
  token_number?: string | null;
}

/** Provides one unambiguous identity contract for a plant vehicle visit. */
export function vehicleVisitPaperIdentity(
  visit: VehicleVisitIdentitySource
): PaperLinkedIdentityContract {
  return paperLinkedIdentity(
    {
      entity: 'vehicle_visit',
      id: String(visit.id),
      number: visit.visit_number ?? null,
    },
    [
      { type: 'RAW_MILK_DISPATCH_NOTE', value: visit.raw_milk_dispatch_note_number ?? null },
      { type: 'PLANT_GATE_TOKEN', value: visit.token_number ?? null },
    ]
  );
}
