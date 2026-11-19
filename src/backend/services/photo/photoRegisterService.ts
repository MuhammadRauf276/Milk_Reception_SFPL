// Every photo taken at every point, with who took it (from the server, not the stamp), where it is stored and whether
// its record was submitted. Stage, source and record come from the storage path (see photoStoragePath.ts).
import { prisma } from '@/backend/core/db';
import { Prisma } from '@prisma/client';
import { pkLocal } from '@/backend/core/sqlTime';

export type PhotoRecordStatus = 'SUBMITTED' | 'NOT_SUBMITTED' | 'NOT_FOUND';

export interface PhotoRegisterRow {
  captureId: string;
  takenAt: string;
  receivedAt: string;
  stage: string;
  source: string | null;
  record: string | null;
  test: string;
  photoKind: string;
  takenBy: string;
  takenByRole: string | null;
  status: PhotoRecordStatus;
  filePath: string;
  wasOffline: boolean;
  version: string;
}

export interface PhotoRegisterFilters {
  date?: string;
  stage?: string;
  status?: PhotoRecordStatus;
  takenBy?: string;
  page: number;
  pageSize: number;
}

interface Row {
  capture_id: string;
  device_captured_at: Date;
  server_received_at: Date;
  testing_point: string;
  file_path: string;
  photo_kind: string;
  was_offline: boolean;
  sha256: string;
  test_name: string | null;
  taken_by: string | null;
  taken_by_role: string | null;
  status: PhotoRecordStatus;
  total: number;
}

// Whether the record a photo belongs to still exists, and whether its form was finally submitted.
const STATUS_SQL = Prisma.sql`
  CASE
    WHEN p.entity_type = 'zmcc_lab_portion' THEN
      CASE WHEN lp.id IS NULL THEN 'NOT_FOUND' WHEN lp.status = 'TESTING' THEN 'NOT_SUBMITTED' ELSE 'SUBMITTED' END
    WHEN p.entity_type = 'zmcc_lab_session' THEN
      CASE WHEN ls.id IS NULL THEN 'NOT_FOUND' WHEN ls.status <> 'COMPLETED' THEN 'NOT_SUBMITTED' ELSE 'SUBMITTED' END
    WHEN p.entity_type = 'zmcc_lab_result' THEN
      CASE WHEN lr.id IS NULL THEN 'NOT_FOUND' ELSE 'SUBMITTED' END
    WHEN p.entity_type = 'mot_shop_collection' THEN
      CASE WHEN mc.id IS NULL THEN 'NOT_FOUND' ELSE 'SUBMITTED' END
    WHEN p.entity_type IN ('visit_portion', 'plant_portion_test') THEN
      CASE WHEN vp.id IS NULL THEN 'NOT_FOUND' WHEN vp.plant_decision IS NULL OR vp.plant_decision = 'PENDING' THEN 'NOT_SUBMITTED' ELSE 'SUBMITTED' END
    WHEN p.entity_type = 'dispatch_portion' THEN
      CASE WHEN vp.id IS NULL THEN 'NOT_FOUND' WHEN vv.current_status IN ('DRAFT_DISPATCH', 'REOPENED') THEN 'NOT_SUBMITTED' ELSE 'SUBMITTED' END
    WHEN p.entity_type IN ('vehicle_visit', 'dispatch_info') THEN
      CASE WHEN vv.id IS NULL THEN 'NOT_FOUND' WHEN vv.current_status IN ('DRAFT_DISPATCH', 'REOPENED') THEN 'NOT_SUBMITTED' ELSE 'SUBMITTED' END
    ELSE 'NOT_FOUND'
  END`;

