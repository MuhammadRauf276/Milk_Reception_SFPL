import { NextRequest, NextResponse } from 'next/server';
import { fetchAllMilkLogs, createNewDispatch } from '@backend/actions/logActions';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get('fromDate') || undefined;
    const toDate = searchParams.get('toDate') || undefined;
    const contractor = searchParams.get('contractor') || undefined;
    const status = searchParams.get('status') || undefined;
    const search = searchParams.get('search') || undefined;

    // Date validation
    if (fromDate && toDate && fromDate > toDate) {
      return NextResponse.json(
        { error: 'From Date cannot be after To Date.' },
        { status: 400 }
      );
    }

    const logs = await fetchAllMilkLogs({ fromDate, toDate, contractor, status, search });
    return NextResponse.json({ logs });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to fetch logs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const created = await createNewDispatch(body);
    return NextResponse.json({ log: created }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create log' }, { status: 400 });
  }
}
