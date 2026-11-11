// Where a photo file lives, so anyone opening the storage folder can find it without the system:
//
//   <YYYY>/<MM>/<DD>/<stage>/<source code>/<record>/<test>__<photo id>.jpg
//
//   2026/11/03/ZMCC_DISPATCH/ZMCC-HSP/VV-20261103-0006_P1/LT-000026-Fat__3f2a…jpg
//
// The date is the Pakistan date of the record (when it has one), so every photo of a record sits in one folder, even
// one added later; otherwise the date the photo was taken. A replaced picture moves to <record>/replaced/.
// A photo whose record no longer exists goes to RECORD-NOT-FOUND, so it is never lost.

export interface PhotoPathParts {
  takenAt: Date;
  /** When the record itself was made. Wins over takenAt. */
  recordAt?: Date | null;
  testingPoint: string;
  sourceCode: string | null;
  recordRef: string | null;
  testCode?: string | null;
  testName?: string | null;
  photoKind: string;
  captureId: string;
}

/** Letters, digits, dashes and underscores only, so every folder name is safe on Windows and Linux. */
export function safeName(value: string | null | undefined, fallback: string): string {
  const clean = String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return clean || fallback;
}

function pakistanDateParts(at: Date): [string, string, string] {
  const d = new Date(at.getTime() + 5 * 60 * 60 * 1000).toISOString();
  return [d.slice(0, 4), d.slice(5, 7), d.slice(8, 10)];
}

function photoLabel(p: PhotoPathParts): string {
  if (p.testCode || p.testName) return safeName([p.testCode, p.testName].filter(Boolean).join('-'), 'TEST');
  if (p.photoKind === 'LAB_REPORT') return 'LAB-REPORT';
  if (p.photoKind === 'TANKER_WASH') return 'TANKER-WASH';
  return 'PHOTO';
}

/** The folder of a photo's record, relative to the storage root. */
export function photoRecordFolder(p: PhotoPathParts): string {
  const [yyyy, mm, dd] = pakistanDateParts(p.recordAt ?? p.takenAt);
  return [yyyy, mm, dd, safeName(p.testingPoint, 'UNKNOWN-STAGE'), safeName(p.sourceCode, 'NO-SOURCE'), safeName(p.recordRef, 'RECORD-NOT-FOUND')].join('/');
}

/** The photo's file path, relative to the storage root. */
export function buildPhotoRelPath(p: PhotoPathParts): string {
  return `${photoRecordFolder(p)}/${photoLabel(p)}__${safeName(p.captureId, 'photo')}.jpg`;
}

/** Where a replaced picture is kept, next to the current one. */
export function replacedPhotoRelPath(p: PhotoPathParts, replacedAt: Date): string {
  const stamp = new Date(replacedAt.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 19).replace(/[-:T]/g, '');
  return `${photoRecordFolder(p)}/replaced/${photoLabel(p)}__${safeName(p.captureId, 'photo')}__replaced-${stamp}.jpg`;
}

type Db = typeof import('@/backend/core/db').prisma;

/** Source code and record reference for a photo's record, read from the database. */
export async function photoRecordInfo(
  db: Db,
  entityType: string,
  entityId: bigint
): Promise<{ sourceCode: string | null; recordRef: string | null; recordAt: Date | null }> {
  const sourceCode = async (id: bigint | null | undefined) =>
    id ? (await db.procurementSource.findUnique({ where: { id }, select: { code: true } }))?.code ?? null : null;
  const visitRef = async (portionId: bigint) => {
    const p = await db.visitPortion.findUnique({
      where: { id: portionId },
      select: { portion_number: true, visit: { select: { visit_number: true, procurement_source_id: true, created_at: true } } },
    });
    return p ? { sourceCode: await sourceCode(p.visit.procurement_source_id), recordRef: `${p.visit.visit_number}_P${p.portion_number}`, recordAt: p.visit.created_at } : null;
  };
  const sessionToken = (s: { mot_arrival: { zmcc_token: string } | null; local_supplier_arrival: { zmcc_token: string } | null; id: bigint }) =>
    s.mot_arrival?.zmcc_token ?? s.local_supplier_arrival?.zmcc_token ?? `SESSION-${s.id}`;
  const none = { sourceCode: null, recordRef: null, recordAt: null };
  const sessionSelect = { id: true, zmcc_id: true, created_at: true, mot_arrival: { select: { zmcc_token: true } }, local_supplier_arrival: { select: { zmcc_token: true } } } as const;

  switch (entityType) {
    case 'mot_shop_collection': {
      const c = await db.motShopCollection.findUnique({ where: { id: entityId }, select: { collection_number: true, zmcc_id: true, device_collected_at: true } });
      return c ? { sourceCode: await sourceCode(c.zmcc_id), recordRef: c.collection_number, recordAt: c.device_collected_at } : none;
    }
    case 'zmcc_lab_session': {
      const s = await db.zmccLabSession.findUnique({ where: { id: entityId }, select: sessionSelect });
      return s ? { sourceCode: await sourceCode(s.zmcc_id), recordRef: sessionToken(s), recordAt: s.created_at } : none;
    }
    case 'zmcc_lab_portion': {
      const p = await db.zmccLabPortion.findUnique({ where: { id: entityId }, select: { portion_number: true, lab_session: { select: sessionSelect } } });
      return p ? { sourceCode: await sourceCode(p.lab_session.zmcc_id), recordRef: `${sessionToken(p.lab_session)}_P${p.portion_number}`, recordAt: p.lab_session.created_at } : none;
    }
    case 'zmcc_lab_result': {
      const r = await db.zmccLabResult.findUnique({ where: { id: entityId }, select: { session: { select: sessionSelect } } });
      return r ? { sourceCode: await sourceCode(r.session.zmcc_id), recordRef: sessionToken(r.session), recordAt: r.session.created_at } : none;
    }
    case 'vehicle_visit':
    case 'dispatch_info': {
      // The dispatch form sends the visit's ID for the lab report.
      const v = await db.vehicleVisit.findUnique({ where: { id: entityId }, select: { visit_number: true, procurement_source_id: true, created_at: true } });
      if (v) return { sourceCode: await sourceCode(v.procurement_source_id), recordRef: v.visit_number, recordAt: v.created_at };
      const info = await db.dispatchInfo.findUnique({ where: { id: entityId }, select: { portion_id: true } });
      return (info && (await visitRef(info.portion_id))) || none;
    }
    default:
      return (await visitRef(entityId)) ?? none;
  }
}

/** The full path for a photo being saved now. */
export async function photoRelPathFor(
  db: Db,
  i: { entityType: string; entityId: bigint; labTestId: bigint | null; testingPoint: string; photoKind: string; captureId: string; takenAt: Date }
): Promise<string> {
  const [info, test] = await Promise.all([
    photoRecordInfo(db, i.entityType, i.entityId),
    i.labTestId ? db.labTest.findUnique({ where: { id: i.labTestId }, select: { testCode: true, testName: true } }) : null,
  ]);
  return buildPhotoRelPath({ ...i, ...info, testCode: test?.testCode, testName: test?.testName });
}
