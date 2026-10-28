import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/backend/core/auth';
import { canActAs } from '@/backend/core/roles/hierarchy';
import {
  generateDynamicExcelReport,
  generateDynamicCsvReport,
} from '@/backend/services/dynamicReportEngine';
import type { DynamicExportRequest } from '@/frontend/modules/dashboard/reports/dynamicReportTypes';

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAuthorized =
      canActAs(user.role, 'ZMCC_MANAGER') ||
      user.role === 'HEAD_OF_MPD' ||
      user.role === 'SUPER_ADMIN' ||
      user.role === 'DATA_EXECUTIVE' ||
      user.role === 'EXECUTIVE_MANAGEMENT';

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Forbidden. ZMCC Manager or executive authority required.' },
        { status: 403 }
      );
    }

    const body: DynamicExportRequest = await req.json();
    if (!body || !body.domain || !Array.isArray(body.selectedFieldIds)) {
      return NextResponse.json(
        { error: 'Invalid export payload: domain and selectedFieldIds are required.' },
        { status: 400 }
      );
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const safeDomain = body.domain.toLowerCase().replace(/_/g, '-');

    if (body.exportFormat === 'CSV') {
      const csvContent = await generateDynamicCsvReport(body, user);
      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${safeDomain}-report-${dateStr}.csv"`,
        },
      });
    }

    const buffer = await generateDynamicExcelReport(body, user);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${safeDomain}-report-${dateStr}.xlsx"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to generate dynamic export' },
      { status: 500 }
    );
  }
}
