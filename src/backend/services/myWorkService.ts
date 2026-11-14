// An operator's previous work as light table rows. The full record is loaded only when a row is opened.
import { prisma } from '@/backend/core/db';
import { Prisma } from '@prisma/client';
import type { EditorEntity } from '@/lib/recordEditor';

/** An operator's own list never goes further back than this many days. */
export const MY_WORK_MAX_DAYS = 15;

export interface MyWorkRow {
  /** Opens the full record: journey-12, hc-5 or visit-9. */
  key: string;
  kind: 'JOURNEY' | 'HC' | 'VISIT';
  at: string;
  reference: string;
  detail: string;
  status: string | null;
  enteredBy: string | null;
}

interface SqlRow {
  kind: MyWorkRow['kind'];
  id: bigint;
  ts: Date;
  reference: string | null;
  detail: string | null;
  status: string | null;
  entered_by: string | null;
  total: number;
}

/** Roles that enter records themselves see the records they worked on. Everyone else sees their whole station. */
const OWN_WORK_ROLES = new Set([
  'MOT',
  'MDO',
  'PHE_OPERATOR',
  'ZMCC_LAB_ATTENDANT',
  'CONTRACTOR_OPERATOR',
  'SECURITY_OPERATOR',
  'WEIGHBRIDGE_OPERATOR',
  'PRODUCTION_RECEPTION_OPERATOR',
  'QA_LAB_ATTENDANT',
]);

export interface MyWorkFilters {
  userId: bigint;
  role: string;
  /** The stages this role enters (requestableEntities). */
  entities: readonly EditorEntity[];
  /** Own ZMCC or contractor, when the person has one. */
  sourceId?: bigint;
  days?: number;
  search?: string;
  page: number;
  pageSize: number;
}

/** Days asked for, kept between 1 and the 15-day limit. */
export function clampWorkDays(days: number | undefined | null): number {
  const n = Math.floor(Number(days));
  if (!Number.isFinite(n) || n < 1) return MY_WORK_MAX_DAYS;
  return Math.min(MY_WORK_MAX_DAYS, n);
}

/**
 * One row per journey, HC arrival or vehicle, newest first: only the stages the role enters,
 * only the person's own ZMCC or contractor, and never older than 15 days.
 */
