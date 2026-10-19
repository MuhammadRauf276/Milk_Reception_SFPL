import { prisma } from '@core/db';

export interface AvailableSourceDto {
  id: string;
  erp_code: string;
  name: string;
  displayLabel: string;
}

export interface CreateErpCodeRequestInput {
  zmcc_id: string | number | bigint;
  proposed_name: string;
  proposed_code?: string | null;
  request_context?: string | null;
  notes?: string | null;
}

/**
 * Returns all active ERP Milk Sources visible to a specific ZMCC.
 * Formatted as "[Code] Name".
 */
export async function getAvailableSourcesForZmcc(
  zmccId: string | number | bigint
): Promise<AvailableSourceDto[]> {
  const zId = BigInt(zmccId);

  // 1. Fetch through visibility junction table
  const visibilities = await prisma.milkSourceZmccVisibility.findMany({
    where: {
      zmcc_id: zId,
      is_active: true,
      milk_source: {
        is_active: true,
      },
    },
    include: {
      milk_source: true,
    },
    orderBy: {
      milk_source: {
        erp_code: 'asc',
      },
    },
  });

  const sourceMap = new Map<string, AvailableSourceDto>();

  for (const v of visibilities) {
    sourceMap.set(v.milk_source.id.toString(), {
      id: v.milk_source.id.toString(),
      erp_code: v.milk_source.erp_code,
      name: v.milk_source.name,
      displayLabel: `[${v.milk_source.erp_code}] ${v.milk_source.name}`,
    });
  }

  // 2. Safety fallback for any legacy direct link
  const directSources = await prisma.zmccMilkSource.findMany({
    where: {
      zmcc_id: zId,
      is_active: true,
    },
    orderBy: {
      erp_code: 'asc',
    },
  });

  for (const s of directSources) {
    if (!sourceMap.has(s.id.toString())) {
      sourceMap.set(s.id.toString(), {
        id: s.id.toString(),
        erp_code: s.erp_code,
        name: s.name,
        displayLabel: `[${s.erp_code}] ${s.name}`,
      });
    }
  }

  return Array.from(sourceMap.values()).sort((a, b) => a.erp_code.localeCompare(b.erp_code));
}

/**
 * Submits an ERP Code Request from the field (MOT or ZMCC Lab Attendant) to Finance.
 */
export async function createErpCodeRequest(
  actorUserId: bigint,
  input: CreateErpCodeRequestInput
) {
  const proposedName = input.proposed_name?.trim();
  if (!proposedName) {
    throw new Error('Proposed source name is required.');
  }

  const zmccId = BigInt(input.zmcc_id);
  const zmcc = await prisma.procurementSource.findUnique({
    where: { id: zmccId },
  });
  if (!zmcc || zmcc.source_type !== 'ZMCC') {
    throw new Error('Target procurement source is not a valid ZMCC.');
  }

  const created = await prisma.erpCodeRequest.create({
    data: {
      requested_by_id: actorUserId,
      zmcc_id: zmccId,
      proposed_name: proposedName,
      proposed_code: input.proposed_code?.trim() || null,
      request_context: input.request_context?.trim() || null,
      notes: input.notes?.trim() || null,
      status: 'PENDING',
    },
    include: {
      requested_by: {
        select: { id: true, username: true, full_name: true },
      },
      zmcc: {
        select: { id: true, code: true, name: true },
      },
    },
  });

  return {
    id: created.id.toString(),
    zmcc_id: created.zmcc_id.toString(),
    zmcc_code: created.zmcc.code,
    zmcc_name: created.zmcc.name,
    proposed_name: created.proposed_name,
    proposed_code: created.proposed_code,
    request_context: created.request_context,
    notes: created.notes,
    status: created.status,
    requested_by: {
      id: created.requested_by.id.toString(),
      username: created.requested_by.username,
      full_name: created.requested_by.full_name,
    },
    created_at: created.created_at.toISOString(),
  };
}
