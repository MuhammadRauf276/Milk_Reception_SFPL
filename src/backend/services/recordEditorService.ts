// Lists saved records date-wise and lays out every stage with the fields that can be corrected.
// Saving goes through each stage's own correction route.
import { prisma } from '@/backend/core/db';
import { Prisma } from '@prisma/client';
import { isPlantFatTest, isPlantLrTest } from '@/backend/services/vehicleQuantityService';
import { isoToPakistanInput, type EditorEntity, type EditorField, type EditorGroup, type EditorPhotoSlot, type EditorSection } from '@/lib/recordEditor';

const MAX_PER_KIND = 5;
const UNIT_OPTIONS = [
  { value: 'KG', label: 'KG' },
  { value: 'LITER', label: 'Liter' },
];
const FINAL_RECEIPT_LOCK = 'Final plant receipt is done. Only the Super Admin can change this value now.';

const num = (v: Prisma.Decimal | number | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));
const contains = (search: string) => ({ contains: search, mode: 'insensitive' as const });
const pkInput = (d: Date | null | undefined) => (d ? isoToPakistanInput(d.toISOString()) : null);

const SESSION_INCLUDE = {
  portions: { orderBy: { portion_number: 'asc' }, include: { results: { include: { lab_test: true } } } },
  results: { orderBy: { display_order_snapshot: 'asc' } },
} satisfies Prisma.ZmccLabSessionInclude;

type LabSessionRow = Prisma.ZmccLabSessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

const WAITING_LOCK = 'Waiting for a decision. Only the Super Admin can correct it now.';

function labSections(session: LabSessionRow | null | undefined, open: boolean): EditorSection[] {
  if (!session) return [];
  if (session.portions.length > 0) {
    return session.portions.map((p) => {
      // LR and Fat have their own fields; calculated tests follow from them.
      const testFields: EditorField[] = p.results
        .filter(
          (r) =>
            r.result_type_snapshot !== 'CALCULATED' &&
            !isPlantLrTest(r.lab_test?.testCode, r.lab_test?.testName, r.lab_test?.systemRole) &&
            !isPlantFatTest(r.lab_test?.testCode, r.lab_test?.testName, r.lab_test?.systemRole)
        )
        .map((r) => ({
          field: `result_${r.test_id}`,
          label: r.test_name_snapshot,
          value: r.numeric_value !== null ? Number(r.numeric_value) : r.text_value,
          type: r.numeric_value !== null ? ('number' as const) : ('text' as const),
        }));
      return {
        key: `portion-${p.id}`,
        stage: 'ZMCC lab',
        title: `Portion ${p.portion_number}`,
        entity: 'LAB_PORTION' as const,
        recordId: p.id.toString(),
        sessionId: session.id.toString(),
        version: p.version,
        photoSlots: slotsFrom((p.decision_details as { tests?: unknown } | null)?.tests, 'zmcc_lab_portion', p.id.toString()),
        lockedReason: p.status === 'TESTING' ? 'Still being tested.' : !open && (p.final_decision === 'PENDING' || p.review_status === 'PENDING') ? WAITING_LOCK : null,
        correctionCount: 0,
        fields: [
          { field: 'lr', label: 'LR', value: num(p.lr), type: 'number' as const },
          { field: 'fat', label: 'Fat %', value: num(p.fat), type: 'number' as const },
          {
            field: 'net_weight_kg',
            label: 'Net weight (kg)',
            value: num(p.net_weight_kg),
            type: 'number' as const,
            lockedReason: p.net_weight_kg === null ? 'Not weighed yet.' : p.net_entry_mode === 'WEIGHT' ? 'Follows from the first and second weight.' : null,
          },
          ...(p.net_entry_mode === 'WEIGHT'
            ? [
                { field: 'first_weight_kg', label: 'First weight (kg)', value: num(p.first_weight_kg), type: 'number' as const },
                { field: 'second_weight_kg', label: 'Second weight (kg)', value: num(p.second_weight_kg), type: 'number' as const },
                { field: 'first_weight_at', label: 'First weight time', value: pkInput(p.first_weight_at), type: 'datetime' as const },
                { field: 'second_weight_at', label: 'Second weight time', value: pkInput(p.second_weight_at), type: 'datetime' as const },
              ]
            : []),
          ...testFields,
        ],
      };
    });
  }
  const resultFields: EditorField[] = session.results
    .filter((r) => r.result_type_snapshot !== 'CALCULATED')
    .map((r) => ({
      field: `result_${r.test_id}`,
      label: r.test_name_snapshot,
      value: r.numeric_value !== null ? Number(r.numeric_value) : r.text_value,
      type: r.numeric_value !== null ? ('number' as const) : ('text' as const),
    }));
  return [
    {
      key: `session-${session.id}`,
      stage: 'ZMCC lab',
      title: `Lab session #${session.id}`,
      entity: 'LAB_SESSION',
      recordId: session.id.toString(),
      sessionId: session.id.toString(),
      lockedReason: session.status === 'COMPLETED' ? null : 'Only a completed lab session can be corrected.',
      correctionCount: session.correction_count,
      fields: [
        { field: 'quantity_value', label: 'Quantity', value: num(session.quantity_value), type: 'number' },
        { field: 'quantity_unit', label: 'Unit', value: session.quantity_unit, type: 'select', options: UNIT_OPTIONS },
        { field: 'remarks', label: 'Remarks', value: session.remarks, type: 'text' },
        ...resultFields,
      ],
    },
  ];
}

