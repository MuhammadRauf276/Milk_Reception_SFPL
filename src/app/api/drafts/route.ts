import { NextResponse } from 'next/server';
import { prisma } from '@core/db';
import { authorizeDraftAccess } from '@/backend/services/formDraftAccess';
import {
  DRAFT_FORM_TYPES,
  DraftError,
  deleteOwnDraft,
  loadDraft,
  saveDraft,
  type DraftDb,
  type DraftFormType,
  type DraftKey,
} from '@/backend/services/formDraftService';

const db = prisma as unknown as DraftDb;

function parseTarget(src: { formType?: unknown; scopeId?: unknown; portionKey?: unknown }) {
  const formType = String(src.formType ?? '') as DraftFormType;
  if (!DRAFT_FORM_TYPES.includes(formType)) return null;
  const scopeId = String(src.scopeId ?? '');
  const portionKey = String(src.portionKey ?? '');
  return { formType, scopeId, portionKey };
}

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Own draft for one portion, plus who else started one (names and times only). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const t = parseTarget({ formType: url.searchParams.get('formType'), scopeId: url.searchParams.get('scopeId'), portionKey: url.searchParams.get('portionKey') });
  if (!t) return bad('Unknown draft target.');
  const access = await authorizeDraftAccess(req, t.formType, t.scopeId, t.portionKey);
  if (!access.ok) return bad(access.error, access.status);
  const key: DraftKey = { formType: t.formType, scopeId: BigInt(t.scopeId), portionKey: t.portionKey, userId: access.userId };
  const result = await loadDraft(db, key);
  return NextResponse.json({ ...result, closedMessage: access.closedMessage });
}

/** Body: { formType, scopeId, portionKey, baseVersion, content: { values, photos, remarks } } */
export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return bad('Invalid request body.');
  const t = parseTarget(body);
  if (!t) return bad('Unknown draft target.');
  const access = await authorizeDraftAccess(req, t.formType, t.scopeId, t.portionKey);
  if (!access.ok) return bad(access.error, access.status);
  if (access.closedMessage) return bad(access.closedMessage, 409);
  const base = body.baseVersion;
  if (base !== null && base !== undefined && (typeof base !== 'number' || !Number.isInteger(base))) return bad('Invalid draft version.');
  const key: DraftKey = { formType: t.formType, scopeId: BigInt(t.scopeId), portionKey: t.portionKey, userId: access.userId };
  try {
    const draft = await saveDraft(db, key, body.content, (base as number | null | undefined) ?? null);
    return NextResponse.json({ draft });
  } catch (err) {
    if (err instanceof DraftError) return NextResponse.json({ error: err.message, code: err.code, current: err.current }, { status: err.status });
    console.error('PUT /api/drafts error:', err);
    return bad('Failed to save draft.', 500);
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const t = parseTarget({ formType: url.searchParams.get('formType'), scopeId: url.searchParams.get('scopeId'), portionKey: url.searchParams.get('portionKey') });
  if (!t) return bad('Unknown draft target.');
  const access = await authorizeDraftAccess(req, t.formType, t.scopeId, t.portionKey);
  if (!access.ok) return bad(access.error, access.status);
  await deleteOwnDraft(db, { formType: t.formType, scopeId: BigInt(t.scopeId), portionKey: t.portionKey, userId: access.userId });
  return NextResponse.json({ success: true });
}
