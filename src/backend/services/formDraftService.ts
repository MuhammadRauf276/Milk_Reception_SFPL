// Private drafts for the stage forms. A draft holds typed values and photo ids only: it is never a result and never
// carries a decision. Submitting still goes through the normal server routes, which judge everything again.
// The functions take the database as a parameter so the rules can be tested without one.

/** Drafts untouched for this many days are ignored and removed. */
export const DRAFT_EXPIRY_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export const DRAFT_FORM_TYPES = ['PLANT_QA', 'ZMCC_LAB_MC', 'ZMCC_LAB_HC', 'DISPATCH', 'ZMCC_DISPATCH', 'CONTRACTOR_DISPATCH', 'MOT_SHOP'] as const;
export type DraftFormType = (typeof DRAFT_FORM_TYPES)[number];
/** The forms that share one dispatch work item. */
export const DISPATCH_DRAFT_TYPES: readonly DraftFormType[] = ['DISPATCH', 'ZMCC_DISPATCH', 'CONTRACTOR_DISPATCH'];

export interface DraftContent {
  /** test id -> typed value */
  values: Record<string, string>;
  /** test id -> captured photo id */
  photos: Record<string, string>;
  remarks: string;
}

export interface DraftKey {
  formType: DraftFormType;
  scopeId: bigint;
  portionKey: string;
  userId: bigint;
}

export interface DraftRow {
  id: bigint;
  form_type: string;
  scope_id: bigint;
  portion_key: string;
  user_id: bigint;
  content: unknown;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface DraftDb {
  formDraft: {
    findUnique(args: { where: { form_type_scope_id_portion_key_user_id: { form_type: string; scope_id: bigint; portion_key: string; user_id: bigint } } }): Promise<DraftRow | null>;
    findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, 'asc' | 'desc'> }): Promise<DraftRow[]>;
    create(args: { data: Omit<DraftRow, 'id'> }): Promise<DraftRow>;
    /** Updates only if the row still has this version. count 0 means someone saved first. */
    updateMany(args: { where: { id: bigint; version: number }; data: Partial<Omit<DraftRow, 'id'>> }): Promise<{ count: number }>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  };
  user: {
    findMany(args: { where: { id: { in: bigint[] } } }): Promise<Array<{ id: bigint; full_name: string | null; username: string }>>;
  };
}

export interface DraftView {
  version: number;
  content: DraftContent;
  updatedAt: string;
}

export class DraftError extends Error {
  constructor(
    public status: number,
    public code: 'BAD_DRAFT' | 'DRAFT_STALE',
    message: string,
    public current?: DraftView,
  ) {
    super(message);
  }
}

export interface ColleagueNotice {
  name: string;
  startedAt: string;
}

const MAX_KEYS = 200;
const MAX_VALUE_LEN = 2000;
const MAX_KEY_LEN = 64;

export function emptyContent(): DraftContent {
  return { values: {}, photos: {}, remarks: '' };
}

function cleanMap(raw: unknown, what: string): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new DraftError(400, 'BAD_DRAFT', `Draft ${what} must be an object.`);
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_KEYS) throw new DraftError(400, 'BAD_DRAFT', `Draft ${what} has too many entries.`);
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (k.length === 0 || k.length > MAX_KEY_LEN) throw new DraftError(400, 'BAD_DRAFT', `Draft ${what} has an invalid key.`);
    if (typeof v !== 'string' || v.length > MAX_VALUE_LEN) throw new DraftError(400, 'BAD_DRAFT', `Draft ${what} values must be short text.`);
    out[k] = v;
  }
  return out;
}

/** Accepts only values, photos and remarks. Anything else (a decision, a result flag) is refused, not stored. */
export function sanitizeDraftContent(raw: unknown): DraftContent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new DraftError(400, 'BAD_DRAFT', 'Draft content must be an object.');
  const r = raw as Record<string, unknown>;
  const extra = Object.keys(r).filter((k) => k !== 'values' && k !== 'photos' && k !== 'remarks');
  if (extra.length > 0) throw new DraftError(400, 'BAD_DRAFT', 'A draft can only hold typed values, photos and remarks.');
  const remarks = r.remarks === undefined || r.remarks === null ? '' : r.remarks;
  if (typeof remarks !== 'string' || remarks.length > MAX_VALUE_LEN) throw new DraftError(400, 'BAD_DRAFT', 'Draft remarks must be short text.');
  return { values: cleanMap(r.values, 'values'), photos: cleanMap(r.photos, 'photos'), remarks };
}

function storedContent(raw: unknown): DraftContent {
  try {
    return sanitizeDraftContent(raw);
  } catch {
    return emptyContent();
  }
}

/** Incoming values win, except an empty value never replaces a value that is already there. */
export function mergeDraftContent(existing: DraftContent, incoming: DraftContent): DraftContent {
  const mergeMap = (a: Record<string, string>, b: Record<string, string>) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
      if (v.trim() === '' && (out[k] ?? '').trim() !== '') continue;
      out[k] = v;
    }
    return out;
  };
  return {
    values: mergeMap(existing.values, incoming.values),
    photos: mergeMap(existing.photos, incoming.photos),
    remarks: incoming.remarks.trim() === '' && existing.remarks.trim() !== '' ? existing.remarks : incoming.remarks,
  };
}

export function isExpired(row: Pick<DraftRow, 'updated_at'>, now: Date): boolean {
  return now.getTime() - row.updated_at.getTime() > DRAFT_EXPIRY_DAYS * DAY_MS;
}