function exitSection(kind: 'MC' | 'HC', a: { id: bigint; zmcc_token: string; exit_timestamp: Date | null; exit_correction_count: number }): EditorSection[] {
  if (!a.exit_timestamp) return [];
  return [
    {
      key: `exit-${kind}-${a.id}`,
      stage: 'ZMCC exit',
      title: `Exit · ${a.zmcc_token}`,
      entity: 'ZMCC_EXIT',
      recordId: `${kind}:${a.id}`,
      correctionCount: a.exit_correction_count,
      fields: [{ field: 'exit_timestamp', label: 'Exit time', value: pkInput(a.exit_timestamp), type: 'datetime' }],
    },
  ];
}

/** Names and types of the tests stored inside decision records, to tell typed tests from LR, Fat and calculated ones. */
async function labTestMeta(ids: string[]) {
  if (ids.length === 0) return new Map<string, { testCode: string; testName: string; resultType: string; systemRole: string | null }>();
  const rows = await prisma.labTest.findMany({ where: { id: { in: ids.map((i) => BigInt(i)) } }, select: { id: true, testCode: true, testName: true, resultType: true, systemRole: true } });
  return new Map(rows.map((r) => [r.id.toString(), r]));
}

type StoredShopTest = { labTestId: string; testName: string; value: number | null; textValue: string | null; outcome: string };
const shopTests = (details: unknown): StoredShopTest[] => {
  const tests = (details as { tests?: unknown } | null)?.tests;
  return Array.isArray(tests) ? (tests as StoredShopTest[]) : [];
};