export async function listMyWork(f: MyWorkFilters): Promise<{ rows: MyWorkRow[]; total: number; days: number }> {
  const days = clampWorkDays(f.days);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const like = f.search ? `%${f.search}%` : null;
  const me = f.userId;
  const own = OWN_WORK_ROLES.has(f.role);
  const role = f.role;
  const has = (...e: EditorEntity[]) => e.some((x) => f.entities.includes(x));
  const lab = has('LAB_PORTION', 'LAB_SESSION');
  const branches: Prisma.Sql[] = [];

  if (lab || has('MOT_COLLECTION', 'MC_ARRIVAL')) {
    const collected = Prisma.sql`EXISTS (SELECT 1 FROM mot_shop_collection c WHERE c.journey_id = j.id AND c.submitted_by_user_id = ${me})`;
    const received = Prisma.sql`(a.recorded_by_user_id = ${me} OR a.exit_recorded_by_user_id = ${me})`;
    const tested = Prisma.sql`EXISTS (SELECT 1 FROM zmcc_lab_session s WHERE s.mot_arrival_id = a.id AND (s.started_by_user_id = ${me} OR s.completed_by_user_id = ${me}))`;
    const mine = !own
      ? Prisma.sql`TRUE`
      : role === 'MOT'
        ? collected
        : role === 'PHE_OPERATOR'
          ? received
          : role === 'ZMCC_LAB_ATTENDANT'
            ? tested
            : Prisma.sql`(${collected} OR ${received})`;
    const scope = f.sourceId ? Prisma.sql`AND j.zmcc_id = ${f.sourceId}` : Prisma.empty;
    const match = like
      ? Prisma.sql`AND (j.journey_number ILIKE ${like} OR a.zmcc_token ILIKE ${like} OR a.raw_milk_token_number ILIKE ${like} OR a.route_milk_token ILIKE ${like})`
      : Prisma.empty;
    branches.push(Prisma.sql`
      SELECT 'JOURNEY' AS kind, j.id, COALESCE(a.arrival_timestamp, j.created_at) AS ts,
        j.journey_number::text AS reference, CONCAT_WS(' · ', r.name, a.zmcc_token) AS detail, j.status::text AS status,
        COALESCE(
          (SELECT COALESCE(u.full_name, u.username) FROM mot_shop_collection c JOIN users u ON u.id = c.submitted_by_user_id WHERE c.journey_id = j.id ORDER BY c.id LIMIT 1),
          (SELECT COALESCE(u.full_name, u.username) FROM users u WHERE u.id = a.recorded_by_user_id)
        ) AS entered_by
      FROM mot_journey j
        LEFT JOIN zmcc_mot_arrival a ON a.journey_id = j.id
        LEFT JOIN zmcc_route r ON r.id = j.route_id
      WHERE (a.id IS NOT NULL OR EXISTS (SELECT 1 FROM mot_shop_collection c WHERE c.journey_id = j.id))
        AND ${mine} ${scope} ${match}`);
  }

  if (lab || has('HC_ARRIVAL')) {
    const received = Prisma.sql`(h.recorded_by_user_id = ${me} OR h.exit_recorded_by_user_id = ${me})`;
    const tested = Prisma.sql`EXISTS (SELECT 1 FROM zmcc_lab_session s WHERE s.local_supplier_arrival_id = h.id AND (s.started_by_user_id = ${me} OR s.completed_by_user_id = ${me}))`;
    const mine = !own ? Prisma.sql`TRUE` : role === 'ZMCC_LAB_ATTENDANT' ? tested : received;
    const scope = f.sourceId ? Prisma.sql`AND h.zmcc_id = ${f.sourceId}` : Prisma.empty;
    const match = like
      ? Prisma.sql`AND (h.zmcc_token ILIKE ${like} OR h.raw_milk_token_number ILIKE ${like} OR h.rmr_number ILIKE ${like} OR h.vehicle_number ILIKE ${like})`
      : Prisma.empty;
    branches.push(Prisma.sql`
      SELECT 'HC' AS kind, h.id, h.arrival_timestamp AS ts,
        h.zmcc_token::text AS reference, CONCAT_WS(' · ', ls.name, h.vehicle_number) AS detail, NULL::text AS status,
        COALESCE(u.full_name, u.username) AS entered_by
      FROM zmcc_local_supplier_arrival h
        LEFT JOIN zmcc_local_supplier ls ON ls.id = h.local_supplier_id
        LEFT JOIN users u ON u.id = h.recorded_by_user_id
      WHERE ${mine} ${scope} ${match}`);
  }

  if (has('DISPATCH', 'PLANT_RECEPTION', 'PLANT_QA')) {
    const mine = !own
      ? Prisma.sql`TRUE`
      : role === 'SECURITY_OPERATOR'
        ? Prisma.sql`g.entry_timestamp IS NOT NULL`
        : role === 'WEIGHBRIDGE_OPERATOR'
          ? Prisma.sql`EXISTS (SELECT 1 FROM weight_ticket w WHERE w.visit_id = v.id AND (w.gross_recorded_by = ${me} OR w.tare_recorded_by = ${me}))`
          : role === 'PRODUCTION_RECEPTION_OPERATOR'
            ? Prisma.sql`EXISTS (SELECT 1 FROM unloading_log ul JOIN visit_portion p ON p.id = ul.portion_id WHERE p.visit_id = v.id AND (ul.started_by = ${me} OR ul.completed_by = ${me}))`
            : role === 'QA_LAB_ATTENDANT'
              ? Prisma.sql`(EXISTS (SELECT 1 FROM qa_testing_session q WHERE q.visit_id = v.id AND (q.started_by = ${me} OR q.completed_by = ${me}))
                  OR EXISTS (SELECT 1 FROM plant_lab_result pr WHERE pr.visit_id = v.id AND pr.tested_by = ${me}))`
              : Prisma.sql`(v.created_by = ${me} OR v.dispatch_submitted_by = ${me})`;
    const scope = f.sourceId ? Prisma.sql`AND v.procurement_source_id = ${f.sourceId}` : Prisma.empty;
    const match = like
      ? Prisma.sql`AND (v.visit_number ILIKE ${like} OR v.reception_number ILIKE ${like} OR v.token_number ILIKE ${like} OR v.vehicle_number ILIKE ${like} OR v.raw_milk_dispatch_note_number ILIKE ${like})`
      : Prisma.empty;
    const plant = !has('DISPATCH');
    const ts = plant ? Prisma.sql`COALESCE(g.entry_timestamp, v.created_at)` : Prisma.sql`COALESCE(v.dispatch_submitted_at, v.created_at)`;
    branches.push(Prisma.sql`
      SELECT 'VISIT' AS kind, v.id, ${ts} AS ts,
        v.visit_number::text AS reference, CONCAT_WS(' · ', v.vehicle_number, v.token_number, ps.name) AS detail, v.current_status::text AS status,
        COALESCE(u.full_name, u.username) AS entered_by
      FROM vehicle_visit v
        LEFT JOIN gate_log g ON g.visit_id = v.id
        LEFT JOIN procurement_source ps ON ps.id = v.procurement_source_id
        LEFT JOIN users u ON u.id = v.created_by
      WHERE v.current_status <> 'DRAFT_DISPATCH' AND NOT (v.current_status = 'CANCELLED' AND v.vehicle_number = 'DRAFT')
        AND ${mine} ${scope} ${match}`);
  }

  if (branches.length === 0) return { rows: [], total: 0, days };

  const rows = await prisma.$queryRaw<SqlRow[]>`
    SELECT t.kind, t.id, t.ts, t.reference, t.detail, t.status, t.entered_by, (COUNT(*) OVER ())::int AS total
    FROM (${Prisma.join(branches, ' UNION ALL ')}) t
    WHERE t.ts >= ${since}
    ORDER BY t.ts DESC, t.kind, t.id DESC
    LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`;

  return {
    rows: rows.map((r) => ({
      key: `${r.kind === 'JOURNEY' ? 'journey' : r.kind === 'HC' ? 'hc' : 'visit'}-${r.id}`,
      kind: r.kind,
      at: r.ts.toISOString(),
      reference: r.reference || `#${r.id}`,
      detail: r.detail || '',
      status: r.status,
      enteredBy: r.entered_by,
    })),
    total: rows[0]?.total ?? 0,
    days,
  };
}