const uniqueWhere = (k: DraftKey) => ({
  form_type_scope_id_portion_key_user_id: { form_type: k.formType, scope_id: k.scopeId, portion_key: k.portionKey, user_id: k.userId },
});

const view = (row: DraftRow): DraftView => ({ version: row.version, content: storedContent(row.content), updatedAt: row.updated_at.toISOString() });

/** Removes every expired draft. Called on read and write, because no scheduled job exists to call it. */
export async function purgeExpiredDrafts(db: DraftDb, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DRAFT_EXPIRY_DAYS * DAY_MS);
  return (await db.formDraft.deleteMany({ where: { updated_at: { lt: cutoff } } })).count;
}

/** The caller's own draft for this portion, plus who else started one. Colleague values are never returned. */
export async function loadDraft(
  db: DraftDb,
  key: DraftKey,
  now: Date = new Date(),
): Promise<{ draft: DraftView | null; colleagues: ColleagueNotice[] }> {
  await purgeExpiredDrafts(db, now);
  const own = await db.formDraft.findUnique({ where: uniqueWhere(key) });
  const ownLive = own && !isExpired(own, now) ? own : null;

  const others = (
    await db.formDraft.findMany({
      where: { form_type: key.formType, scope_id: key.scopeId, portion_key: key.portionKey, user_id: { not: key.userId } },
      orderBy: { created_at: 'asc' },
    })
  ).filter((r) => !isExpired(r, now));
  const users = others.length > 0 ? await db.user.findMany({ where: { id: { in: others.map((r) => r.user_id) } } }) : [];
  const nameOf = new Map(users.map((u) => [u.id.toString(), u.full_name || u.username]));
  const colleagues = others.map((r) => ({ name: nameOf.get(r.user_id.toString()) ?? 'A colleague', startedAt: r.created_at.toISOString() }));

  return { draft: ownLive ? view(ownLive) : null, colleagues };
}

/**
 * Saves the caller's own draft. `baseVersion` is the version the form last loaded (null for none).
 * If another device saved since, the save is refused with the newer draft so the form can reload it.
 */
export async function saveDraft(
  db: DraftDb,
  key: DraftKey,
  rawContent: unknown,
  baseVersion: number | null,
  now: Date = new Date(),
): Promise<DraftView> {
  const incoming = sanitizeDraftContent(rawContent);
  await purgeExpiredDrafts(db, now);
  let existing = await db.formDraft.findUnique({ where: uniqueWhere(key) });
  if (!existing) {
    try {
      const created = await db.formDraft.create({
        data: {
          form_type: key.formType,
          scope_id: key.scopeId,
          portion_key: key.portionKey,
          user_id: key.userId,
          content: mergeDraftContent(emptyContent(), incoming),
          version: 1,
          created_at: now,
          updated_at: now,
        },
      });
      return view(created);
    } catch (e) {
      // Another device created the same draft a moment earlier: carry on as an update of that row.
      if (!isUniqueViolation(e)) throw e;
      existing = await db.formDraft.findUnique({ where: uniqueWhere(key) });
      if (!existing) throw e;
    }
  }
  if (baseVersion !== existing.version) throw staleError(existing);
  // The version is part of the update condition, so two saves from the same version cannot both win.
  const { count } = await db.formDraft.updateMany({
    where: { id: existing.id, version: existing.version },
    data: { content: mergeDraftContent(storedContent(existing.content), incoming), version: existing.version + 1, updated_at: now },
  });
  const latest = await db.formDraft.findUnique({ where: uniqueWhere(key) });
  if (count === 0) {
    if (!latest) throw new DraftError(409, 'DRAFT_STALE', STALE_MESSAGE);
    throw staleError(latest);
  }
  if (!latest) throw new DraftError(409, 'DRAFT_STALE', STALE_MESSAGE);
  return view(latest);
}

const STALE_MESSAGE = 'This draft was changed on another device. It has been reloaded with the latest values.';
const staleError = (row: DraftRow) => new DraftError(409, 'DRAFT_STALE', STALE_MESSAGE, view(row));
const isUniqueViolation = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';

/** Deletes the caller's own draft only. */
export async function deleteOwnDraft(db: DraftDb, key: DraftKey): Promise<void> {
  await db.formDraft.deleteMany({
    where: { form_type: key.formType, scope_id: key.scopeId, portion_key: key.portionKey, user_id: key.userId },
  });
}

/** After a portion is finally submitted (or its visit closed) nobody's draft for it is needed any more. */
export async function clearDraftsForPortion(db: DraftDb, formType: DraftFormType, scopeId: bigint, portionKey: string): Promise<number> {
  return (await db.formDraft.deleteMany({ where: { form_type: formType, scope_id: scopeId, portion_key: portionKey } })).count;
}

export async function clearDraftsForScope(db: DraftDb, formTypes: readonly DraftFormType[], scopeId: bigint): Promise<number> {
  return (await db.formDraft.deleteMany({ where: { form_type: { in: [...formTypes] }, scope_id: scopeId } })).count;
}

/** "14 Nov 2026, 3:12 PM" in Pakistan time, whatever the server clock zone is. */
export function formatKarachi(at: Date): string {
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', year: 'numeric' }).format(at);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', hour: 'numeric', minute: '2-digit', hour12: true }).format(at);
  return `${day}, ${time}`;
}

/** Text of the 409 a late submit gets: who decided and when. The submitter's own draft stays. */
export function alreadyDecidedMessage(by: string | null, at: Date | null): string {
  const who = by ? ` by ${by}` : '';
  const when = at ? ` at ${formatKarachi(at)}` : '';
  return `This portion was already decided${who}${when}. Your draft is kept.`;
}