async function journeyGroups(where: Prisma.MotJourneyWhereInput, open: boolean, take?: number): Promise<EditorGroup[]> {
  const journeys = await prisma.motJourney.findMany({
    where,
    include: {
      route: { select: { name: true } },
      collections: { include: { shop: { select: { shop_name: true } } }, orderBy: { id: 'asc' } },
      mot_arrival: { include: { lab_session: { include: SESSION_INCLUDE } } },
    },
    orderBy: { id: 'desc' },
    take,
  });
  const meta = await labTestMeta([...new Set(journeys.flatMap((j) => j.collections.flatMap((c) => shopTests(c.decision_details).map((t) => t.labTestId))))]);
  return journeys.map((j) => {
    const arrival = j.mot_arrival;
    const sections: EditorSection[] = j.collections.map((c) => ({
      key: `collection-${c.id}`,
      stage: 'Mobile Tester',
      title: `${c.shop?.shop_name || 'Shop'} · ${c.collection_number}`,
      entity: 'MOT_COLLECTION',
      recordId: c.id.toString(),
      lockedReason: !open && c.review_status === 'PENDING' ? WAITING_LOCK : null,
      photoSlots: slotsFrom(shopTests(c.decision_details), 'mot_shop_collection', c.id.toString()),
      correctionCount: c.correction_count,
      fields: [
        { field: 'quantity_value', label: 'Quantity', value: num(c.quantity_value), type: 'number' },
        { field: 'quantity_unit', label: 'Unit', value: c.quantity_unit, type: 'select', options: UNIT_OPTIONS },
        { field: 'lr', label: 'LR', value: num(c.lr), type: 'number' },
        { field: 'fat', label: 'Fat %', value: num(c.fat), type: 'number' },
        { field: 'shop_rmr_number', label: 'Shop RMR number', value: c.shop_rmr_number, type: 'text' },
        ...shopTests(c.decision_details)
          .filter((t) => {
            const m = meta.get(t.labTestId);
            return (t.value !== null || t.textValue !== null) && !!m && m.resultType !== 'CALCULATED' && !isPlantLrTest(m.testCode, m.testName, m.systemRole) && !isPlantFatTest(m.testCode, m.testName, m.systemRole);
          })
          .map((t) => ({ field: `result_${t.labTestId}`, label: t.testName, value: t.value !== null ? t.value : t.textValue, type: t.value !== null ? ('number' as const) : ('text' as const) })),
      ],
    }));
    if (arrival) {
      sections.push({
        key: `mc-arrival-${arrival.id}`,
        stage: 'ZMCC arrival',
        title: `Arrival · ${arrival.zmcc_token}`,
        entity: 'MC_ARRIVAL',
        recordId: arrival.id.toString(),
        correctionCount: arrival.correction_count,
        fields: [
          { field: 'raw_milk_token_number', label: 'Raw milk token', value: arrival.raw_milk_token_number, type: 'text' },
          { field: 'arrival_timestamp', label: 'Arrival time', value: pkInput(arrival.arrival_timestamp), type: 'datetime' },
        ],
      });
      sections.push(...labSections(arrival.lab_session, open), ...exitSection('MC', arrival));
    }
    return { key: `journey-${j.id}`, title: `Journey ${j.journey_number}`, subtitle: j.route?.name || 'Mobile Tester route', sections };
  });
}

async function supplierGroups(where: Prisma.ZmccLocalSupplierArrivalWhereInput, open: boolean, take?: number): Promise<EditorGroup[]> {
  const arrivals = await prisma.zmccLocalSupplierArrival.findMany({
    where,
    include: { local_supplier: { select: { name: true } }, lab_session: { include: SESSION_INCLUDE } },
    orderBy: { id: 'desc' },
    take,
  });
  return arrivals.map((a) => ({
    key: `hc-${a.id}`,
    title: `Supplier arrival ${a.zmcc_token}`,
    subtitle: `${a.local_supplier?.name || 'Supplier'} · ${a.vehicle_number}`,
    sections: [
      {
        key: `hc-arrival-${a.id}`,
        stage: 'ZMCC arrival',
        title: `Arrival · ${a.zmcc_token}`,
        entity: 'HC_ARRIVAL' as const,
        recordId: a.id.toString(),
        correctionCount: a.correction_count,
        fields: [
          { field: 'raw_milk_token_number', label: 'Raw milk token', value: a.raw_milk_token_number, type: 'text' as const },
          { field: 'rmr_number', label: 'RMR number', value: a.rmr_number, type: 'text' as const },
          { field: 'vehicle_number', label: 'Vehicle number', value: a.vehicle_number, type: 'text' as const },
          { field: 'arrival_timestamp', label: 'Arrival time', value: pkInput(a.arrival_timestamp), type: 'datetime' as const },
        ],
      },
      ...labSections(a.lab_session, open),
      ...exitSection('HC', a),
    ],
  }));
}

