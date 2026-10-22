import { prisma } from '@core/db';
import { writeAuditLog } from '@/backend/core/audit';
import { Prisma } from '@prisma/client';

export interface ErpSourceListItem {
  id: string;
  erp_code: string;
  name: string;
  is_active: boolean;
  zmcc_visibilities: Array<{
    zmcc_id: string;
    zmcc_code: string;
    zmcc_name: string;
    source_type?: string;
    is_active: boolean;
  }>;
  created_at: string;
  updated_at: string;
}

export interface ContractorListItem {
  id: string;
  code: string;
  erp_code: string | null;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Lists ERP Milk Sources along with their assigned ZMCC visibilities.
 */
export async function listErpSources(filters?: {
  is_active?: boolean;
  search?: string;
  zmcc_id?: string;
}): Promise<ErpSourceListItem[]> {
  const where: Prisma.ZmccMilkSourceWhereInput = {};

  if (filters?.is_active !== undefined) {
    where.is_active = filters.is_active;
  }

  if (filters?.search) {
    const s = filters.search.trim();
    where.OR = [
      { erp_code: { contains: s, mode: 'insensitive' } },
      { name: { contains: s, mode: 'insensitive' } },
    ];
  }

  if (filters?.zmcc_id) {
    const zId = BigInt(filters.zmcc_id);
    where.visibilities = {
      some: {
        zmcc_id: zId,
        is_active: true,
      },
    };
  }

  const sources = await prisma.zmccMilkSource.findMany({
    where,
    include: {
      visibilities: {
        include: {
          zmcc: true,
        },
      },
    },
    orderBy: { erp_code: 'asc' },
  });

  return sources.map((s) => ({
    id: s.id.toString(),
    erp_code: s.erp_code,
    name: s.name,
    is_active: s.is_active,
    zmcc_visibilities: s.visibilities.map((v) => ({
      zmcc_id: v.zmcc.id.toString(),
      zmcc_code: v.zmcc.code,
      zmcc_name: v.zmcc.name,
      source_type: v.zmcc.source_type,
      is_active: v.is_active,
    })),
    created_at: s.created_at.toISOString(),
    updated_at: s.updated_at.toISOString(),
  }));
}

/**
 * Creates an ERP Milk Source and binds visibility to selected ZMCCs.
 */
export async function createErpSource(
  actorUserId: bigint,
  data: {
    erp_code: string;
    name: string;
    zmcc_ids?: (string | number | bigint)[];
  },
  actorRole?: string | null
) {
  const erp_code = data.erp_code?.trim();
  const name = data.name?.trim();

  if (!erp_code) {
    throw new Error('ERP code is required.');
  }
  if (!name) {
    throw new Error('Source name is required.');
  }

  const existingCode = await prisma.zmccMilkSource.findUnique({
    where: { erp_code },
  });
  if (existingCode) {
    throw new Error(`ERP code "${erp_code}" already exists.`);
  }

  const zmccBigInts = (data.zmcc_ids ?? []).map((id) => BigInt(id));

  return await prisma.$transaction(async (tx) => {
    const created = await tx.zmccMilkSource.create({
      data: {
        erp_code,
        name,
        zmcc_id: zmccBigInts[0] ?? null,
        is_active: true,
        created_by: actorUserId,
      },
    });

    for (const zmccId of zmccBigInts) {
      await tx.milkSourceZmccVisibility.create({
        data: {
          milk_source_id: created.id,
          zmcc_id: zmccId,
          is_active: true,
        },
      });
    }

    await writeAuditLog(tx, {
      tableName: 'zmcc_milk_source',
      recordId: created.id,
      action: 'MILK_SOURCE_CREATED',
      newValues: {
        id: created.id.toString(),
        erp_code: created.erp_code,
        name: created.name,
        zmcc_ids: zmccBigInts.map((id) => id.toString()),
      },
      actor: { userId: actorUserId, actorRole: actorRole ?? null },
    });

    return created;
  });
}

/**
 * Updates an ERP Milk Source (name, status, and ZMCC multi-select visibility).
 */
export async function updateErpSource(
  actorUserId: bigint,
  id: string | number | bigint,
  data: {
    name?: string;
    erp_code?: string;
    is_active?: boolean;
    zmcc_ids?: (string | number | bigint)[];
  },
  actorRole?: string | null
) {
  const sourceId = BigInt(id);
  const existing = await prisma.zmccMilkSource.findUnique({
    where: { id: sourceId },
    include: { visibilities: true },
  });

  if (!existing) {
    throw new Error('Milk source not found.');
  }

  return await prisma.$transaction(async (tx) => {
    const updateData: Prisma.ZmccMilkSourceUpdateInput = {
      updater: { connect: { id: actorUserId } },
    };

    if (data.name !== undefined) {
      const trimmed = data.name.trim();
      if (!trimmed) throw new Error('Source name cannot be empty.');
      updateData.name = trimmed;
    }

    if (data.erp_code !== undefined) {
      const code = data.erp_code.trim();
      if (!code) throw new Error('ERP code cannot be empty.');
      if (code !== existing.erp_code) {
        const dup = await tx.zmccMilkSource.findUnique({ where: { erp_code: code } });
        if (dup && dup.id !== sourceId) throw new Error(`ERP code "${code}" already exists.`);
        updateData.erp_code = code;
      }
    }

    if (data.is_active !== undefined) {
      updateData.is_active = data.is_active;
    }

    const updated = await tx.zmccMilkSource.update({
      where: { id: sourceId },
      data: updateData,
    });

    if (data.zmcc_ids !== undefined) {
      const selectedZmccSet = new Set(data.zmcc_ids.map((z) => BigInt(z).toString()));

      // Deactivate unselected existing visibilities
      for (const v of existing.visibilities) {
        const strId = v.zmcc_id.toString();
        if (!selectedZmccSet.has(strId)) {
          await tx.milkSourceZmccVisibility.delete({
            where: { id: v.id },
          });
        }
      }

      // Add or reactivate selected
      for (const strId of selectedZmccSet) {
        const zmccBigInt = BigInt(strId);
        await tx.milkSourceZmccVisibility.upsert({
          where: {
            milk_source_id_zmcc_id: {
              milk_source_id: sourceId,
              zmcc_id: zmccBigInt,
            },
          },
          update: { is_active: true },
          create: {
            milk_source_id: sourceId,
            zmcc_id: zmccBigInt,
            is_active: true,
          },
        });
      }
    }

    await writeAuditLog(tx, {
      tableName: 'zmcc_milk_source',
      recordId: sourceId,
      action: 'MILK_SOURCE_UPDATED',
      oldValues: {
        name: existing.name,
        erp_code: existing.erp_code,
        is_active: existing.is_active,
        zmcc_ids: existing.visibilities.map((v) => v.zmcc_id.toString()),
      },
      newValues: {
        name: updated.name,
        erp_code: updated.erp_code,
        is_active: updated.is_active,
        zmcc_ids: data.zmcc_ids ? data.zmcc_ids.map((z) => z.toString()) : undefined,
      },
      actor: { userId: actorUserId, actorRole: actorRole ?? null },
    });

    return updated;
  });
}

/**
 * Lists all Plant Contractors.
 */
export async function listContractors(): Promise<ContractorListItem[]> {
  const contractors = await prisma.procurementSource.findMany({
    where: { source_type: 'CONTRACTOR' },
    orderBy: { code: 'asc' },
  });

  return contractors.map((c) => ({
    id: c.id.toString(),
    code: c.code,
    erp_code: c.erp_code,
    name: c.name,
    is_active: c.is_active,
    created_at: c.created_at.toISOString(),
    updated_at: c.updated_at.toISOString(),
  }));
}

/**
 * Assigns or updates the official ERP Code for a Plant Contractor.
 */
export async function updateContractorErpCode(
  actorUserId: bigint,
  contractorSourceId: string | number | bigint,
  erp_code: string,
  actorRole?: string | null
) {
  const contractorId = BigInt(contractorSourceId);
  const contractor = await prisma.procurementSource.findUnique({
    where: { id: contractorId },
  });

  if (!contractor || contractor.source_type !== 'CONTRACTOR') {
    throw new Error('Plant contractor not found.');
  }

  const trimmedCode = erp_code.trim();
  if (!trimmedCode) {
    throw new Error('ERP code is required for a contractor.');
  }

  return await prisma.$transaction(async (tx) => {
    const updated = await tx.procurementSource.update({
      where: { id: contractorId },
      data: { erp_code: trimmedCode },
    });

    await writeAuditLog(tx, {
      tableName: 'procurement_source',
      recordId: contractorId,
      action: 'CONTRACTOR_ERP_CODE_UPDATED',
      oldValues: { erp_code: contractor.erp_code },
      newValues: { erp_code: updated.erp_code },
      actor: { userId: actorUserId, actorRole: actorRole ?? null },
    });

    return {
      id: updated.id.toString(),
      code: updated.code,
      erp_code: updated.erp_code,
      name: updated.name,
    };
  });
}
