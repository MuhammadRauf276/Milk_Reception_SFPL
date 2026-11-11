// Record editor: the shape of a searched record, and how one edit is saved. Pure, safe in the browser and in tests.

export type EditorEntity =
  | 'MOT_COLLECTION'
  | 'MC_ARRIVAL'
  | 'HC_ARRIVAL'
  | 'LAB_PORTION'
  | 'LAB_SESSION'
  | 'DISPATCH'
  | 'PLANT_RECEPTION'
  | 'PLANT_QA'
  | 'GATE_LOG'
  | 'ZMCC_EXIT'
  | 'DISPATCH_PORTION'
  | 'UNLOADING';

export interface EditorField {
  field: string;
  label: string;
  value: string | number | null;
  type: 'text' | 'number' | 'datetime' | 'select';
  options?: Array<{ value: string; label: string }>;
  /** Why this one field cannot be changed, when it cannot. */
  lockedReason?: string | null;
}

export interface EditorPhoto {
  captureId: string;
  label: string;
  /** Changes when the picture is replaced. */
  version: string;
}

export interface EditorPhotoSlot {
  key: string;
  label: string;
  entityType: string;
  entityId: string;
  labTestId: string | null;
  photoKind: 'TEST_RESULT' | 'LAB_REPORT';
}

export interface EditorSection {
  key: string;
  stage: string;
  title: string;
  entity: EditorEntity;
  recordId: string;
  /** Parent vehicle visit, for plant QA portions. */
  visitId?: string;
  /** Parent lab session, for lab portions. */
  sessionId?: string;
  version?: number;
  /** Why the whole section cannot be changed, when it cannot. */
  lockedReason?: string | null;
  correctionCount: number;
  fields: EditorField[];
  /** Saved photos of this record. Present in the Super Admin's list. */
  photos?: EditorPhoto[];
  /** Tests or reports that should have a photo but have none, so the Super Admin can add one. */
  photoSlots?: EditorPhotoSlot[];
}

export interface EditorGroup {
  key: string;
  title: string;
  subtitle: string;
  /** When the transaction was entered, and by whom. Present in the date-wise list. */
  at?: string;
  enteredBy?: string | null;
  sections: EditorSection[];
}

export interface EditorSaveRequest {
  url: string;
  method: 'PATCH' | 'POST';
  body: Record<string, unknown>;
}

const RESULT_PREFIX = 'result_';

/** A datetime-local value read as Pakistan time. */
export function pakistanInputToIso(value: string): string {
  return new Date(`${value.length === 16 ? `${value}:00` : value}+05:00`).toISOString();
}

/** An instant as a datetime-local value in Pakistan time. */
export function isoToPakistanInput(iso: string): string {
  return new Date(new Date(iso).getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

/** Only the fields whose value really changed, typed for sending. Blank text clears; a blank number is left out. */
export function changedFields(section: EditorSection, draft: Record<string, string>): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const f of section.fields) {
    if (f.lockedReason || !(f.field in draft)) continue;
    const raw = draft[f.field].trim();
    if (f.type === 'number') {
      if (raw === '') continue;
      const n = Number(raw);
      if (Number.isFinite(n) && n !== (f.value === null ? null : Number(f.value))) out[f.field] = n;
    } else if (f.type === 'datetime') {
      if (raw !== '' && raw !== (f.value === null ? '' : String(f.value))) out[f.field] = pakistanInputToIso(raw);
    } else if (raw !== (f.value === null ? '' : String(f.value))) {
      out[f.field] = raw === '' ? null : raw;
    }
  }
  return out;
}

function resultRows(changes: Record<string, string | number | null>) {
  return Object.entries(changes)
    .filter(([k]) => k.startsWith(RESULT_PREFIX))
    .map(([k, v]) => ({
      test_id: k.slice(RESULT_PREFIX.length),
      ...(typeof v === 'number' ? { numeric_value: v } : { text_value: v }),
    }));
}

function withoutResults(changes: Record<string, string | number | null>) {
  return Object.fromEntries(Object.entries(changes).filter(([k]) => !k.startsWith(RESULT_PREFIX)));
}