/** `superAdmin` opens values posted by the final plant receipt; for everyone else they stay locked. */
async function visitGroups(where: Prisma.VehicleVisitWhereInput, superAdmin: boolean, take?: number): Promise<EditorGroup[]> {
  const visits = await prisma.vehicleVisit.findMany({
    where,
    include: {
      procurement_source: { select: { name: true } },
      weight_ticket: true,
      gate_log: true,
      dual_reconciliation: { select: { id: true } },
      portions: {
        orderBy: { portion_number: 'asc' },
        include: {
          plant_lab_results: { include: { lab_test: true } },
          dispatch_lab_results: { include: { lab_test: true } },
          unloading_log: true,
          dispatch_info: { select: { id: true } },
        },
      },
    },
    orderBy: { id: 'desc' },
    take,
  });
  const siloOptions = superAdmin
    ? (await prisma.silo.findMany({ where: { is_active: true }, select: { id: true, silo_code: true, silo_name: true }, orderBy: { silo_code: 'asc' } })).map((s) => ({ value: s.id.toString(), label: `${s.silo_code} · ${s.silo_name}` }))
    : [];
  return visits.map((v) => {
    const locked = Boolean(v.dual_reconciliation) && !superAdmin;
    const wt = v.weight_ticket;
    const weightLock = locked ? FINAL_RECEIPT_LOCK : wt ? null : 'Not weighed at the plant yet.';
    const sections: EditorSection[] = [
      {
        key: `dispatch-${v.id}`,
        photoSlots: (v.dispatch_decision_details as { labReport?: { required?: boolean; captureId?: string | null } } | null)?.labReport?.required &&
          !v.dispatch_lab_report_capture_id
          ? [{ key: `lab-report-${v.id}`, label: 'Hand-written lab report', entityType: 'dispatch_info', entityId: v.id.toString(), labTestId: null, photoKind: 'LAB_REPORT' }]
          : undefined,
        stage: 'Dispatch',
        title: `Dispatch · ${v.raw_milk_dispatch_note_number || v.visit_number}`,
        entity: 'DISPATCH',
        recordId: v.id.toString(),
        correctionCount: v.correction_count,
        fields: [
          { field: 'raw_milk_dispatch_note_number', label: 'Dispatch note number', value: v.raw_milk_dispatch_note_number, type: 'text' },
          { field: 'vehicle_dispatch_quantity_value', label: 'Quantity', value: num(v.vehicle_dispatch_quantity_value), type: 'number' },
          { field: 'vehicle_dispatch_quantity_unit', label: 'Unit', value: v.vehicle_dispatch_quantity_unit, type: 'select', options: UNIT_OPTIONS },
          { field: 'vehicle_dispatch_lr', label: 'LR', value: num(v.vehicle_dispatch_lr), type: 'number' },
          { field: 'vehicle_dispatch_fat', label: 'Fat %', value: num(v.vehicle_dispatch_fat), type: 'number' },
        ],
      },
    ];
    for (const p of v.portions) {
      const fields: EditorField[] = p.dispatch_lab_results
        .filter((r) => r.performance_status === 'PERFORMED' && r.lab_test?.resultType !== 'CALCULATED')
        .map((r) => ({
          field: `result_${r.test_id}`,
          label: r.lab_test?.testName || 'Test',
          value: r.numeric_value !== null ? Number(r.numeric_value) : r.text_value,
          type: r.numeric_value !== null ? ('number' as const) : ('text' as const),
        }));
      if (fields.length === 0) continue;
      const dispatchDetails = v.dispatch_decision_details as { portions?: Array<{ portionNumber: number; tests: unknown }> } | null;
      sections.push({
        photoSlots: slotsFrom(dispatchDetails?.portions?.find((x) => x.portionNumber === p.portion_number)?.tests, 'dispatch_portion', p.id.toString()),
        key: `dispatch-portion-${p.id}`,
        stage: 'Dispatch tests',
        title: `Portion ${p.portion_number}`,
        entity: 'DISPATCH_PORTION',
        recordId: p.id.toString(),
        visitId: v.id.toString(),
        correctionCount: 0,
        fields,
      });
    }
    if (v.gate_log) {
      sections.push({
        key: `gate-${v.id}`,
        stage: 'Gate',
        title: `Gate · ${v.vehicle_number}`,
        entity: 'GATE_LOG',
        recordId: v.id.toString(),
        correctionCount: 0,
        fields: [
          { field: 'entry_timestamp', label: 'Entry time', value: pkInput(v.gate_log.entry_timestamp), type: 'datetime' },
          { field: 'exit_timestamp', label: 'Exit time', value: pkInput(v.gate_log.exit_timestamp), type: 'datetime' },
        ],
      });
    }
    sections.push({
      key: `plant-${v.id}`,
      stage: 'Plant reception',
      title: `Reception · ${v.reception_number || v.token_number || v.visit_number}`,
      entity: 'PLANT_RECEPTION',
      recordId: v.id.toString(),
      correctionCount: v.correction_count,
      fields: [
        { field: 'token_number', label: 'Token number', value: v.token_number, type: 'text' },
        { field: 'vehicle_number', label: 'Vehicle number', value: v.vehicle_number, type: 'text' },
        { field: 'gross_weight_kg', label: 'Gross weight (kg)', value: num(wt?.gross_weight_kg), type: 'number', lockedReason: weightLock },
        { field: 'tare_weight_kg', label: 'Tare weight (kg)', value: num(wt?.tare_weight_kg), type: 'number', lockedReason: weightLock },
        ...(superAdmin && wt
          ? [
              { field: 'gross_timestamp', label: 'First weight time', value: pkInput(wt.gross_timestamp), type: 'datetime' as const },
              { field: 'tare_timestamp', label: 'Second weight time', value: pkInput(wt.tare_timestamp), type: 'datetime' as const },
            ]
          : []),
      ],
    });
    for (const p of v.portions) {
      if (!p.unloading_log || !superAdmin) continue;
      sections.push({
        key: `unloading-${p.id}`,
        stage: 'Unloading',
        title: `Portion ${p.portion_number}`,
        entity: 'UNLOADING',
        recordId: p.id.toString(),
        correctionCount: 0,
        fields: [
          { field: 'silo_id', label: 'Silo', value: p.unloading_log.silo_id?.toString() ?? null, type: 'select', options: siloOptions },
          { field: 'pump_start_timestamp', label: 'Pump start', value: pkInput(p.unloading_log.pump_start_timestamp), type: 'datetime' },
          { field: 'pump_end_timestamp', label: 'Pump end', value: pkInput(p.unloading_log.pump_end_timestamp), type: 'datetime' },
        ],
      });
    }
    for (const p of v.portions) {
      const fields: EditorField[] = p.plant_lab_results
        .filter((r) => r.performance_status === 'PERFORMED' && r.lab_test?.resultType !== 'CALCULATED')
        .map((r) => ({
          field: `result_${r.test_id}`,
          label: r.lab_test?.testName || 'Test',
          value: r.numeric_value !== null ? Number(r.numeric_value) : r.text_value,
          type: r.numeric_value !== null ? ('number' as const) : ('text' as const),
        }));
      if (fields.length === 0) continue;
      sections.push({
        key: `plant-qa-${p.id}`,
        photoSlots: p.plant_lab_results
          .filter((r) => r.performance_status === 'PERFORMED' && r.lab_test?.resultType !== 'CALCULATED')
          .map((r) => ({ key: `visit_portion-${p.id}-${r.test_id}`, label: r.lab_test?.testName || 'Test', entityType: 'visit_portion', entityId: p.id.toString(), labTestId: r.test_id.toString(), photoKind: 'TEST_RESULT' as const })),
        stage: 'Plant QA',
        title: `Portion ${p.portion_number}`,
        entity: 'PLANT_QA',
        recordId: p.id.toString(),
        visitId: v.id.toString(),
        lockedReason: locked ? FINAL_RECEIPT_LOCK : null,
        correctionCount: p.correction_count ?? 0,
        fields,
      });
    }
    return {
      key: `visit-${v.id}`,
      title: `Visit ${v.visit_number}`,
      subtitle: `${v.procurement_source?.name || 'Source'} · ${v.vehicle_number}`,
      sections,
    };
  });
}

