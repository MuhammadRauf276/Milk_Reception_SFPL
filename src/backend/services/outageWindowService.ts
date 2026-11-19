/**
 * Outage windows and the 3-day limit on entered times.
 *
 * Any user may enter a time up to 3 days earlier than now (ordinary typing delay, a missed entry on the last shift).
 * Older times are refused unless the Super Admin has opened an outage window that covers that time and that station,
 * and its catch-up deadline has not passed. Entries that fall inside a window are listed as "Entered late (outage)"
 * through audit_log rows (table 'outage_window', action 'LATE_ENTRY'); nothing is copied into the records themselves.
 */
import type { OutageWindow, Prisma } from '@prisma/client';
import { prisma } from '@core/db';
import { auditActorFromUser, writeAuditLog, type AuditActor } from '@/backend/core/audit';
import type { ActingContext } from '@/types/acting';
import { FUTURE_ALLOWANCE_MS } from '@/backend/services/chronology-validator';

export const PAST_LIMIT_DAYS = 3;
export const PAST_LIMIT_MS = PAST_LIMIT_DAYS * 24 * 60 * 60 * 1000;
export const PAST_LIMIT_MESSAGE = 'This time is more than 3 days ago. Ask the Super Admin to open an outage window.';
export const DEFAULT_CATCH_UP_HOURS = 48;
export const MAX_CATCH_UP_DAYS = 7;
/** An entry typed in at least this long after it happened counts as entered late. */
const LATE_AFTER_MS = FUTURE_ALLOWANCE_MS;

export const PLANT_STATIONS = ['GATE', 'WEIGHBRIDGE', 'QA', 'PRODUCTION'] as const;
export type PlantStation = (typeof PLANT_STATIONS)[number];
export const PLANT_STATION_LABELS: Record<PlantStation, string> = {
  GATE: 'Plant gate',
  WEIGHBRIDGE: 'Weighbridge',
  QA: 'Plant QA',
  PRODUCTION: 'Production',
};

export type OutageStation = { plant: PlantStation } | { zmccId: bigint | string | number };

export interface LateEntryInfo {
  /** What was entered, e.g. "Gate entry", "HC arrival". */
  step: string;
  recordTable: string;
  recordId: bigint | string | number | null;
  /** Who entered it: an acting context, an audit actor, or a user row with id and role. */
  actor: AuditActor | ActingContext | { id: bigint | string; role: string };
}

type Db = Pick<Prisma.TransactionClient, 'outageWindow' | 'auditLog'>;

export function windowCovers(w: Pick<OutageWindow, 'all_stations' | 'plant_stations' | 'zmcc_ids'>, station: OutageStation): boolean {
  if (w.all_stations) return true;
  if ('plant' in station) return w.plant_stations.includes(station.plant);
  const id = BigInt(station.zmccId);
  return w.zmcc_ids.some((z) => z === id);
}

export function windowOpen(w: Pick<OutageWindow, 'closed_at' | 'catch_up_until'>, now: Date = new Date()): boolean {
  return !w.closed_at && w.catch_up_until.getTime() >= now.getTime();
}

function stationJson(station: OutageStation) {
  return 'plant' in station ? { plant: station.plant } : { zmcc_id: String(station.zmccId) };
}

export type EnteredTimeCheck =
  | { error: string }
  | {
      window: OutageWindow | null;
      /**
       * Call after the entry is saved (outside its transaction): notes it on the window's Late entries list.
       * Does nothing without a window, and never throws.
       */
      record: (info: LateEntryInfo, db?: Db) => Promise<void>;
    };

/**
 * Checks an entered time against the 3-day limit and the open outage windows for this station.
 * A time that is not older than a few minutes needs no database read.
 */
