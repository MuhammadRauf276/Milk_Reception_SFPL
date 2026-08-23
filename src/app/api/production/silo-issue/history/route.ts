import { NextResponse } from 'next/server';
import { getCurrentUser } from '@core/auth';
import { prisma } from '@core/db';
import { SiloTransactionType } from '@prisma/client';

export async function GET(req: Request) {
  const authUser = await getCurrentUser();
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const siloIdStr = searchParams.get('siloId');
  if (!siloIdStr) {
    return NextResponse.json({ error: 'siloId query parameter is required' }, { status: 400 });
  }

  try {
    const siloId = BigInt(siloIdStr);

    const issues = await prisma.siloInventoryTransaction.findMany({
      where: {
        silo_id: siloId,
        transaction_type: SiloTransactionType.ISSUE,
      },
      include: {
        performer: true,
      },
      orderBy: {
        operational_timestamp: 'desc',
      },
      take: 10,
    });

    const formatted = issues.map((tx) => {
      const opTime = tx.operational_timestamp;
      const timeStr = opTime ? opTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
      const dateStr = opTime ? opTime.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';

      const operatorName = tx.performer?.full_name || tx.performer?.username || 'Production Operator';

      return {
        id: tx.id.toString(),
        time_formatted: `${dateStr} ${timeStr}`.trim(),
        quantity_liters: tx.quantity_liters ? Number(tx.quantity_liters) : null,
        purpose: tx.notes || 'Production Issue',
        flow_meter_reference: tx.reference_id || null,
        operator_name: operatorName,
      };
    });

    return NextResponse.json({ issues: formatted });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch silo issue history' }, { status: 500 });
  }
}