/** The photo records each section owns, as entity type and ID. */
function photoOwners(s: EditorSection): Array<[string, string]> {
  switch (s.entity) {
    case 'MOT_COLLECTION':
      return [['mot_shop_collection', s.recordId]];
    case 'LAB_PORTION':
      return [['zmcc_lab_portion', s.recordId]];
    case 'LAB_SESSION':
      return [['zmcc_lab_session', s.recordId]];
    case 'DISPATCH':
      return [['vehicle_visit', s.recordId], ['dispatch_info', s.recordId]];
    case 'DISPATCH_PORTION':
      return [['dispatch_portion', s.recordId]];
    case 'PLANT_QA':
      return [['visit_portion', s.recordId], ['plant_portion_test', s.recordId]];
    default:
      return [];
  }
}

/** Tests that call for a photo but have none, read from the record's decision details. */
function slotsFrom(tests: unknown, entityType: string, entityId: string, prefix = ''): EditorPhotoSlot[] {
  if (!Array.isArray(tests)) return [];
  return (tests as Array<{ labTestId: string; testName: string; photoMode?: string; photoCaptureId?: string | null }>)
    .filter((t) => t.photoMode && t.photoMode !== 'NONE' && !t.photoCaptureId)
    .map((t) => ({ key: `${entityType}-${entityId}-${t.labTestId}`, label: `${prefix}${t.testName}`, entityType, entityId, labTestId: t.labTestId, photoKind: 'TEST_RESULT' as const }));
}

