// Record numbers that never skip.
//
// A number is given only when the record is really saved: one above the highest number already in use for the
// same prefix, taken inside the same transaction as the insert. So:
//   - a draft or an opened form uses up nothing;
//   - a submit that fails gives its number back (the transaction is undone, and with it the number);
//   - two people saving at the same moment wait for each other and get consecutive numbers.
//
// A database sequence cannot do this: a sequence value, once taken, is never returned, so every failed submit
// leaves a hole. That is why these numbers do not use sequences.
import { Prisma } from '@prisma/client';

/** The columns that hold a numbered series. Nothing else can be passed in, so no name ever comes from a request. */
const SERIES = {
  MOT_JOURNEY: { table: 'mot_journey', column: 'journey_number' },
  MOT_COLLECTION: { table: 'mot_shop_collection', column: 'collection_number' },
  ZMCC_MOT_TOKEN: { table: 'zmcc_mot_arrival', column: 'zmcc_token' },
  ZMCC_HC_TOKEN: { table: 'zmcc_local_supplier_arrival', column: 'zmcc_token' },
  HC_SUPPLIER_CODE: { table: 'zmcc_local_supplier', column: 'local_supplier_code' },
  SHOP_CODE: { table: 'zmcc_shop', column: 'shop_code' },
  ROUTE_CODE: { table: 'zmcc_route', column: 'route_code' },
  AREA_CODE: { table: 'zmcc_area', column: 'area_code' },
} as const;

export type NumberSeries = keyof typeof SERIES;

/** `prefix` then the number, zero-padded: ("MJ-20261115-", 6, 4) gives "MJ-20261115-0006". */
export function formatSeriesNumber(prefix: string, n: number, pad: number): string {
  return `${prefix}${String(n).padStart(pad, '0')}`;
}

/**
 * The highest number in use for a prefix, from a list of existing values. Values that are not exactly
 * prefix + digits are ignored (a draft id, a hand-typed code, another day's number).
 */
export function highestInSeries(prefix: string, existing: ReadonlyArray<string | null | undefined>): number {
  let highest = 0;
  for (const value of existing) {
    if (!value || !value.startsWith(prefix)) continue;
    const rest = value.slice(prefix.length);
    if (/^\d+$/.test(rest)) highest = Math.max(highest, Number(rest));
  }
  return highest;
}

/**
 * The next number of a series, for use inside the transaction that inserts the record.
 * The lock is held until that transaction ends, so the number cannot be given twice.
 */
export async function nextSeriesNumber(
  tx: Prisma.TransactionClient,
  series: NumberSeries,
  prefix: string,
  pad: number
): Promise<string> {
  const { table, column } = SERIES[series];
  // One at a time per series and prefix (for example per day): others wait here until this record is saved.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`series:${series}:${prefix}`}))`;

  const col = Prisma.raw(`"${column}"`);
  // The positions are cast to int on purpose: sent as plain text, the database would read them as a search
  // pattern, find nothing, and every record would get number 1.
  const rows = await tx.$queryRaw<Array<{ highest: bigint | number | null }>>(Prisma.sql`
    SELECT MAX(CASE WHEN SUBSTR(${col}, ${prefix.length + 1}::int) ~ '^[0-9]+$'
                    THEN SUBSTR(${col}, ${prefix.length + 1}::int)::bigint END) AS highest
    FROM ${Prisma.raw(`"${table}"`)}
    WHERE LEFT(${col}, ${prefix.length}::int) = ${prefix}`);
  const highest = rows[0]?.highest == null ? 0 : Number(rows[0].highest);
  return formatSeriesNumber(prefix, highest + 1, pad);
}
