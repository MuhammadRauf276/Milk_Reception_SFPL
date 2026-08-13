import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { gateEntrySchema } from '@/lib/validations/security';
import { validateOperationalTimestamp } from '@/backend/services/chronology-validator';

export async function POST(req: Request) {
  const authUser = await getCurrentUser();
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [
        { username: authUser.username },
        { username: authUser.id },
      ],
      is_active: true,
    },
  });

  const allowedRoles = ['Security_Operator', 'Security_Manager', 'Admin', 'Correction_Officer'];
  if (!dbUser || !allowedRoles.includes(dbUser.role)) {
    return NextResponse.json(
      { error: 'Unauthorized. Security Operator or Security Manager role required.' },
      { status: 403 }
    );
  }

  const userIdBigInt = dbUser.id;

  try {
    const body = await req.json();
    const validated = gateEntrySchema.parse(body);

    const visitId = BigInt(validated.visitId);
    const now = validated.entryTimestamp ? new Date(validated.entryTimestamp) : new Date();

    // Perform atomic transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Confirm VehicleVisit exists
      const visit = await tx.vehicleVisit.findUnique({
        where: { id: visitId },
        include: {
          gate_log: true,
          portions: {
            include: { dispatch_info: true },
          },
        },
      });

      if (!visit) {
        throw new Error('Vehicle visit record not found.');
      }

      // Validate exact chronology against DB predecessor dispatch_timestamp
      const firstDispatchTs = visit.portions.find((p) => p.dispatch_info)?.dispatch_info?.dispatch_timestamp;
      const predTs = firstDispatchTs ? new Date(firstDispatchTs) : null;
      const chronoVal = validateOperationalTimestamp(validated.entryTimestamp || new Date().toISOString(), predTs, 'Gate Entry', 'Dispatch');
      if (!chronoVal.isValid) {
        throw new Error(chronoVal.error);
      }

      // 2. Confirm transition to TOKEN_ISSUED is valid
      if (visit.current_status !== 'DISPATCHED' && visit.current_status !== 'Dispatched') {
        throw new Error(`Vehicle visit status is "${visit.current_status}". Gate entry is only permitted for DISPATCHED visits.`);
      }

      // 3. Confirm no GateLog already exists
      if (visit.gate_log) {
        throw new Error('Gate entry record already exists for this vehicle visit.');
      }

      // 4. Active Token Conflict Check: Check if token is assigned to another active in-plant vehicle
      const activeConflict = await tx.vehicleVisit.findFirst({
        where: {
          token_number: validated.tokenNumber,
          current_status: { notIn: ['COMPLETED', 'CANCELLED'] },
          gate_log: {
            entry_timestamp: { not: null },
            exit_timestamp: null,
          },
          id: { not: visitId },
        },
      });

      if (activeConflict) {
        throw new Error(
          `Token "${validated.tokenNumber}" is already assigned to active vehicle ${activeConflict.vehicle_number} currently inside the plant.`
        );
      }

      // 5. Update VehicleVisit.tokenNumber and set currentStatus to TOKEN_ISSUED
      const updatedVisit = await tx.vehicleVisit.update({
        where: { id: visitId },
        data: {
          token_number: validated.tokenNumber,
          current_status: 'TOKEN_ISSUED',
        },
      });

      // 6. Create GateLog
      const gateLog = await tx.gateLog.create({
        data: {
          visit_id: visitId,
          entry_timestamp: chronoVal.date || now,
          entry_guard_id: userIdBigInt,
          entry_submitted_at: new Date(),
        },
      });

      return { updatedVisit, gateLog };
    });

    return NextResponse.json({
      success: true,
      visitId: result.updatedVisit.id.toString(),
      tokenNumber: result.updatedVisit.token_number,
      message: `Token ${result.updatedVisit.token_number} issued. Vehicle ${result.updatedVisit.vehicle_number} entered gate.`,
    });
  } catch (error: any) {
    if (error?.name === 'ZodError') {
      return NextResponse.json({ error: error.errors[0]?.message || 'Validation failed' }, { status: 400 });
    }
    return NextResponse.json({ error: error?.message || 'Failed to record gate entry' }, { status: 400 });
  }
}