async function attachPhotos(groups: EditorGroup[]): Promise<void> {
  const sections = groups.flatMap((g) => g.sections);
  const owners = sections.flatMap(photoOwners);
  if (owners.length === 0) return;
  const photos = await prisma.capturedPhoto.findMany({
    where: { OR: owners.map(([entity_type, id]) => ({ entity_type, entity_id: BigInt(id) })) },
    include: { lab_test: { select: { testName: true } } },
    orderBy: { id: 'asc' },
  });
  for (const s of sections) {
    const keys = new Set(photoOwners(s).map(([t, id]) => `${t}:${id}`));
    const own = photos.filter((p) => keys.has(`${p.entity_type}:${p.entity_id}`));
    // A slot that already has a picture is not offered again.
    if (s.photoSlots) {
      s.photoSlots = s.photoSlots.filter(
        (slot) => !photos.some((p) => p.entity_type === slot.entityType && p.entity_id.toString() === slot.entityId && (p.lab_test_id?.toString() ?? null) === slot.labTestId && p.photo_kind === slot.photoKind)
      );
      if (s.photoSlots.length === 0) delete s.photoSlots;
    }
    if (own.length) {
      s.photos = own.map((p) => ({
        captureId: p.capture_id,
        label: p.lab_test?.testName || (p.photo_kind === 'LAB_REPORT' ? 'Lab report' : p.photo_kind === 'TANKER_WASH' ? 'Tanker wash' : 'Photo'),
        version: p.sha256.slice(0, 12),
      }));
    }
  }
}

export type RecordStageFilter = 'ALL' | 'MC' | 'HC' | 'VISIT';

export interface RecordListFilters {
  date?: string;
  stage?: RecordStageFilter;
  enteredBy?: string;
  search?: string;
  page: number;
  pageSize: number;
}

interface ListRow {
  kind: 'JOURNEY' | 'HC' | 'VISIT';
  id: bigint;
  ts: Date;
  entered_by: string | null;
  total: number;
}