export async function listPhotoRegister(f: PhotoRegisterFilters): Promise<{ rows: PhotoRegisterRow[]; total: number; counts: Record<PhotoRecordStatus, number> }> {
  const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (f.date) where.push(Prisma.sql`${pkLocal('p.device_captured_at')}::date = ${f.date}::date`);
  if (f.stage) where.push(Prisma.sql`p.testing_point = ${f.stage}`);
  if (f.takenBy) where.push(Prisma.sql`(u.full_name ILIKE ${`%${f.takenBy}%`} OR u.username ILIKE ${`%${f.takenBy}%`} OR u.employee_code ILIKE ${`%${f.takenBy}%`})`);

  const base = Prisma.sql`
    FROM captured_photo p
    LEFT JOIN users u ON u.id = p.captured_by
    LEFT JOIN lab_test t ON t.id = p.lab_test_id
    LEFT JOIN zmcc_lab_portion lp ON p.entity_type = 'zmcc_lab_portion' AND lp.id = p.entity_id
    LEFT JOIN zmcc_lab_session ls ON p.entity_type = 'zmcc_lab_session' AND ls.id = p.entity_id
    LEFT JOIN zmcc_lab_result lr ON p.entity_type = 'zmcc_lab_result' AND lr.id = p.entity_id
    LEFT JOIN mot_shop_collection mc ON p.entity_type = 'mot_shop_collection' AND mc.id = p.entity_id
    LEFT JOIN visit_portion vp ON p.entity_type IN ('visit_portion', 'dispatch_portion', 'plant_portion_test') AND vp.id = p.entity_id
    LEFT JOIN vehicle_visit vv ON vv.id = CASE WHEN p.entity_type IN ('vehicle_visit', 'dispatch_info') THEN p.entity_id ELSE vp.visit_id END
    WHERE ${Prisma.join(where, ' AND ')}`;

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT * FROM (
      SELECT p.capture_id, p.device_captured_at, p.server_received_at, p.testing_point, p.file_path, p.photo_kind, p.was_offline, p.sha256,
        t.test_name, COALESCE(u.full_name, u.username) AS taken_by, COALESCE(p.performed_as_role, u.role) AS taken_by_role,
        ${STATUS_SQL} AS status, (COUNT(*) OVER ())::int AS total_all
      ${base}
    ) x
    ${f.status ? Prisma.sql`WHERE x.status = ${f.status}` : Prisma.empty}
    ORDER BY x.device_captured_at DESC
    LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`.then((r) => r as unknown as Row[]);

  const countRows = await prisma.$queryRaw<Array<{ status: PhotoRecordStatus; n: number }>>`
    SELECT x.status, COUNT(*)::int AS n FROM (SELECT ${STATUS_SQL} AS status ${base}) x GROUP BY x.status`;
  const counts: Record<PhotoRecordStatus, number> = { SUBMITTED: 0, NOT_SUBMITTED: 0, NOT_FOUND: 0 };
  for (const c of countRows) counts[c.status] = c.n;
  const total = f.status ? counts[f.status] : Object.values(counts).reduce((a, b) => a + b, 0);

  return {
    total,
    counts,
    rows: rows.map((r) => {
      // <YYYY>/<MM>/<DD>/<stage>/<source>/<record>/<file>; older files sit in a shorter path.
      const parts = r.file_path.split('/');
      const organized = parts.length >= 7;
      return {
        captureId: r.capture_id,
        takenAt: r.device_captured_at.toISOString(),
        receivedAt: r.server_received_at.toISOString(),
        stage: r.testing_point,
        source: organized ? parts[4] : null,
        record: organized ? parts[5] : null,
        test: r.test_name || (r.photo_kind === 'LAB_REPORT' ? 'Lab report' : r.photo_kind === 'TANKER_WASH' ? 'Tanker wash' : 'Photo'),
        photoKind: r.photo_kind,
        takenBy: r.taken_by || 'User not found',
        takenByRole: r.taken_by_role,
        status: r.status,
        filePath: r.file_path,
        wasOffline: r.was_offline,
        version: r.sha256.slice(0, 12),
      };
    }),
  };
}
