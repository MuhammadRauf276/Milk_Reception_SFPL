/**
 * The one place raw SQL turns stored times into Pakistan time.
 *
 * Today timestamp columns have no time zone and hold UTC, so SQL must first say "this is UTC" and then convert.
 * When the columns become "timestamp with time zone" (planned), set DB_TIMESTAMPS_HAVE_TZ to true and every raw
 * query below follows; Prisma queries need no change.
 */
import { Prisma } from '@prisma/client';

export const DB_TIMESTAMPS_HAVE_TZ: boolean = false;

/** SQL text: a stored time column as Pakistan local time (a timestamp without zone, for ::date, EXTRACT, to_char). */
export function pkLocalSql(col: string): string {
  return DB_TIMESTAMPS_HAVE_TZ
    ? `((${col}) AT TIME ZONE 'Asia/Karachi')`
    : `((${col}) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Karachi')`;
}

/** The same as pkLocalSql, ready to place inside Prisma.sql`...`. */
export function pkLocal(col: string): Prisma.Sql {
  return Prisma.raw(pkLocalSql(col));
}

/** SQL text: an instant parameter (e.g. $1 given as an ISO string) in the form stored columns can be compared with. */
export function storedInstantParamSql(param: string): string {
  return DB_TIMESTAMPS_HAVE_TZ ? `(${param}::timestamptz)` : `(${param}::timestamptz AT TIME ZONE 'UTC')`;
}

/** SQL text: the database's "now" in the stored form, for raw INSERT / UPDATE. */
export function storedNowSql(): string {
  return DB_TIMESTAMPS_HAVE_TZ ? 'NOW()' : `(NOW() AT TIME ZONE 'UTC')`;
}
