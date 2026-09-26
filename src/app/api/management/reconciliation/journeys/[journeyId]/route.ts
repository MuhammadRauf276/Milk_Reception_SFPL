import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { prisma } from '@/backend/core/db';

/** A deliberately read-only evidence drill-down for one MOT-to-ZMCC reconciliation row. */
export async function GET(req: Request, { params }: { params: Promise<{ journeyId: string }> }) {
  const current = await getCurrentUser(req);
  if (!current) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const actor = await prisma.user.findUnique({ where: { id: BigInt(current.id) } });
  if (!actor) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const { journeyId } = await params;
  if (!/^\d+$/.test(journeyId)) return NextResponse.json({ error: 'Invalid journey id.' }, { status: 400 });
  const journey = await prisma.motJourney.findUnique({
    where: { id: BigInt(journeyId) },
    include: {
      zmcc: { select: { id: true, code: true, name: true } }, route: { select: { id: true, route_code: true, name: true } }, mot_vehicle: { select: { vehicle_number: true } },
      summary: true, collections: { select: { id: true, collection_number: true, shop_rmr_number: true, gross_liters: true, at_13ts_liters: true, ts: true, created_at: true, shop: { select: { shop_code: true, shop_name: true } } }, orderBy: { id: 'asc' } },
      mot_arrival: {
        include: {
          lab_session: {
            include: {
              results: {
                select: {
                  test_code_snapshot: true,
                  test_name_snapshot: true,
                  numeric_value: true,
                  text_value: true,
                  evaluation_status: true,
                  is_passed: true,
                },
              },
              tank_receipt: {
                select: {
                  id: true,
                  gross_liters: true,
                  at_13ts_liters: true,
                  received_at: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!journey) return NextResponse.json({ error: 'Journey not found.' }, { status: 404 });
  const canReadAll = ['SUPER_ADMIN', 'HEAD_OF_MPD', 'FINANCE_ACCOUNTS'].includes(actor.role);
  if (!canReadAll && !(actor.role === 'ZMCC_MANAGER' && actor.procurement_source_id === journey.zmcc_id)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  const auditIds = [journey.id, ...journey.collections.map((row) => row.id), ...(journey.mot_arrival ? [journey.mot_arrival.id] : []), ...(journey.mot_arrival?.lab_session ? [journey.mot_arrival.lab_session.id] : [])];
  const audit = await prisma.auditLog.findMany({ where: { record_id: { in: auditIds }, table_name: { in: ['mot_journey', 'mot_shop_collection', 'zmcc_mot_arrival', 'zmcc_lab_session'] } }, orderBy: { created_at: 'desc' }, take: 100, include: { user: { select: { username: true, full_name: true, role: true } } } });
  const session = journey.mot_arrival?.lab_session;
  return NextResponse.json({
    journey: { id: journey.id.toString(), number: journey.journey_number, operationalDate: journey.operational_date.toISOString(), source: { id: journey.zmcc.id.toString(), code: journey.zmcc.code, name: journey.zmcc.name }, route: { id: journey.route.id.toString(), code: journey.route.route_code, name: journey.route.name }, vehicleNumber: journey.mot_vehicle.vehicle_number, summary: journey.summary ? { grossLiters: Number(journey.summary.total_gross_liters), at13tsLiters: Number(journey.summary.total_at_13ts_liters), shopCount: journey.summary.collected_shop_count } : null },
    shopCollections: journey.collections.map((row) => ({ id: row.id.toString(), number: row.collection_number, shopRmrNumber: row.shop_rmr_number, shop: row.shop, grossLiters: Number(row.gross_liters), at13tsLiters: Number(row.at_13ts_liters), ts: Number(row.ts), collectedAt: row.created_at.toISOString() })),
    zmcc: { arrival: journey.mot_arrival ? { id: journey.mot_arrival.id.toString(), token: journey.mot_arrival.zmcc_token, rawMilkTokenNumber: journey.mot_arrival.raw_milk_token_number, arrivedAt: journey.mot_arrival.arrival_timestamp.toISOString() } : null, lab: session ? { id: session.id.toString(), finalDecision: session.final_decision, attendantRecommendation: session.attendant_recommendation, reason: session.final_decision_reason, grossLiters: session.gross_liters == null ? null : Number(session.gross_liters), at13tsLiters: session.at_13ts_liters == null ? null : Number(session.at_13ts_liters), results: session.results.map((result) => ({ code: result.test_code_snapshot, name: result.test_name_snapshot, value: result.numeric_value == null ? result.text_value : Number(result.numeric_value), evaluation: result.evaluation_status, passed: result.is_passed })), tankReceipt: session.tank_receipt ? { id: session.tank_receipt.id.toString(), grossLiters: Number(session.tank_receipt.gross_liters), at13tsLiters: session.tank_receipt.at_13ts_liters == null ? null : Number(session.tank_receipt.at_13ts_liters), receivedAt: session.tank_receipt.received_at.toISOString() } : null } : null },
    audit: audit.map((row) => ({ id: row.id.toString(), table: row.table_name, recordId: row.record_id.toString(), action: row.action, oldValues: row.old_values, newValues: row.new_values, actor: row.user ? { name: row.user.full_name || row.user.username, role: row.user.role } : null, at: row.created_at.toISOString() })),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
