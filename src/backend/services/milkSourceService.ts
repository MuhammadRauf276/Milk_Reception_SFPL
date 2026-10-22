import { prisma } from '@core/db';

export interface AvailableSourceDto {
  id: string;
  erp_code?: string;
  name: string;
  displayLabel: string;
}

/** Roles allowed to see ERP codes and to create/edit milk sources and contractor ERP codes. */
export const SOURCE_OWNER_ROLES = ['HEAD_OF_MPD', 'SUPER_ADMIN', 'DATA_EXECUTIVE'] as const;

export function isSourceOwnerRole(role: string | null | undefined): boolean {
  return !!role && (SOURCE_OWNER_ROLES as readonly string[]).includes(role);
}

/**
 * Removes erp_code (and the "[code] name" label) from a source-shaped object unless the
 * caller role is one of the source owner roles. Field roles only ever see the name.
 */
export function stripErpForRole<T extends { erp_code?: unknown; name?: string; displayLabel?: string }>(
  role: string | null | undefined,
  item: T
): T {
  if (isSourceOwnerRole(role)) return item;
  const copy: T = { ...item };
  delete (copy as { erp_code?: unknown }).erp_code;
  if ('displayLabel' in copy && typeof copy.name === 'string') {
    (copy as { displayLabel?: string }).displayLabel = copy.name;
  }
  return copy;
}

/**
 * Returns all active milk sources assigned (visible) to a specific ZMCC.
 * Owner roles get "[Code] Name" labels; every other role gets the name only.
 */
export async function getAvailableSourcesForZmcc(
  zmccId: string | number | bigint,
  role?: string | null
): Promise<AvailableSourceDto[]> {
  const zId = BigInt(zmccId);

  const visibilities = await prisma.milkSourceZmccVisibility.findMany({
    where: {
      zmcc_id: zId,
      is_active: true,
      milk_source: { is_active: true },
    },
    include: { milk_source: true },
    orderBy: { milk_source: { name: 'asc' } },
  });

  const rows = visibilities.map((v) => ({
    id: v.milk_source.id.toString(),
    erp_code: v.milk_source.erp_code,
    name: v.milk_source.name,
    displayLabel: `[${v.milk_source.erp_code}] ${v.milk_source.name}`,
  }));
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows.map((r) => stripErpForRole(role, r));
}
