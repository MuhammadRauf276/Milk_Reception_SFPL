import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { recordSiloIssueTransaction } from '@/backend/services/siloInventoryService';
import { validatePositiveDecimal } from '@/lib/validation-helpers';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';
import { getErrorMessage } from '@/lib/errors';
import { checkEnteredTime, noteLateEntry } from '@/backend/services/outageWindowService';

export async function POST(req: Request) {
  const authUser = await getCurrentUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
  }

  // Strict Role Authorization: PRODUCTION_RECEPTION_OPERATOR / PRODUCTION_HEAD / SUPER_ADMIN ONLY
  const allowedRoles = ['PRODUCTION_RECEPTION_OPERATOR', 'PRODUCTION_HEAD', 'SUPER_ADMIN'];
  if (!allowedRoles.includes(authUser.role)) {
    return NextResponse.json({ error: 'Unauthorized. Production Reception Operator role required to issue milk from silos.' }, { status: 403 });
  }

  let dbUser = await prisma.user.findFirst({
    where: {
      OR: [
        { username: authUser.username },
        { username: authUser.id },
      ],
      is_active: true,
    },
  });

  if (!dbUser) {
    dbUser = await prisma.user.upsert({
      where: { username: authUser.username },
      update: { role: authUser.role, full_name: authUser.name },
      create: { username: authUser.username, role: authUser.role, full_name: authUser.name },
    });
  }

  try {
    const body = await req.json();
    const siloIdStr = body.siloId;
    if (!siloIdStr) {
      return NextResponse.json({ error: 'Silo ID is required.' }, { status: 400 });
    }

    const qtyVal = validatePositiveDecimal(body.quantityLiters, 'Issue Quantity');
    if (!qtyVal.isValid) {
      return NextResponse.json({ error: qtyVal.error }, { status: 400 });
    }
    const quantityLiters = qtyVal.value!;

    const serverNow = new Date();
    const chronoVal = validateOperationalTimestamp(body.operationalTimestamp || serverNow.toISOString(), null, 'Silo Issue', 'Baseline');
    if (!chronoVal.isValid) {
      return NextResponse.json({ error: chronoVal.error }, { status: 400 });
    }
    const opTimestamp = chronoVal.date || serverNow;

    // Older than 3 days needs an outage window for production (and is then listed as entered late).
    const lateCheck = await checkEnteredTime(opTimestamp, { plant: 'PRODUCTION' });
    if ('error' in lateCheck) {
      return NextResponse.json({ error: lateCheck.error }, { status: 400 });
    }

    const purpose = body.purpose ? String(body.purpose).trim() : 'Production Issue';
    const flowMeterReference = body.flowMeterReference ? String(body.flowMeterReference).trim() : null;
    const clientRequestId = body.clientRequestId ? String(body.clientRequestId).trim() : null;
    const idempotencyKey = clientRequestId ? `PRODUCTION_ISSUE:${clientRequestId}` : null;

    const result = await recordSiloIssueTransaction({
      silo_id: siloIdStr,
      quantity_liters: quantityLiters,
      operational_timestamp: opTimestamp,
      performed_by: dbUser.id,
      purpose,
      flow_meter_reference: flowMeterReference,
      idempotency_key: idempotencyKey,
    });
    await noteLateEntry(lateCheck, { step: 'Silo issue', recordTable: 'silo_transaction', recordId: result.transaction.id, actor: dbUser });

    return NextResponse.json({
      success: true,
      transactionId: result.transaction.id.toString(),
      issueLiters: Math.round(quantityLiters),
      stockBefore: Math.round(result.stockBefore),
      stockAfter: Math.round(result.stockAfter),
      purpose,
      alreadyProcessed: result.alreadyProcessed,
      message: `Successfully issued ${Math.round(quantityLiters).toLocaleString()} L of milk for "${purpose}". Remaining stock: ${Math.round(result.stockAfter).toLocaleString()} L.`,
    });
  } catch (error) {
    const status = getErrorMessage(error)?.includes('INACTIVE') ? 409 : 400;
    return NextResponse.json({ error: getErrorMessage(error) || 'Failed to record silo milk issue' }, { status });
  }
}