export async function checkEnteredTime(
  at: Date,
  station: OutageStation,
  opts: { now?: Date; db?: Db } = {}
): Promise<EnteredTimeCheck> {
  const now = opts.now ?? new Date();
  const db = opts.db ?? prisma;
  const age = now.getTime() - at.getTime();
  const noop = { window: null, record: async () => {} };
  if (Number.isNaN(age) || age < LATE_AFTER_MS) return noop;

  const candidates = await db.outageWindow.findMany({
    where: { closed_at: null, catch_up_until: { gte: now }, starts_at: { lte: at }, ends_at: { gte: at } },
    orderBy: { id: 'asc' },
  });
  const window = candidates.find((w) => windowCovers(w, station)) ?? null;

  if (!window) {
    return age > PAST_LIMIT_MS ? { error: PAST_LIMIT_MESSAGE } : noop;
  }

  return {
    window,
    record: async (info, recordDb) => {
      try {
        const actor = 'id' in info.actor ? auditActorFromUser(info.actor) : info.actor;
        await writeAuditLog(recordDb ?? prisma, {
          tableName: 'outage_window',
          recordId: window.id,
          action: 'LATE_ENTRY',
          newValues: {
            step: info.step,
            record_table: info.recordTable,
            record_id: info.recordId == null ? null : String(info.recordId),
            station: stationJson(station),
            happened_at: at.toISOString(),
            entered_at: now.toISOString(),
          },
          actor,
        });
      } catch (err) {
        // The entry itself is saved; a missing list row must not fail the user's work.
        console.error('Could not note a late entry on its outage window:', err);
      }
    },
  };
}

/** For HTTP handlers: the 400 answer when the time is refused, or null. */
export function enteredTimeError(check: EnteredTimeCheck): string | null {
  return 'error' in check ? check.error : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Super Admin: open, list and close windows

export interface OutageWindowInput {
  starts_at?: unknown;
  ends_at?: unknown;
  all_stations?: unknown;
  plant_stations?: unknown;
  zmcc_ids?: unknown;
  reason?: unknown;
  catch_up_hours?: unknown;
}

type Result<T> = { data: T; error?: undefined; status?: undefined } | { data?: undefined; error: string; status: number };

function toDate(v: unknown): Date | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Checks a new window. Pure, so it can be tested without a database. */
export function parseOutageWindowInput(
  body: OutageWindowInput,
  now: Date = new Date()
): { error: string } | {
  starts_at: Date;
  ends_at: Date;
  all_stations: boolean;
  plant_stations: PlantStation[];
  zmcc_ids: bigint[];
  reason: string;
  catch_up_until: Date;
} {
  const starts = toDate(body.starts_at);
  const ends = toDate(body.ends_at);
  if (!starts || !ends) return { error: 'Enter when the outage started and ended.' };
  if (ends.getTime() <= starts.getTime()) return { error: 'The outage must end after it starts.' };
  if (ends.getTime() > now.getTime() + FUTURE_ALLOWANCE_MS) return { error: 'The outage end cannot be in the future.' };

  const all = body.all_stations === true;
  const plant = Array.isArray(body.plant_stations)
    ? [...new Set(body.plant_stations.filter((s): s is PlantStation => PLANT_STATIONS.includes(s as PlantStation)))]
    : [];
  let zmccIds: bigint[] = [];
  try {
    zmccIds = Array.isArray(body.zmcc_ids) ? [...new Set(body.zmcc_ids.map((z) => String(z)))].map((z) => BigInt(z)) : [];
  } catch {
    return { error: 'A chosen ZMCC is not valid.' };
  }
  if (!all && plant.length === 0 && zmccIds.length === 0) return { error: 'Choose the stations the outage covered.' };

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 5) return { error: 'Enter the reason for the outage.' };
  if (reason.length > 500) return { error: 'Keep the reason under 500 characters.' };

  const hours = body.catch_up_hours == null || body.catch_up_hours === '' ? DEFAULT_CATCH_UP_HOURS : Number(body.catch_up_hours);
  if (!Number.isFinite(hours) || hours < 1 || hours > MAX_CATCH_UP_DAYS * 24) {
    return { error: `Catch-up time must be 1 hour to ${MAX_CATCH_UP_DAYS} days.` };
  }
  const catchUpUntil = new Date(ends.getTime() + Math.round(hours) * 60 * 60 * 1000);
  if (catchUpUntil.getTime() <= now.getTime()) return { error: 'The catch-up time has already passed. Give a longer catch-up time.' };

  return {
    starts_at: starts,
    ends_at: ends,
    all_stations: all,
    plant_stations: all ? [] : plant,
    zmcc_ids: all ? [] : zmccIds,
    reason,
    catch_up_until: catchUpUntil,
  };
}

