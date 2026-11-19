/**
 * The one place raw SQL turns stored times into Pakistan time.
 *
 * Time columns are "timestamp with time zone", so a stored time converts to Pakistan time in one step, whatever
 * the session's zone. (Before that switch they held UTC without a zone; DB_TIMESTAMPS_HAVE_TZ = false restores the
 * old SQL if ever needed.)
 */
import { Prisma } from '@prisma/client';

export const DB_TIMESTAMPS_HAVE_TZ: boolean = true;

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