/** Each stage is saved by its own correction route, which keeps that stage's stock, receipts and loss in step. */
export function buildEditorSave(
  section: EditorSection,
  changes: Record<string, string | number | null>,
  reason: string,
  idempotencyKey: string
): EditorSaveRequest {
  const id = section.recordId;
  switch (section.entity) {
    case 'MOT_COLLECTION':
    {
      const results = resultRows(changes);
      return { url: `/api/zmcc/mot/collections/${id}/correction`, method: 'PATCH', body: { reason, ...withoutResults(changes), ...(results.length ? { results } : {}) } };
    }
    case 'MC_ARRIVAL':
      return { url: `/api/zmcc/arrivals/mot/${id}`, method: 'PATCH', body: { reason, ...changes } };
    case 'HC_ARRIVAL':
      return { url: `/api/zmcc/arrivals/hc/${id}`, method: 'PATCH', body: { reason, ...changes } };
    case 'LAB_PORTION': {
      const results = resultRows(changes);
      return {
        url: `/api/zmcc/lab/portions/${id}/correction`,
        method: 'POST',
        body: { reason, version: section.version, idempotency_key: idempotencyKey, ...withoutResults(changes), ...(results.length ? { results } : {}) },
      };
    }
    case 'DISPATCH_PORTION':
      return { url: '/api/corrections/dispatch-portion', method: 'PATCH', body: { visitId: section.visitId, portionId: id, reason, results: resultRows(changes) } };
    case 'GATE_LOG':
    case 'ZMCC_EXIT':
    case 'UNLOADING':
      return { url: '/api/corrections/times', method: 'PATCH', body: { entity: section.entity, recordId: id, reason, changes } };
    case 'LAB_SESSION': {
      const results = resultRows(changes);
      return {
        url: `/api/zmcc/lab/sessions/${id}/correction`,
        method: 'PATCH',
        body: { reason, ...withoutResults(changes), ...(results.length ? { results } : {}) },
      };
    }
    case 'DISPATCH':
      return { url: `/api/dispatches/${id}/correction`, method: 'PATCH', body: { reason, idempotency_key: idempotencyKey, ...changes } };
    case 'PLANT_RECEPTION':
      return { url: '/api/corrections/records', method: 'PATCH', body: { recordId: id, reason, changes } };
    case 'PLANT_QA':
      return {
        url: `/api/qa/vehicle-visits/${section.visitId}/portions/${id}/correct-results`,
        method: 'POST',
        body: { reason, results: resultRows(changes) },
      };
  }
}

/** Which stages each role can ask to correct: the stages that role enters. */
const REQUESTABLE_BY_ROLE: Readonly<Record<string, readonly EditorEntity[]>> = {
  MOT: ['MOT_COLLECTION'],
  MDO: ['MOT_COLLECTION', 'MC_ARRIVAL', 'HC_ARRIVAL'],
  PHE_OPERATOR: ['MC_ARRIVAL', 'HC_ARRIVAL'],
  ZMCC_LAB_ATTENDANT: ['LAB_PORTION', 'LAB_SESSION', 'DISPATCH'],
  ZMCC_MANAGER: ['MOT_COLLECTION', 'MC_ARRIVAL', 'HC_ARRIVAL', 'LAB_PORTION', 'LAB_SESSION', 'DISPATCH'],
  HEAD_OF_MPD: ['MOT_COLLECTION', 'MC_ARRIVAL', 'HC_ARRIVAL', 'LAB_PORTION', 'LAB_SESSION', 'DISPATCH'],
  CONTRACTOR_OPERATOR: ['DISPATCH'],
  CONTRACTOR_MANAGER: ['DISPATCH'],
  SECURITY_OPERATOR: ['PLANT_RECEPTION'],
  WEIGHBRIDGE_OPERATOR: ['PLANT_RECEPTION'],
  PRODUCTION_RECEPTION_OPERATOR: ['PLANT_RECEPTION'],
  PRODUCTION_HEAD: ['PLANT_RECEPTION'],
  QA_LAB_ATTENDANT: ['PLANT_QA'],
  QA_HEAD: ['PLANT_QA', 'PLANT_RECEPTION'],
};

/** Every role that can raise a correction request. */
export const REQUESTING_ROLES: readonly string[] = Object.keys(REQUESTABLE_BY_ROLE);

export function requestableEntities(role: string | null | undefined): readonly EditorEntity[] {
  return (role && REQUESTABLE_BY_ROLE[role]) || [];
}

export type TicketModule =
  | 'MOT_SHOP_COLLECTION'
  | 'VEHICLE_VISIT'
  | 'PLANT_QA_MEASUREMENT'
  | 'ZMCC_MC_ARRIVAL'
  | 'ZMCC_HC_ARRIVAL'
  | 'ZMCC_LAB_SESSION';

/** The ticket type a section is raised as, or null for stages only the Super Admin edits. */
export function ticketModuleFor(entity: EditorEntity): TicketModule | null {
  switch (entity) {
    case 'MOT_COLLECTION':
      return 'MOT_SHOP_COLLECTION';
    case 'MC_ARRIVAL':
      return 'ZMCC_MC_ARRIVAL';
    case 'HC_ARRIVAL':
      return 'ZMCC_HC_ARRIVAL';
    case 'LAB_PORTION':
    case 'LAB_SESSION':
      return 'ZMCC_LAB_SESSION';
    case 'DISPATCH':
    case 'PLANT_RECEPTION':
      return 'VEHICLE_VISIT';
    case 'PLANT_QA':
      return 'PLANT_QA_MEASUREMENT';
    default:
      return null;
  }
}

/** The record a ticket names, and its key for a field. A lab portion's ticket names the session and the portion. */
export function ticketTarget(section: EditorSection): { recordId: string; fieldKey: (field: string) => string; labelPrefix: string } {
  if (section.entity === 'LAB_PORTION') {
    return { recordId: section.sessionId ?? section.recordId, fieldKey: (f) => `portion:${section.recordId}:${f}`, labelPrefix: `${section.title} · ` };
  }
  return { recordId: section.recordId, fieldKey: (f) => f, labelPrefix: '' };
}