/** Every saved transaction, newest first, for the Super Admin: filtered by Pakistan date, stage, who entered it, or a number. */
export async function listRecordGroups(f: RecordListFilters): Promise<{ groups: EditorGroup[]; total: number }> {
  const like = f.search ? `%${f.search}%` : null;
  const stage = f.stage ?? 'ALL';
  const branches: Prisma.Sql[] = [];

  if (stage === 'ALL' || stage === 'MC') {
    const match = like
      ? Prisma.sql`AND (j.journey_number ILIKE ${like} OR a.zmcc_token ILIKE ${like} OR a.raw_milk_token_number ILIKE ${like} OR a.route_milk_token ILIKE ${like}
          OR EXISTS (SELECT 1 FROM mot_shop_collection c WHERE c.journey_id = j.id AND (c.collection_number ILIKE ${like} OR c.shop_rmr_number ILIKE ${like})))`
      : Prisma.empty;
    branches.push(Prisma.sql`
      SELECT 'JOURNEY' AS kind, j.id, COALESCE(a.arrival_timestamp, j.created_at) AS ts,
        COALESCE(
          (SELECT COALESCE(u.full_name, u.username) FROM mot_shop_collection c JOIN users u ON u.id = c.submitted_by_user_id WHERE c.journey_id = j.id ORDER BY c.id LIMIT 1),
          (SELECT COALESCE(u.full_name, u.username) FROM users u WHERE u.id = a.recorded_by_user_id)
        ) AS entered_by
      FROM mot_journey j LEFT JOIN zmcc_mot_arrival a ON a.journey_id = j.id
      WHERE (a.id IS NOT NULL OR EXISTS (SELECT 1 FROM mot_shop_collection c WHERE c.journey_id = j.id)) ${match}`);
  }
  if (stage === 'ALL' || stage === 'HC') {
    const match = like
      ? Prisma.sql`AND (h.zmcc_token ILIKE ${like} OR h.raw_milk_token_number ILIKE ${like} OR h.rmr_number ILIKE ${like} OR h.vehicle_number ILIKE ${like})`
      : Prisma.empty;
    branches.push(Prisma.sql`
      SELECT 'HC' AS kind, h.id, h.arrival_timestamp AS ts, COALESCE(u.full_name, u.username) AS entered_by
      FROM zmcc_local_supplier_arrival h LEFT JOIN users u ON u.id = h.recorded_by_user_id
      WHERE TRUE ${match}`);
  }
  if (stage === 'ALL' || stage === 'VISIT') {
    const match = like
      ? Prisma.sql`AND (v.visit_number ILIKE ${like} OR v.reception_number ILIKE ${like} OR v.token_number ILIKE ${like} OR v.vehicle_number ILIKE ${like} OR v.raw_milk_dispatch_note_number ILIKE ${like})`
      : Prisma.empty;
    branches.push(Prisma.sql`
      SELECT 'VISIT' AS kind, v.id, v.created_at AS ts, COALESCE(u.full_name, u.username) AS entered_by
      FROM vehicle_visit v LEFT JOIN users u ON u.id = v.created_by
      WHERE v.current_status <> 'DRAFT_DISPATCH' AND NOT (v.current_status = 'CANCELLED' AND v.vehicle_number = 'DRAFT') ${match}`);
  }

  const dateFilter = f.date ? Prisma.sql`AND (t.ts AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Karachi')::date = ${f.date}::date` : Prisma.empty;
  const userFilter = f.enteredBy ? Prisma.sql`AND t.entered_by ILIKE ${`%${f.enteredBy}%`}` : Prisma.empty;
  const rows = await prisma.$queryRaw<ListRow[]>`
    SELECT t.kind, t.id, t.ts, t.entered_by, (COUNT(*) OVER ())::int AS total
    FROM (${Prisma.join(branches, ' UNION ALL ')}) t
    WHERE TRUE ${dateFilter} ${userFilter}
    ORDER BY t.ts DESC, t.kind, t.id DESC
    LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`;

  const idsOf = (kind: ListRow['kind']) => rows.filter((r) => r.kind === kind).map((r) => r.id);
  const [journeys, suppliers, visits] = await Promise.all([
    idsOf('JOURNEY').length ? journeyGroups({ id: { in: idsOf('JOURNEY') } }, true) : [],
    idsOf('HC').length ? supplierGroups({ id: { in: idsOf('HC') } }, true) : [],
    idsOf('VISIT').length ? visitGroups({ id: { in: idsOf('VISIT') } }, true) : [],
  ]);
  const byKey = new Map([...journeys, ...suppliers, ...visits].map((g) => [g.key, g]));
  const keyOf = (r: ListRow) => `${r.kind === 'JOURNEY' ? 'journey' : r.kind === 'HC' ? 'hc' : 'visit'}-${r.id}`;
  const groups = rows.flatMap((r) => {
    const g = byKey.get(keyOf(r));
    return g ? [{ ...g, at: r.ts.toISOString(), enteredBy: r.entered_by }] : [];
  });
  await attachPhotos(groups);
  return { groups, total: rows[0]?.total ?? 0 };
}