export interface OutageWindowRow {
  id: string;
  starts_at: string;
  ends_at: string;
  catch_up_until: string;
  closed_at: string | null;
  status: 'OPEN' | 'CLOSED' | 'ENDED';
  reason: string;
  all_stations: boolean;
  stations: string[];
  opened_by: string | null;
  closed_by: string | null;
  late_entries: number;
}

async function stationNames(windows: OutageWindow[]): Promise<Map<string, string>> {
  const ids = [...new Set(windows.flatMap((w) => w.zmcc_ids.map(String)))];
  if (ids.length === 0) return new Map();
  const sources = await prisma.procurementSource.findMany({
    where: { id: { in: ids.map((i) => BigInt(i)) } },
    select: { id: true, name: true },
  });
  return new Map(sources.map((s) => [String(s.id), s.name]));
}

async function userNames(ids: Array<bigint | null>): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((i): i is bigint => i != null).map(String))];
  if (list.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: list.map((i) => BigInt(i)) } },
    select: { id: true, full_name: true, username: true },
  });
  return new Map(users.map((u) => [String(u.id), u.full_name || u.username]));
}

export async function listOutageWindows(now: Date = new Date()): Promise<OutageWindowRow[]> {
  const windows = await prisma.outageWindow.findMany({ orderBy: { starts_at: 'desc' }, take: 200 });
  if (windows.length === 0) return [];
  const [names, users, counts] = await Promise.all([
    stationNames(windows),
    userNames(windows.flatMap((w) => [w.created_by, w.closed_by])),
    prisma.auditLog.groupBy({
      by: ['record_id'],
      where: { table_name: 'outage_window', action: 'LATE_ENTRY', record_id: { in: windows.map((w) => w.id) } },
      _count: { _all: true },
    }),
  ]);
  const countBy = new Map(counts.map((c) => [String(c.record_id), c._count._all]));
  return windows.map((w) => ({
    id: String(w.id),
    starts_at: w.starts_at.toISOString(),
    ends_at: w.ends_at.toISOString(),
    catch_up_until: w.catch_up_until.toISOString(),
    closed_at: w.closed_at ? w.closed_at.toISOString() : null,
    status: w.closed_at ? 'CLOSED' : windowOpen(w, now) ? 'OPEN' : 'ENDED',
    reason: w.reason,
    all_stations: w.all_stations,
    stations: w.all_stations
      ? ['All stations']
      : [
          ...w.plant_stations.map((s) => PLANT_STATION_LABELS[s as PlantStation] ?? s),
          ...w.zmcc_ids.map((z) => names.get(String(z)) ?? `ZMCC ${z}`),
        ],
    opened_by: users.get(String(w.created_by)) ?? null,
    closed_by: w.closed_by ? users.get(String(w.closed_by)) ?? null : null,
    late_entries: countBy.get(String(w.id)) ?? 0,
  }));
}

export async function openOutageWindow(acting: ActingContext, body: OutageWindowInput): Promise<Result<{ id: string }>> {
  const parsed = parseOutageWindowInput(body);
  if ('error' in parsed) return { error: parsed.error, status: 400 };
  if (parsed.zmcc_ids.length > 0) {
    const found = await prisma.procurementSource.count({ where: { id: { in: parsed.zmcc_ids }, source_type: 'ZMCC' } });
    if (found !== parsed.zmcc_ids.length) return { error: 'A chosen ZMCC was not found.', status: 400 };
  }
  const created = await prisma.$transaction(async (tx) => {
    const w = await tx.outageWindow.create({ data: { ...parsed, created_by: acting.userId } });
    await writeAuditLog(tx, {
      tableName: 'outage_window',
      recordId: w.id,
      action: 'OPEN',
      newValues: {
        starts_at: w.starts_at.toISOString(),
        ends_at: w.ends_at.toISOString(),
        all_stations: w.all_stations,
        plant_stations: w.plant_stations,
        zmcc_ids: w.zmcc_ids.map(String),
        reason: w.reason,
        catch_up_until: w.catch_up_until.toISOString(),
      },
      actor: acting,
    });
    return w;
  });
  return { data: { id: String(created.id) } };
}

