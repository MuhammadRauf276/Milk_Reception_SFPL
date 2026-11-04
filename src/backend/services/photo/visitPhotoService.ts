export type VisitPhotoStage = 'DISPATCH' | 'PLANT';

export interface VisitPhoto {
  captureId: string;
  stage: VisitPhotoStage;
  /** Null for a photo of the whole vehicle, such as the hand-written lab report. */
  portionNumber: number | null;
  testName: string | null;
  photoKind: string;
  capturedAt: string;
  capturedBy: string | null;
}

interface PhotoRow {
  capture_id: string;
  entity_type: string;
  entity_id: bigint;
  lab_test_id: bigint | null;
  portion_number: number | null;
  photo_kind: string;
  device_captured_at: Date;
  lab_test: { testName: string } | null;
  capturer: { full_name: string | null; username: string } | null;
}

export interface VisitPhotoDb {
  visitPortion: {
    findMany(args: {
      where: { visit_id: bigint };
      select: { id: true; portion_number: true };
    }): Promise<Array<{ id: bigint; portion_number: number }>>;
  };
  plantLabResult: {
    findMany(args: {
      where: { visit_id: bigint; photo_url: { not: null } };
      select: { photo_url: true };
    }): Promise<Array<{ photo_url: string | null }>>;
  };
  capturedPhoto: {
    findMany(args: unknown): Promise<PhotoRow[]>;
  };
}

const DISPATCH_PORTION_TYPES = ['dispatch_portion'];
const PLANT_PORTION_TYPES = ['visit_portion', 'plant_portion_test'];
const PHOTO_URL_PREFIX = '/api/photos/';

const stageOf = (row: PhotoRow): VisitPhotoStage => (PLANT_PORTION_TYPES.includes(row.entity_type) ? 'PLANT' : 'DISPATCH');

/** Photos that answer the same requirement replace each other. An "OTHER" photo is not a retake of anything. */
function slotOf(row: PhotoRow): string {
  if (row.photo_kind === 'OTHER') return row.capture_id;
  return [stageOf(row), row.entity_id, row.lab_test_id ?? row.photo_kind].join('|');
}

/**
 * The final photo for each requirement, given rows oldest first: the one saved on a submitted plant result when
 * there is one (a later retake may never have been submitted), otherwise the last received.
 */
function finalPhotos(rows: PhotoRow[], savedCaptureIds: Set<string>): PhotoRow[] {
  const finals = new Map<string, PhotoRow>();
  for (const row of rows) {
    const slot = slotOf(row);
    const current = finals.get(slot);
    if (!current || !savedCaptureIds.has(current.capture_id) || savedCaptureIds.has(row.capture_id)) {
      finals.set(slot, row);
    }
  }
  const kept = new Set(finals.values());
  return rows.filter((row) => kept.has(row));
}

/**
 * The final photos attached to one vehicle visit, oldest first. Dispatch and plant photos are stored against the
 * visit's portions; the hand-written dispatch lab report is stored against the visit id itself.
 */
export async function getVisitPhotos(visitId: bigint, db: VisitPhotoDb): Promise<VisitPhoto[]> {
  const [portions, savedResults] = await Promise.all([
    db.visitPortion.findMany({
      where: { visit_id: visitId },
      select: { id: true, portion_number: true },
    }),
    db.plantLabResult.findMany({
      where: { visit_id: visitId, photo_url: { not: null } },
      select: { photo_url: true },
    }),
  ]);
  const portionIds = portions.map((p) => p.id);
  const portionNumberById = new Map(portions.map((p) => [p.id.toString(), p.portion_number]));
  const savedCaptureIds = new Set(
    savedResults
      .map((r) => r.photo_url ?? '')
      .filter((url) => url.startsWith(PHOTO_URL_PREFIX))
      .map((url) => url.slice(PHOTO_URL_PREFIX.length))
  );

  const rows = await db.capturedPhoto.findMany({
    where: {
      OR: [
        { entity_type: { in: [...DISPATCH_PORTION_TYPES, ...PLANT_PORTION_TYPES] }, entity_id: { in: portionIds } },
        { entity_type: { in: ['dispatch_info', 'vehicle_visit'] }, entity_id: visitId },
      ],
    },
    select: {
      capture_id: true,
      entity_type: true,
      entity_id: true,
      lab_test_id: true,
      portion_number: true,
      photo_kind: true,
      device_captured_at: true,
      lab_test: { select: { testName: true } },
      capturer: { select: { full_name: true, username: true } },
    },
    // Server time, since a phone's clock can be wrong and would pick the wrong retake as the last one.
    orderBy: [{ server_received_at: 'asc' }, { id: 'asc' }],
  });

  return finalPhotos(rows, savedCaptureIds).map((row) => {
    const onPortion = [...DISPATCH_PORTION_TYPES, ...PLANT_PORTION_TYPES].includes(row.entity_type);
    return {
      captureId: row.capture_id,
      stage: stageOf(row),
      // The portion's current number wins over the one stamped on the photo, since plant QA can renumber portions.
      portionNumber: onPortion ? portionNumberById.get(row.entity_id.toString()) ?? row.portion_number : null,
      testName: row.lab_test?.testName ?? null,
      photoKind: row.photo_kind,
      capturedAt: row.device_captured_at.toISOString(),
      capturedBy: row.capturer?.full_name || row.capturer?.username || null,
    };
  });
}