/** Records a person may ask to correct: only the stages of their role, and only their own ZMCC or contractor. */
export async function searchRequestableGroups(
  search: string,
  entities: readonly EditorEntity[],
  sourceId?: bigint
): Promise<EditorGroup[]> {
  const lab = entities.includes('LAB_PORTION') || entities.includes('LAB_SESSION');
  const wantsJourneys = lab || entities.includes('MOT_COLLECTION') || entities.includes('MC_ARRIVAL');
  const wantsSuppliers = lab || entities.includes('HC_ARRIVAL');
  const wantsVisits = entities.some((e) => e === 'DISPATCH' || e === 'PLANT_RECEPTION' || e === 'PLANT_QA');
  const [journeys, suppliers, visits] = await Promise.all([
    wantsJourneys
      ? journeyGroups(
          {
            ...(sourceId ? { zmcc_id: sourceId } : {}),
            OR: [
              { journey_number: contains(search) },
              { mot_arrival: { zmcc_token: contains(search) } },
              { mot_arrival: { raw_milk_token_number: contains(search) } },
              { mot_arrival: { route_milk_token: contains(search) } },
              { collections: { some: { collection_number: contains(search) } } },
              { collections: { some: { shop_rmr_number: contains(search) } } },
            ],
          },
          false,
          MAX_PER_KIND
        )
      : [],
    wantsSuppliers
      ? supplierGroups(
          {
            ...(sourceId ? { zmcc_id: sourceId } : {}),
            OR: [
              { zmcc_token: contains(search) },
              { raw_milk_token_number: contains(search) },
              { rmr_number: contains(search) },
              { vehicle_number: contains(search) },
            ],
          },
          false,
          MAX_PER_KIND
        )
      : [],
    wantsVisits
      ? visitGroups(
          {
            ...(sourceId ? { procurement_source_id: sourceId } : {}),
            NOT: [{ current_status: 'DRAFT_DISPATCH' }, { current_status: 'CANCELLED', vehicle_number: 'DRAFT' }],
            OR: [
              { visit_number: contains(search) },
              { reception_number: contains(search) },
              { token_number: contains(search) },
              { vehicle_number: contains(search) },
              { raw_milk_dispatch_note_number: contains(search) },
            ],
          },
          false,
          MAX_PER_KIND
        )
      : [],
  ]);
  return [...journeys, ...suppliers, ...visits]
    .map((g) => ({ ...g, sections: g.sections.filter((s) => entities.includes(s.entity)) }))
    .filter((g) => g.sections.length > 0);
}

/** One record in full, for the Inspect drawer: only the person's own stages, only their own ZMCC or contractor. */
export async function getRequestableGroup(key: string, entities: readonly EditorEntity[], sourceId?: bigint): Promise<EditorGroup | null> {
  const m = /^(journey|hc|visit)-(\d+)$/.exec(key);
  if (!m) return null;
  const id = BigInt(m[2]);
  const groups =
    m[1] === 'journey'
      ? await journeyGroups({ id, ...(sourceId ? { zmcc_id: sourceId } : {}) }, false, 1)
      : m[1] === 'hc'
        ? await supplierGroups({ id, ...(sourceId ? { zmcc_id: sourceId } : {}) }, false, 1)
        : await visitGroups({ id, ...(sourceId ? { procurement_source_id: sourceId } : {}) }, false, 1);
  const g = groups[0];
  if (!g) return null;
  const sections = g.sections.filter((s) => entities.includes(s.entity));
  return sections.length ? { ...g, sections } : null;
}