/** Ends catch-up now. Entries already made stay on the list. */
export async function closeOutageWindow(acting: ActingContext, id: string): Promise<Result<{ id: string }>> {
  let windowId: bigint;
  try {
    windowId = BigInt(id);
  } catch {
    return { error: 'Window not found.', status: 404 };
  }
  const w = await prisma.outageWindow.findUnique({ where: { id: windowId } });
  if (!w) return { error: 'Window not found.', status: 404 };
  if (w.closed_at) return { error: 'This window is already closed.', status: 409 };
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.outageWindow.update({ where: { id: windowId }, data: { closed_at: now, closed_by: acting.userId } });
    await writeAuditLog(tx, {
      tableName: 'outage_window',
      recordId: windowId,
      action: 'CLOSE',
      oldValues: { catch_up_until: w.catch_up_until.toISOString() },
      newValues: { closed_at: now.toISOString() },
      actor: acting,
    });
  });
  return { data: { id } };
}

export interface LateEntryRow {
  id: string;
  step: string;
  station: string;
  record_table: string;
  record_id: string | null;
  happened_at: string | null;
  entered_at: string;
  entered_by: string | null;
}

export async function listLateEntries(id: string): Promise<Result<LateEntryRow[]>> {
  let windowId: bigint;
  try {
    windowId = BigInt(id);
  } catch {
    return { error: 'Window not found.', status: 404 };
  }
  const rows = await prisma.auditLog.findMany({
    where: { table_name: 'outage_window', action: 'LATE_ENTRY', record_id: windowId },
    orderBy: { created_at: 'desc' },
    take: 1000,
  });
  const values = rows.map((r) => (r.new_values ?? {}) as Record<string, unknown>);
  const zmccIds = [...new Set(values.map((v) => (v.station as { zmcc_id?: string } | undefined)?.zmcc_id).filter((z): z is string => !!z))];
  const [sources, users] = await Promise.all([
    zmccIds.length
      ? prisma.procurementSource.findMany({ where: { id: { in: zmccIds.map((z) => BigInt(z)) } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    userNames(rows.map((r) => r.user_id)),
  ]);
  const sourceName = new Map(sources.map((s) => [String(s.id), s.name]));
  return {
    data: rows.map((r, i) => {
      const v = values[i];
      const st = (v.station ?? {}) as { plant?: string; zmcc_id?: string };
      return {
        id: String(r.id),
        step: String(v.step ?? ''),
        station: st.plant
          ? PLANT_STATION_LABELS[st.plant as PlantStation] ?? st.plant
          : st.zmcc_id
            ? sourceName.get(st.zmcc_id) ?? `ZMCC ${st.zmcc_id}`
            : '',
        record_table: String(v.record_table ?? ''),
        record_id: v.record_id == null ? null : String(v.record_id),
        happened_at: typeof v.happened_at === 'string' ? v.happened_at : null,
        entered_at: typeof v.entered_at === 'string' ? v.entered_at : r.created_at.toISOString(),
        entered_by: r.user_id ? users.get(String(r.user_id)) ?? null : null,
      };
    }),
  };
}

/**
 * The "Entered late (outage)" tag for records shown on Inspect: which of these records were noted on a window.
 * Returns the window id per record id.
 */
export async function lateEntryTags(recordTable: string, recordIds: Array<bigint | string>): Promise<Map<string, string>> {
  const ids = [...new Set(recordIds.map(String))];
  if (ids.length === 0) return new Map();
  const rows = await prisma.auditLog.findMany({
    where: {
      table_name: 'outage_window',
      action: 'LATE_ENTRY',
      AND: [
        { new_values: { path: ['record_table'], equals: recordTable } },
        { OR: ids.map((id) => ({ new_values: { path: ['record_id'], equals: id } })) },
      ],
    },
    select: { record_id: true, new_values: true },
  });
  const out = new Map<string, string>();
  for (const r of rows) {
    const rid = (r.new_values as { record_id?: string } | null)?.record_id;
    if (rid) out.set(rid, String(r.record_id));
  }
  return out;
}

/** After a save: notes the entry on its window's Late entries list when the check found one. Never throws. */
export async function noteLateEntry(check: EnteredTimeCheck | null | undefined, info: LateEntryInfo): Promise<void> {
  if (check && !('error' in check) && check.window) await check.record(info);
}
